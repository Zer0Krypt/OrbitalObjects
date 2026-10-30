import * as THREE from 'three';
import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { COV_H, COV_W, CoverageLayer, rampColor } from '../render/coverage';
import { DebrisCloud } from '../render/debrisCloud';

/** Shared bottom-left stack for map legends. */
function legendStack() {
  let el = document.querySelector<HTMLElement>('.map-legends');
  if (!el) {
    el = h('div', { class: 'map-legends' });
    document.getElementById('app')!.append(el);
  }
  return el;
}
import { fmtInt, h } from './dom';

/** Constellations with a coverage map: membership, lowest useful elevation, satellites needed. */
export const CONSTELLATIONS: { key: string; label: string; groups?: string[]; name?: RegExp; minEl: number; need: number; note: string }[] = [
  { key: 'starlink', label: 'Starlink', groups: ['starlink'], minEl: 25, need: 1, note: 'user terminals look at least 25° up' },
  { key: 'oneweb', label: 'OneWeb', groups: ['oneweb'], minEl: 25, need: 1, note: 'at least 25° up' },
  { key: 'kuiper', label: 'Project Kuiper', groups: ['kuiper'], minEl: 35, need: 1, note: 'at least 35° up' },
  { key: 'iridium', label: 'Iridium', name: /^IRIDIUM \d/, minEl: 8.2, need: 1, note: 'at least 8.2° up' },
  { key: 'globalstar', label: 'Globalstar', groups: ['globalstar'], minEl: 10, need: 1, note: 'at least 10° up' },
  { key: 'gps', label: 'GPS', groups: ['gps-ops'], minEl: 10, need: 4, note: 'a fix needs 4 satellites 10° or more up' },
  { key: 'galileo', label: 'Galileo', groups: ['galileo'], minEl: 10, need: 4, note: 'a fix needs 4 satellites 10° or more up' },
  { key: 'gnss', label: 'All GNSS', groups: ['gps-ops', 'glo-ops', 'galileo', 'beidou'], minEl: 10, need: 4, note: 'GPS, GLONASS, Galileo and BeiDou together' },
];

/** The coverage heatmap on the globe, its legend, and "how many above you". */
export function mountCoverage(app: App) {
  const layer = new CoverageLayer();
  app.earth.group.add(layer.mesh);

  const title = h('b');
  const scale = h('canvas', { class: 'cov-scale', width: 160, height: 8 });
  const lo = h('span');
  const hi = h('span');
  const stats = h('p');
  const you = h('p', { class: 'cov-you' });
  const card = h(
    'div',
    { class: 'cov-legend', hidden: true, role: 'status' },
    h('div', { class: 'cov-head' }, title, h('button', { class: 'icon-mini', 'aria-label': 'Hide coverage map', title: 'Hide coverage map', onclick: () => app.setSetting('coverage', '') }, '×')),
    scale,
    h('div', { class: 'cov-ticks' }, lo, hi),
    stats,
    you,
  );
  legendStack().append(card);

  let members: SatObject[] = [];
  let memberKey = '';
  let last = 0;
  let lastSim = 0;
  const v = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);

  function current() {
    return CONSTELLATIONS.find((c) => c.key === app.settings.coverage) ?? null;
  }
  function resolve() {
    const c = current();
    if (!c || memberKey === c.key) return;
    memberKey = c.key;
    const gi = (c.groups ?? []).map((k) => app.cat.groups.findIndex((g) => g.key === k)).filter((i) => i >= 0);
    members = app.cat.objects.slice(0, app.liveCount).filter((o) => (gi.length && o.groups.some((g) => gi.includes(g))) || (c.name && o.type === 'P' && c.name.test(o.name)));
  }

  function refresh() {
    const c = current();
    if (!c) return;
    resolve();
    const t = app.clock.now();
    const rot = -app.earth.group.rotation.y;
    const sats: { x: number; y: number; z: number; alt: number }[] = [];
    for (const o of members) {
      if (!app.hasPosition(o)) continue;
      app.scenePosition(o, v, t).applyAxisAngle(axis, rot);
      const r = v.length();
      sats.push({ x: v.x / r, y: v.y / r, z: v.z / r, alt: (r - 1) * 6371 });
    }
    const st = layer.update(sats, c.minEl, c.need);
    title.textContent = `${c.label} coverage`;
    const top = Math.max(c.need * 2, st.max);
    const g = scale.getContext('2d')!;
    for (let x = 0; x < 160; x++) {
      const [r, gg, b] = rampColor(x / 159);
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(x, 0, 1, 8);
    }
    lo.textContent = c.need > 1 ? `${c.need - 1} or fewer (faint)` : '1';
    hi.textContent = `${top} in view`;
    stats.textContent = `${fmtInt(sats.length)} satellites · ${Math.round(st.covered * 100)}% of Earth sees ${c.need > 1 ? `${c.need}+` : 'at least one'} · average ${st.mean.toFixed(1)} · ${c.note}.`;
    if (app.observer) {
      let n = 0;
      for (const o of members) if (app.skyEl[o.idx] >= c.minEl) n++;
      you.hidden = false;
      you.replaceChildren('From your location: ', h('b', null, fmtInt(n)), ` above ${c.minEl}° right now${c.need > 1 ? (n >= c.need ? ' — enough for a fix' : ' — not enough for a fix') : ''}.`);
    } else you.hidden = true;
  }

  function sync() {
    const on = !!current() && !app.history && !app.skyView.active && !app.closeup.active;
    layer.mesh.visible = on;
    card.hidden = !current() || app.skyView.active;
    if (on) {
      last = 0;
      refresh();
    }
  }
  app.on('settings', sync);
  app.on('history', sync);
  app.on('skyview', sync);
  app.on('closeup', sync);
  app.on('frame', () => {
    if (!layer.mesh.visible) return;
    const t = app.clock.now();
    // About once a second, or straight away after a jump in time.
    if (performance.now() - last > 1000 || Math.abs(t - lastSim) > 120e3) {
      last = performance.now();
      lastSim = t;
      refresh();
    }
  });
  sync();
  return { layer, grid: [COV_W, COV_H] as const };
}

