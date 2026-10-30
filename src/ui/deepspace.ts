import * as THREE from 'three';
import type { App } from '../app';
import { sampleAt, WHERE_LABEL, type DeepCraft } from '../data/deepspace';
import { eciToScene, KM, moonPositionEci, sunDirectionEci } from '../sim/astro';
import { fmt, fmtInt, h, icon, ICONS } from './dom';

/**
 * Beyond Earth orbit: spacecraft at the Sun–Earth L1 and L2 points and in
 * lunar orbit, from JPL Horizons, with a zoomed-out cislunar view. Markers
 * appear whenever the camera is far enough out to see them.
 */

const L_KM = 1.5e6;
const NEAR = 20; // scene units: closer than this, deep-space markers are hidden
const COLORS: Record<DeepCraft['where'], number> = { L1: 0xffd27a, L2: 0x9fb8ff, Moon: 0xcfe0ff };

export function mountDeepSpace(app: App) {
  const group = new THREE.Group();
  group.visible = false;
  app.stage.scene.add(group);

  // Markers: one point per craft, fixed size on screen.
  const geo = new THREE.BufferGeometry();
  const mat = new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 8;
  group.add(points);
  // The Moon's orbit, and the L1 / L2 points.
  const moonRing = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x8090b0, transparent: true, opacity: 0.35 }));
  moonRing.frustumCulled = false;
  group.add(moonRing);
  const lgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const lpts = new THREE.Points(lgeo, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
  lpts.frustumCulled = false;
  group.add(lpts);
  const paths = new THREE.Group();
  group.add(paths);

  const overlay = document.getElementById('overlay')!;
  const labels: { el: HTMLElement; pos: THREE.Vector3; craft: DeepCraft | null }[] = [];
  const mkLabel = (text: string, cls: string, craft: DeepCraft | null) => {
    const el = h('div', { class: `ds-label ${cls}`, hidden: true }, text);
    if (craft) el.addEventListener('click', () => pick(craft));
    overlay.append(el);
    const l = { el, pos: new THREE.Vector3(), craft };
    labels.push(l);
    return l;
  };
  const l1 = mkLabel('L1', 'lp', null);
  const l2 = mkLabel('L2', 'lp', null);
  const moonLbl = mkLabel('Moon', 'moon', null);
  let craftLabels: typeof labels = [];

  // ---------- panel ----------
  const list = h('div', { class: 'rw-list' });
  const detail = h('div', { class: 'ds-detail', hidden: true });
  const sub = h('p', { class: 'rw-sub' });
  const panel = h(
    'div',
    { class: 'reentry-panel ds-panel', hidden: true, role: 'dialog', 'aria-label': 'Beyond Earth orbit' },
    h(
      'div',
      { class: 'rw-head' },
      h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 'eyebrow' }, 'Beyond Earth orbit'), h('h3', { class: 'id-title' }, 'Spacecraft in deep space'), sub),
      h('button', { class: 'icon-mini', 'aria-label': 'Close', onclick: () => close() }, icon(ICONS.close)),
    ),
    h('div', { class: 'scroll rw-body' }, detail, list),
    h('p', { class: 'rw-foot' }, 'Positions from NASA JPL Horizons, refreshed with each data update. L1 and L2 are where the Sun’s and Earth’s pull balance, about 1.5 million km away: L1 has an unbroken view of the Sun, L2 a cold, dark view of the sky.'),
  );
  document.getElementById('app')!.append(panel);

  let craft: DeepCraft[] = [];
  let pathsAt = -Infinity;
  // Ecliptic north in scene axes: L1 and L2 circle Earth once a year about it.
  const eps = 23.439 * (Math.PI / 180);
  const eclAxis = eciToScene(0, -Math.sin(eps), Math.cos(eps)).normalize();
  const sunLon = (t: number) => {
    const s = sunDirectionEci(t);
    return Math.atan2(s[1] * Math.cos(eps) + s[2] * Math.sin(eps), s[0]);
  };
  /**
   * Halo-orbit paths over ±60 days, drawn in the frame that turns with the
   * Sun–Earth line (each point rotated by how far the Sun has moved since),
   * so they show the loop around L1 or L2 rather than a sweep around Earth.
   */
  function buildPaths(t: number) {
    pathsAt = t;
    for (const p of paths.children) (p as THREE.Line).geometry.dispose();
    paths.clear();
    const lonNow = sunLon(t);
    const q = new THREE.Quaternion();
    for (const c of craft) {
      if (!c.path) continue;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < c.path.pos.length; k += 3) {
        const ti = c.path.t0 + (k / 3) * c.path.step;
        if (Math.abs(ti - t) > 60 * 86400e3) continue;
        q.setFromAxisAngle(eclAxis, lonNow - sunLon(ti));
        pts.push(eciToScene(c.path.pos[k], c.path.pos[k + 1], c.path.pos[k + 2]).applyQuaternion(q));
      }
      if (pts.length < 2) continue;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COLORS[c.where], transparent: true, opacity: 0.22 }));
      line.frustumCulled = false;
      line.userData.craft = c;
      paths.add(line);
    }
  }
  let selected: DeepCraft | null = null;
  let viewing = false;

  function setData() {
    craft = app.deepSpace?.craft ?? [];
    for (const l of craftLabels) l.el.remove();
    craftLabels = craft.map((c) => mkLabel(c.short, c.where === 'Moon' ? 'lunar' : 'lpc', c));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(craft.length * 3), 3));
    const col = new Float32Array(craft.length * 3);
    craft.forEach((c, i) => new THREE.Color(COLORS[c.where]).toArray(col, i * 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    pathsAt = -Infinity;
    renderList();
  }

  const posOf = (c: DeepCraft, t: number, out = new THREE.Vector3()) => {
    const p = sampleAt(c, t);
    return p ? eciToScene(p[0], p[1], p[2], out) : null;
  };

  function renderList() {
    const t = app.clock.now();
    const d = app.deepSpace;
    sub.textContent = d?.available ? `${craft.length} spacecraft · positions ${d.generated.slice(0, 10)}${d.sample ? ' · sample data' : ''}` : 'Deep-space positions are unavailable right now.';
    list.replaceChildren(
      ...(['L1', 'L2', 'Moon'] as const).flatMap((w) => {
        const cs = craft.filter((c) => c.where === w);
        if (!cs.length) return [];
        return [
          h('h4', { class: 'rw-h' }, WHERE_LABEL[w]),
          ...cs.map((c) => {
            const p = sampleAt(c, t);
            const km = p ? Math.hypot(...p) : NaN;
            return h(
              'button',
              { class: 'rw-row' + (selected === c ? ' sel' : ''), onclick: () => pick(c) },
              h('i', { class: 'd', style: `background:#${COLORS[c.where].toString(16)};color:#${COLORS[c.where].toString(16)}` }),
              h('span', { class: 't' }, h('b', null, c.name), h('span', null, w === 'Moon' ? 'lunar orbit' : `halo orbit around ${w}`)),
              h('span', { class: 'r' }, h('b', null, Number.isFinite(km) ? `${fmtInt(km / 1000)}k km` : '—'), h('small', null, Number.isFinite(km) ? `${fmt(km / 299792.458, 1)} light-s` : 'no data now')),
            );
          }),
        ];
      }),
    );
  }

  function pick(c: DeepCraft) {
    selected = c;
    const t = app.clock.now();
    const p = sampleAt(c, t);
    const m = moonPositionEci(t);
    const km = p ? Math.hypot(...p) : NaN;
    const fromMoon = p ? Math.hypot(p[0] - m[0], p[1] - m[1], p[2] - m[2]) : NaN;
    detail.hidden = false;
    detail.replaceChildren(
      h('h4', null, c.name),
      h(
        'dl',
        { class: 'kv one' },
        ...([
          ['Where', WHERE_LABEL[c.where]],
          ['From Earth', Number.isFinite(km) ? `${fmtInt(km)} km (${fmt(km / 384400, 2)}× the Moon’s distance)` : '—'],
          ...(c.where === 'Moon' ? [['Above the Moon', Number.isFinite(fromMoon) ? `${fmtInt(fromMoon - 1737.4)} km` : '—'] as [string, string]] : []),
          ['Signal time', Number.isFinite(km) ? `${fmt(km / 299792.458, 2)} s each way` : '—'],
        ] as [string, string][]).map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))),
      ),
      h('a', { href: `https://en.wikipedia.org/wiki/${c.wiki}`, target: '_blank', rel: 'noopener' }, 'Read on Wikipedia ↗'),
    );
    renderList();
    // Frame Earth and the craft side by side.
    const pos = posOf(c, t);
    if (pos) {
      const d = pos.length();
      const side = new THREE.Vector3().crossVectors(pos, new THREE.Vector3(0, 1, 0)).normalize();
      if (!Number.isFinite(side.x)) side.set(1, 0, 0);
      app.flyCameraTo(side.multiplyScalar(d * 1.9).add(pos.clone().multiplyScalar(0.35)).add(new THREE.Vector3(0, d * 0.35, 0)));
    }
  }

  function open() {
    if (app.skyView.active) app.exitSkyView();
    if (app.closeup.active) app.exitCloseup();
    app.exitHistory();
    app.select(null);
    viewing = true;
    app.stage.controls.maxDistance = 1500;
    panel.hidden = false;
    app.updateViewOffset();
    renderList();
    // Side-on to the Sun–Earth line and a little above the ecliptic, far enough out
    // to see both L1 and L2 (about 235 Earth radii either side).
    const s = sunDirectionEci(app.clock.now());
    const sun = eciToScene(s[0], s[1], s[2]).normalize();
    const dir = new THREE.Vector3().crossVectors(eclAxis, sun).normalize().addScaledVector(eclAxis, 0.45).normalize();
    app.flyCameraTo(dir.multiplyScalar(1300), 2400);
  }
  function close() {
    panel.hidden = true;
    app.updateViewOffset();
    viewing = false;
    selected = null;
    detail.hidden = true;
    app.stage.controls.maxDistance = 60;
    if (app.stage.camera.position.length() > 60) app.zoomTo(4.6);
  }
  app.openDeepSpace = open;

  const v = new THREE.Vector3();
  app.on('frame', () => {
    const cam = app.stage.camera;
    const far = cam.position.length() > NEAR;
    const on = app.settings.deepSpace && craft.length > 0 && !app.history && !app.skyView.active && !app.closeup.active && (far || viewing);
    group.visible = on;
    // Near-Earth labels and pins are noise from this far out.
    document.body.classList.toggle('far-view', far);
    if (!on) {
      for (const l of labels) l.el.hidden = true;
      return;
    }
    const t = app.clock.now();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    craft.forEach((c, i) => {
      const p = posOf(c, t, v);
      if (p) pos.setXYZ(i, p.x, p.y, p.z);
      else pos.setXYZ(i, 0, 0, 0);
      craftLabels[i].pos.copy(p ?? new THREE.Vector3(Infinity, 0, 0));
    });
    pos.needsUpdate = true;
    // L1 / L2 along the Sun line; the Moon's orbit for the next four weeks.
    const s = sunDirectionEci(t);
    const sun = eciToScene(s[0], s[1], s[2]).normalize();
    l1.pos.copy(sun).multiplyScalar(L_KM * KM);
    l2.pos.copy(sun).multiplyScalar(-L_KM * KM);
    const la = lgeo.getAttribute('position') as THREE.BufferAttribute;
    la.setXYZ(0, l1.pos.x, l1.pos.y, l1.pos.z);
    la.setXYZ(1, l2.pos.x, l2.pos.y, l2.pos.z);
    la.needsUpdate = true;
    const m = moonPositionEci(t);
    eciToScene(m[0], m[1], m[2], moonLbl.pos);
    if (!moonRing.userData.t || Math.abs(moonRing.userData.t - t) > 6 * 3600e3) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 112; k++) {
        const q = moonPositionEci(t + k * 6 * 3600e3);
        pts.push(eciToScene(q[0], q[1], q[2]));
      }
      moonRing.geometry.dispose();
      moonRing.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      moonRing.userData.t = t;
    }
    if (Math.abs(t - pathsAt) > 86400e3) buildPaths(t);
    const lunar = craft.filter((c) => c.where === 'Moon').length;
    moonLbl.el.textContent = lunar ? `Moon · ${lunar} orbiter${lunar === 1 ? '' : 's'}` : 'Moon';
    for (const p of paths.children) ((p as THREE.Line).material as THREE.LineBasicMaterial).opacity = (p.userData.craft as DeepCraft) === selected ? 0.6 : 0.22;
    // Labels
    const W = app.stage.renderer.domElement.clientWidth;
    const H = app.stage.renderer.domElement.clientHeight;
    for (const l of labels) {
      v.copy(l.pos).project(cam);
      // Lunar orbiters crowd the Moon at this scale: only the selected one is named.
      const crowded = l.craft?.where === 'Moon' && l.craft !== selected;
      l.el.hidden = crowded || !Number.isFinite(v.x) || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      if (!l.el.hidden) l.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((1 - (v.y * 0.5 + 0.5)) * H).toFixed(1)}px)`;
      l.el.classList.toggle('sel', !!l.craft && l.craft === selected);
    }
  });
  app.on('watch', setData);
  window.addEventListener('keydown', (e) => e.key === 'Escape' && !panel.hidden && close());
  setData();
}
