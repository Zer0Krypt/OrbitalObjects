import * as THREE from 'three';
import { json2satrec, type SatRec } from 'satellite.js';
import type { App } from '../app';
import { loadDeployment, loadDeploymentIndex, type DeployEls, type DeploymentInfo } from '../data/more';
import { stateAt } from '../render/orbits';
import { fmtDate, fmtInt, h } from './dom';
import type { WatchCtx } from './eclipses';

const MU = 398600.4418;
const RE = 6378.137;
const DAY = 86400e3;
const altOf = (n: number) => Math.cbrt(MU / ((n * 2 * Math.PI) / 86400) ** 2) - RE;
const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

interface Track {
  norad: number;
  name: string;
  els: DeployEls[];
  recs: (SatRec | null | undefined)[];
}

function recFor(tr: Track, k: number) {
  if (tr.recs[k] === undefined) {
    const e = tr.els[k];
    try {
      const r = json2satrec({
        OBJECT_NAME: tr.name,
        OBJECT_ID: '',
        EPOCH: new Date(e[0]).toISOString().replace('Z', ''),
        MEAN_MOTION: e[1],
        ECCENTRICITY: e[2],
        INCLINATION: e[3],
        RA_OF_ASC_NODE: e[4],
        ARG_OF_PERICENTER: e[5],
        MEAN_ANOMALY: e[6],
        EPHEMERIS_TYPE: 0,
        CLASSIFICATION_TYPE: 'U',
        NORAD_CAT_ID: tr.norad,
        ELEMENT_SET_NO: 0,
        REV_AT_EPOCH: 0,
        BSTAR: e[7],
        MEAN_MOTION_DOT: 0,
        MEAN_MOTION_DDOT: 0,
      });
      tr.recs[k] = r.error ? null : r;
    } catch {
      tr.recs[k] = null;
    }
  }
  return tr.recs[k] ?? null;
}

/** The element set in force at t: the latest one at or before it. */
function indexAt(els: DeployEls[], t: number) {
  let lo = 0;
  let hi = els.length - 1;
  if (t <= els[0][0]) return 0;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (els[m][0] <= t) lo = m;
    else hi = m - 1;
  }
  return lo;
}

const colorFor = (alt: number, c: THREE.Color) => c.setHSL(0.02 + 0.6 * Math.min(1, Math.max(0, (alt - 250) / 350)), 0.85, 0.6);