/** Debris density as a glowing cloud around Earth (Layers → Debris density cloud). */
export function mountDebrisCloud(app: App) {
  const cloud = new DebrisCloud();
  app.stage.scene.add(cloud.mesh);
  const note = h('p');
  const card = h(
    'div',
    { class: 'cov-legend', hidden: true, role: 'status' },
    h('div', { class: 'cov-head' }, h('b', null, 'Debris density'), h('button', { class: 'icon-mini', 'aria-label': 'Hide debris density', title: 'Hide debris density', onclick: () => app.setSetting('debrisCloud', false) }, '×')),
    h('div', { class: 'cov-scale debris' }),
    h('div', { class: 'cov-ticks' }, h('span', null, 'sparse'), h('span', null, 'densest')),
    note,
  );
  legendStack().append(card);
  const pts = new Float32Array(app.cat.objects.length * 3);
  const v = new THREE.Vector3();
  let last = 0;
  let lastSim = 0;
  function refresh() {
    const t = app.clock.now();
    let n = 0;
    for (let i = 0; i < app.liveCount; i++) {
      const o = app.cat.objects[i];
      if ((o.type !== 'D' && o.type !== 'R') || !app.hasPosition(o)) continue;
      app.scenePosition(o, v, t);
      pts[n * 3] = v.x;
      pts[n * 3 + 1] = v.y;
      pts[n * 3 + 2] = v.z;
      n++;
    }
    cloud.update(pts, n);
    note.textContent = `${fmtInt(n)} pieces of debris and spent stages, as a haze by altitude and latitude. Densest around ${Math.round(cloud.peakAlt / 10) * 10} km, about ${cloud.peak.toFixed(cloud.peak < 1 ? 2 : 1)} objects per million km³ (tracked objects only).`;
  }
  function sync() {
    const on = app.settings.debrisCloud && !app.history && !app.skyView.active && !app.closeup.active;
    cloud.mesh.visible = on;
    card.hidden = !app.settings.debrisCloud || app.skyView.active;
    if (on) {
      last = performance.now();
      refresh();
    }
  }
  app.on('settings', sync);
  app.on('history', sync);
  app.on('skyview', sync);
  app.on('closeup', sync);
  app.on('frame', () => {
    if (!cloud.mesh.visible) return;
    const t = app.clock.now();
    if (performance.now() - last > 5000 || Math.abs(t - lastSim) > 600e3) {
      last = performance.now();
      lastSim = t;
      refresh();
    }
  });
  sync();
}
