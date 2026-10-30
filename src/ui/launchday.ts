import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import type { Launch } from '../data/watch';
import { latLonToScene } from '../sim/astro';
import { fmtInt, fmtUtc, h, icon, ICONS } from './dom';

/**
 * Launch day mode: follow one launch with a live countdown, its webcast, an
 * estimated ascent track on the globe and the new objects as they appear in
 * the catalogue.
 *
 * The ascent is a rough sketch, not a trajectory: a great circle from the pad
 * along the azimuth that reaches the likely target inclination, with a
 * generic climb to orbit in about nine minutes.
 */

const DEG = Math.PI / 180;
const RE = 6371;
const ASCENT_S = 540;
const COAST_S = 25 * 60;
const EARTH_RATE = 360 / 86164; // deg/s
const ROCKET = '<path d="M12 2c3 2.5 4.5 6 4.5 10.5L14 16h-4l-2.5-3.5C7.5 8 9 4.5 12 2z"/><circle cx="12" cy="9" r="1.6"/><path d="M10 16l-1.5 4M14 16l1.5 4M12 17v4"/>';

/** Best guess at the target orbit's inclination and the climb's final altitude. */
export function targetOrbit(l: Launch): { incl: number; alt: number; south: boolean; note: string } {
  const lat = Math.abs(l.lat ?? 28.5);
  const name = `${l.name} ${l.mission ?? ''}`;
  const orbit = (l.orbit ?? '').toUpperCase();
  if (/STARLINK/i.test(name)) return (l.lon ?? 0) < -100 ? { incl: 53, alt: 280, south: true, note: 'Starlink shell, 53°' } : { incl: 43, alt: 280, south: false, note: 'Starlink shell, 43°' };
  if (/SHENZHOU|TIANZHOU/i.test(name)) return { incl: 41.5, alt: 210, south: false, note: 'to Tiangong, 41.5°' };
  if (orbit === 'ISS' || /\b(CRS|CREW|AX-|AXIOM|CYGNUS|PROGRESS|SOYUZ MS|DRAGON|HTV|STARLINER)\b/i.test(name)) return { incl: 51.6, alt: 210, south: false, note: 'to the ISS, 51.6°' };
  if (orbit === 'SSO') return { incl: 97.6, alt: 500, south: true, note: 'sun-synchronous, ~97.6°' };
  if (orbit === 'PO' || /POLAR/.test(orbit)) return { incl: 90, alt: 500, south: true, note: 'polar' };
  if (orbit === 'MEO') return { incl: 55, alt: 300, south: false, note: 'navigation orbit, ~55°' };
  if (/GTO|GEO|GSO/.test(orbit)) return { incl: lat, alt: 200, south: false, note: 'geostationary transfer: due east' };
  if (/TLI|LUNAR|HELIO|L1|L2/.test(orbit)) return { incl: lat, alt: 200, south: false, note: 'to the Moon or beyond: due east' };
  return { incl: lat, alt: 250, south: false, note: 'low Earth orbit, due east' };
}

/** Launch azimuth (deg from north) that reaches inclination `incl` from latitude `lat`. */
function azimuth(lat: number, incl: number, south: boolean) {
  const s = Math.cos(incl * DEG) / Math.cos(lat * DEG);
  const b = Math.abs(s) >= 1 ? (s > 0 ? 90 : -90) : Math.asin(s) / DEG;
  return south ? 180 - b : b;
}

/** Point at angular distance `d` (rad) along azimuth `az` from lat/lon. */
function along(lat: number, lon: number, az: number, d: number) {
  const p1 = lat * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(az * DEG));
  const l2 = lon * DEG + Math.atan2(Math.sin(az * DEG) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / DEG, l2 / DEG] as const;
}

/** Estimated lat, lon (Earth-fixed) and altitude `t` seconds after liftoff. */
export function ascentAt(l: Launch, t: number) {
  const tgt = targetOrbit(l);
  const az = azimuth(l.lat!, tgt.incl, tgt.south);
  const v = Math.sqrt(398600 / (RE + tgt.alt));
  let alt: number;
  let dist: number;
  if (t <= ASCENT_S) {
    const s = Math.max(0, t) / ASCENT_S;
    alt = tgt.alt * (1 - (1 - s) ** 1.6);
    dist = (v * ASCENT_S * s ** 2.7) / 2.7;
  } else {
    alt = tgt.alt;
    dist = (v * ASCENT_S) / 2.7 + v * (t - ASCENT_S);
  }
  // Fly the great circle in the inertial frame; the ground turns under it.
  const [la, lo] = along(l.lat!, l.lon!, az, dist / (RE + alt * 0.5));
  return { lat: la, lon: lo - EARTH_RATE * Math.max(0, t), alt };
}