/** Replay a launch's satellites day by day as they spread out and climb. */
export function mountDeployments(app: App) {
  let index: DeploymentInfo[] | null = null;
  void loadDeploymentIndex().then((l) => {
    index = l;
    app.emit('watch');
  });

  const geo = new THREE.BufferGeometry();
  const mat = new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 7;
  points.visible = false;
  app.stage.scene.add(points);

  const hud = h('div', { class: 'hud-card deploy-hud', hidden: true, role: 'region', 'aria-label': 'Deployment replay' });
  document.getElementById('app')!.append(hud);
  let tracks: Track[] = [];
  let t0 = 0;
  let t1 = 0;
  let t = 0;
  let playing = false;
  let speed = DAY; // per real second
  const slider = h('input', { type: 'range', min: 0, max: 1000, step: 1, class: 'deploy-range', 'aria-label': 'Replay time' });
  const when = h('b', { class: 'mono' });
  const stats = h('p', { class: 'sky-hint', style: 'margin:4px 0 0' });
  const chart = h('canvas', { class: 'deploy-chart', width: 720, height: 220, 'aria-label': 'Altitude of each satellite over time' });
  const play = h('button', { class: 'btn' }, 'Play');
  const speedSel = h('select', { class: 'sky-select', 'aria-label': 'Replay speed' }, ...[
    ['6 h', 0.25],
    ['1 day', 1],
    ['3 days', 3],
  ].map(([l, v]) => h('option', { value: String(v), selected: v === 1 }, `${l} / s`)));
  speedSel.onchange = () => (speed = Number(speedSel.value) * DAY);
  play.onclick = () => {
    playing = !playing;
    if (playing && t >= t1) t = t0;
    play.textContent = playing ? 'Pause' : 'Play';
  };
  slider.oninput = () => {
    t = t0 + (Number(slider.value) / 1000) * (t1 - t0);
    playing = false;
    play.textContent = 'Play';
    update(true);
  };

  async function open(info: DeploymentInfo) {
    const d = await loadDeployment(info.key);
    if (!d?.objects?.length) return;
    tracks = d.objects.filter((o) => o.els.length).map((o) => ({ norad: o.norad, name: o.name, els: o.els, recs: [] }));
    t0 = Math.min(...tracks.map((x) => x.els[0][0]));
    t1 = Math.max(...tracks.map((x) => x.els[x.els.length - 1][0]));
    t = t0;
    const n = tracks.length;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    app.exitHistory();
    app.select(null);
    // Today's orbits are wrong for the past: dim everything else.
    app.setFilters({ ids: new Set(), idsLabel: `the deployment replay of ${d.name} (everything else dimmed)` });
    app.clock.setRate(1);
    app.clock.setPaused(true);
    points.visible = true;
    hud.replaceChildren(
      h('button', { class: 'close', 'aria-label': 'Close the replay', onclick: close }, '×'),
      h('div', { class: 'eyebrow' }, `Deployment replay · launch ${d.key}`),
      h('h3', null, d.name, h('small', null, `launched ${fmtDate(d.launch)}`)),
      h('div', { class: 'deploy-row' }, play, slider, when, speedSel),
      chart,
      stats,
      h('p', { class: 'hud-note' }, d.history ? 'From each satellite’s published element sets since launch.' : 'From the element sets collected at each data update since launch.'),
    );
    hud.hidden = false;
    document.body.classList.add('hud-open');
    playing = true;
    play.textContent = 'Pause';
    update(true);
    app.flyHome();
  }

  function close() {
    hud.hidden = true;
    document.body.classList.remove('hud-open');
    points.visible = false;
    playing = false;
    tracks = [];
    app.setFilters({ ids: null, idsLabel: '' });
    app.clock.resetToNow();
    app.clock.setPaused(false);
  }

  let lastReal = performance.now();
  let lastStats = 0;
  function update(force = false) {
    const now = performance.now();
    const dt = Math.min(100, now - lastReal);
    lastReal = now;
    if (!tracks.length) return;
    if (playing) {
      t += (dt / 1000) * speed;
      if (t >= t1) {
        t = t1;
        playing = false;
        play.textContent = 'Play';
      }
    }
    app.clock.set(t);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    const alts: number[] = [];
    const vecs: THREE.Vector3[] = [];
    let normal: THREE.Vector3 | null = null;
    tracks.forEach((tr, i) => {
      if (t < tr.els[0][0] - 3600e3) {
        pos.setXYZ(i, 0, 0, 0);
        col.setXYZ(i, 0, 0, 0);
        return;
      }
      const k = indexAt(tr.els, t);
      const rec = recFor(tr, k);
      const st = rec && stateAt(rec, t);
      if (!st) {
        pos.setXYZ(i, 0, 0, 0);
        col.setXYZ(i, 0, 0, 0);
        return;
      }
      const p = st.position;
      const v = new THREE.Vector3(p.x / 6371, p.z / 6371, -p.y / 6371);
      pos.setXYZ(i, v.x, v.y, v.z);
      const alt = altOf(tr.els[k][1]);
      alts.push(alt);
      vecs.push(v);
      if (!normal) normal = v.clone().cross(new THREE.Vector3(st.velocity.x, st.velocity.z, -st.velocity.y)).normalize();
      colorFor(alt, c);
      col.setXYZ(i, c.r, c.g, c.b);
    });
    pos.needsUpdate = col.needsUpdate = true;
    slider.value = String(Math.round(((t - t0) / Math.max(1, t1 - t0)) * 1000));
    when.textContent = `Day ${Math.floor((t - t0) / DAY) + 1} · ${dayFmt.format(t)}`;
    if (force || now - lastStats > 250) {
      lastStats = now;
      drawChart();
      // Spread along the orbit: the arc not covered by the largest gap between neighbours.
      if (normal && vecs.length > 1) {
        const n = normal as THREE.Vector3;
        const ref = vecs[0].clone().projectOnPlane(n).normalize();
        const side = n.clone().cross(ref);
        const ang = vecs.map((v) => (Math.atan2(v.dot(side), v.dot(ref)) * 180) / Math.PI).map((a) => (a + 360) % 360).sort((a, b) => a - b);
        let gap = 360 - ang[ang.length - 1] + ang[0];
        for (let k = 1; k < ang.length; k++) gap = Math.max(gap, ang[k] - ang[k - 1]);
        const meanAlt = alts.reduce((s, a) => s + a, 0) / alts.length;
        const spread = 360 - gap;
        const top = Math.max(...tracks.map((x) => altOf(x.els[x.els.length - 1][1])));
        const arrived = alts.filter((a) => a > top - 15).length;
        stats.textContent = `${fmtInt(alts.length)} satellites · spread ${spread > 300 ? 'all the way round the orbit' : `over ${fmtInt((spread / 360) * 2 * Math.PI * (6371 + meanAlt))} km of orbit`} · mean altitude ${fmtInt(meanAlt)} km · ${arrived} at the highest orbit (${fmtInt(top)} km)`;
      }
    }
  }
  app.on('frame', () => !hud.hidden && update());

  function drawChart() {
    const W = chart.clientWidth || 520;
    const H = chart.clientHeight || 150;
    const dpr = Math.min(2, window.devicePixelRatio);
    if (chart.width !== Math.round(W * dpr)) chart.width = Math.round(W * dpr);
    if (chart.height !== Math.round(H * dpr)) chart.height = Math.round(H * dpr);
    const g = chart.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = { l: 36, r: 6, t: 16, b: 16 };
    g.clearRect(0, 0, W, H);
    const all = tracks.flatMap((tr) => tr.els.map((e) => altOf(e[1])));
    const lo = Math.floor((Math.min(...all) - 10) / 50) * 50;
    const hi = Math.ceil((Math.max(...all) + 10) / 50) * 50;
    const X = (tt: number) => pad.l + ((tt - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
    const Y = (a: number) => H - pad.b - ((a - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
    g.font = '10px "JetBrains Mono Variable", monospace';
    g.fillStyle = '#7d8394';
    g.strokeStyle = 'rgba(160,190,255,0.12)';
    g.textAlign = 'right';
    for (let a = lo; a <= hi; a += hi - lo > 300 ? 100 : 50) {
      g.beginPath();
      g.moveTo(pad.l, Y(a));
      g.lineTo(W - pad.r, Y(a));
      g.stroke();
      g.fillText(String(a), pad.l - 5, Y(a) + 3);
    }
    g.textAlign = 'left';
    g.fillText('altitude, km', 2, 9);
    const c = new THREE.Color();
    for (const tr of tracks) {
      g.beginPath();
      tr.els.forEach((e, k) => (k ? g.lineTo(X(e[0]), Y(altOf(e[1]))) : g.moveTo(X(e[0]), Y(altOf(e[1])))));
      colorFor(altOf(tr.els[tr.els.length - 1][1]), c);
      g.strokeStyle = `#${c.getHexString()}`;
      g.globalAlpha = 0.7;
      g.lineWidth = 1.2;
      g.stroke();
    }
    g.globalAlpha = 1;
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(X(t), pad.t);
    g.lineTo(X(t), H - pad.b);
    g.stroke();
    g.fillStyle = '#7d8394';
    g.textAlign = 'center';
    const days = Math.ceil((t1 - t0) / DAY);
    const step = days > 60 ? 14 : days > 20 ? 7 : days > 6 ? 2 : 1;
    for (let d = 0; d <= days; d += step) g.fillText(`day ${d + 1}`, X(t0 + d * DAY), H - 3);
  }

  function render(ctx: WatchCtx) {
    ctx.action.hidden = true;
    ctx.foot.textContent = 'Recent launches that put several satellites in orbit at once. The replay draws each satellite from the element sets it had at the time: see them released together, drift apart and climb (or not) to their working orbits.';
    if (!index) {
      ctx.sub.textContent = 'Loading…';
      ctx.body.replaceChildren();
      return;
    }
    ctx.sub.textContent = index.length ? `${index.length} recent multi-satellite launches` : 'No recent multi-satellite launches to replay.';
    ctx.body.replaceChildren(
      ...index.map((l) =>
        h(
          'button',
          {
            class: 'rw-row',
            title: 'Replay this deployment',
            onclick: () => {
              ctx.close();
              void open(l);
            },
          },
          h('i', { class: 'd', style: 'background:#9085e9;color:#9085e9' }),
          h('span', { class: 't' }, h('b', null, l.name), h('span', null, `Launch ${l.key} · ${l.objects} objects · ${Math.max(1, Math.round((Date.parse(l.to) - Date.parse(l.from)) / DAY))} days of orbits`)),
          h('span', { class: 'r' }, h('b', null, fmtDate(l.launch)), h('small', null, 'Replay ›')),
        ),
      ),
    );
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !hud.hidden) close();
  });
  return { render, count: () => index?.length ?? 0 };
}