export function mountLaunchDay(app: App) {
  // ---------- globe: track and marker ----------
  const N = 160;
  const mat = new LineMaterial({ linewidth: 2.6, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const line = new Line2(new LineGeometry(), mat);
  line.frustumCulled = false;
  const syncRes = () => mat.resolution.set(app.stage.renderer.domElement.clientWidth, app.stage.renderer.domElement.clientHeight);
  syncRes();
  app.stage.onResize(syncRes);
  line.renderOrder = 6;
  line.visible = false;
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.009, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  marker.visible = false;
  marker.renderOrder = 7;
  app.earth.group.add(line, marker);

  // ---------- panel ----------
  const pill = h('button', { class: 'ld-pill', hidden: true });
  const title = h('h3');
  const sub = h('p', { class: 'ld-sub' });
  const clock = h('div', { class: 'ld-clock mono' });
  const phase = h('div', { class: 'ld-phase' });
  const facts = h('dl', { class: 'kv one ld-facts' });
  const actions = h('div', { class: 'sky-actions' });
  const newObjs = h('div', { class: 'ld-new' });
  const panel = h(
    'div',
    { class: 'ld-panel', hidden: true, role: 'dialog', 'aria-label': 'Launch day' },
    h('button', { class: 'close', 'aria-label': 'Leave launch day mode', onclick: () => follow(null) }, icon(ICONS.close)),
    h('div', { class: 'eyebrow' }, icon(ROCKET), 'Launch day'),
    title,
    sub,
    h('div', { class: 'ld-count' }, clock, phase),
    facts,
    actions,
    newObjs,
    h('p', { class: 'ld-foot' }, 'The ascent drawn on the globe is an estimate from the pad and the likely target orbit, not the real trajectory. Times from Launch Library 2 often slip.'),
  );
  document.getElementById('app')!.append(pill, panel);

  let current: Launch | null = null;
  let dismissed = '';

  const upcoming = () => (app.launches?.upcoming ?? []).filter((l) => l.netMs > Date.now() - 3 * 3600e3).sort((a, b) => a.netMs - b.netMs);

  function drawTrack(l: Launch) {
    if (l.lat === null || l.lon === null) {
      line.visible = false;
      return;
    }
    const pos: number[] = [];
    const col: number[] = [];
    const v = new THREE.Vector3();
    const total = ASCENT_S + COAST_S;
    const a = new THREE.Color(0xff8a3d);
    const b = new THREE.Color(0x7cc4ff);
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) ** 1.5 * total;
      const p = ascentAt(l, t);
      latLonToScene(p.lat, p.lon, 1 + p.alt / RE, v);
      pos.push(v.x, v.y, v.z);
      const c = a.clone().lerp(b, Math.min(1, t / ASCENT_S));
      const fade = t > ASCENT_S ? 1 - 0.75 * ((t - ASCENT_S) / COAST_S) : 1;
      col.push(c.r * fade, c.g * fade, c.b * fade);
    }
    const g = new LineGeometry();
    g.setPositions(pos);
    g.setColors(col);
    line.geometry.dispose();
    line.geometry = g;
    line.visible = true;
  }

  /** Catalogue objects launched on the day of this launch, grouped by launch. */
  function catalogued(l: Launch) {
    const day = new Date(l.netMs).toISOString().slice(0, 10);
    const groups = new Map<string, SatObject[]>();
    for (const o of app.cat.objects.slice(0, app.liveCount)) {
      if (o.launch !== day) continue;
      const k = o.cospar.slice(0, 8);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(o);
    }
    return [...groups.entries()];
  }

  function renderStatic() {
    const l = current!;
    const tgt = targetOrbit(l);
    title.textContent = l.mission ?? l.name;
    sub.textContent = [l.rocket, l.provider].filter(Boolean).join(' · ');
    facts.replaceChildren(
      ...([
        ['Launch site', [l.pad, l.location].filter(Boolean).join(', ') || '—'],
        ['Target', `${l.orbit ?? '—'}${l.lat !== null ? ` · track assumes ${tgt.note}` : ''}`],
        ['Liftoff (NET)', `${fmtUtc(l.netMs, false)} UTC`],
        ['Status', l.statusName ?? l.status ?? '—'],
      ] as [string, string][]).map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))),
    );
    const webcast = l.vidUrl ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${l.mission ?? l.name} launch live`)}`;
    actions.replaceChildren(
      ...[
      h('a', { class: 'btn primary', href: webcast, target: '_blank', rel: 'noopener' }, l.vidUrl ? 'Watch the webcast ↗' : 'Find the webcast ↗'),
      l.lat !== null ? h('button', { class: 'btn', onclick: () => app.flyToLatLon(l.lat!, l.lon!, 2.6) }, 'Fly to the pad') : null,
      l.lat !== null
        ? h(
            'button',
            {
              class: 'btn',
              title: 'Replay the estimated ascent at 10× speed',
              onclick: () => {
                app.exitHistory();
                app.select(null);
                app.clock.set(l.netMs - 20e3);
                app.clock.setRate(10);
                app.clock.setPaused(false);
                app.flyToLatLon(l.lat!, l.lon!, 2.4);
              },
            },
            'Preview the ascent',
          )
        : null,
      l.infoUrl ? h('a', { class: 'btn', href: l.infoUrl, target: '_blank', rel: 'noopener' }, 'Mission page ↗') : null,
      ].filter((x) => x !== null),
    );
    renderNew();
  }

  function renderNew() {
    const l = current;
    if (!l) return;
    const groups = catalogued(l);
    const launched = Date.now() > l.netMs;
    newObjs.replaceChildren(
      h('h4', { class: 'rw-h', style: 'margin:10px 0 6px' }, 'New objects in the catalogue'),
      ...(groups.length
        ? groups.map(([des, objs]) => {
            const lead = objs.find((o) => o.type === 'P') ?? objs[0];
            return h(
              'button',
              {
                class: 'rw-row',
                onclick: () => {
                  app.exitHistory();
                  app.setFilters({ ids: new Set(objs.map((o) => o.norad)), idsLabel: `Launch ${des}` });
                  app.select(lead, { fly: true });
                },
              },
              h('i', { class: 'd', style: `background:${app.colorsHex[lead.idx]};color:${app.colorsHex[lead.idx]}` }),
              h('span', { class: 't' }, h('b', null, lead.name), h('span', null, `${des} · launched ${lead.launch}`)),
              h('span', { class: 'r' }, h('b', null, fmtInt(objs.length)), h('small', null, objs.length === 1 ? 'object' : 'objects')),
            );
          })
        : [
            h(
              'p',
              { class: 'rw-empty', style: 'margin:0' },
              launched
                ? 'Nothing from this launch is catalogued yet. New objects usually appear within a day or two; the data refreshes every six hours.'
                : 'After launch, the new satellites and stages show up here once they are catalogued, usually within a day or two.',
            ),
          ]),
    );
  }

  function tick() {
    const l = current;
    // The pill: the next launch within a day, unless dismissed.
    const next = upcoming().find((x) => x.netMs - Date.now() < 86400e3 && x.netMs > Date.now() - 3600e3);
    pill.hidden = !next || !!current || dismissed === next.id || document.body.classList.contains('embed');
    if (next && !pill.hidden) {
      const dt = next.netMs - Date.now();
      pill.replaceChildren(icon(ROCKET), h('span', null, h('b', null, next.mission ?? next.name), ` · ${(next.rocket ?? '').replace(/ Block \d+$/, '')}`), h('em', { class: 'mono' }, fmtT(dt)), h('span', { class: 'ld-go' }, 'Follow ›'));
      pill.onclick = () => follow(next);
    }
    if (!l) return;
    const wall = Date.now() - l.netMs;
    clock.textContent = fmtT(-wall);
    const t = (app.clock.now() - l.netMs) / 1000;
    phase.textContent =
      wall < -3600e3 ? (l.status && /go/i.test(l.status) ? 'Go for launch' : 'Waiting for launch') : wall < 0 ? 'Countdown' : wall < ASCENT_S * 1000 ? 'Ascent (estimated)' : wall < 2 * 3600e3 ? 'In orbit, if all went to plan' : 'Launched';
    // The marker follows the simulation clock, so "Preview the ascent" works.
    if (l.lat !== null && t >= 0 && t <= ASCENT_S + COAST_S && !app.history) {
      const p = ascentAt(l, t);
      latLonToScene(p.lat, p.lon, 1 + p.alt / RE, marker.position);
      marker.visible = true;
    } else marker.visible = false;
  }

  function fmtT(ms: number) {
    const s = Math.abs(Math.round(ms / 1000));
    const d = Math.floor(s / 86400);
    const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `T${ms >= 0 ? '−' : '+'}${d ? `${d}d ` : ''}${hh}:${mm}:${ss}`;
  }

  function follow(l: Launch | null) {
    if (!l && current) dismissed = current.id;
    current = l;
    panel.hidden = !l;
    document.body.classList.toggle('launch-day', !!l);
    if (!l) {
      line.visible = marker.visible = false;
      if (app.clock.rate === 10) app.clock.resetToNow();
      tick();
      return;
    }
    app.exitHistory();
    renderStatic();
    drawTrack(l);
    if (l.lat !== null) app.flyToLatLon(l.lat, l.lon!, 2.8);
    tick();
  }
  app.followLaunch = (id: string) => {
    const l = app.launches?.upcoming.find((x) => x.id === id);
    if (l) follow(l);
  };

  app.on('frame', () => current && tick());
  app.on('history', () => (line.visible = !!current && !app.history && current.lat !== null));
  app.on('skyview', () => (line.visible = !!current && !app.skyView.active && current.lat !== null));
  app.on('watch', () => {
    if (current) {
      current = app.launches?.upcoming.find((x) => x.id === current!.id) ?? current;
      renderStatic();
    }
    tick();
  });
  setInterval(() => {
    if (!current) tick();
  }, 1000);
  setInterval(renderNew, 60e3);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current && !(e.target instanceof HTMLInputElement)) follow(null);
  });
}
