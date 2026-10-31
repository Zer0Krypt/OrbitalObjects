import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { App } from '../app';
import { createEclipseShadow } from '../render/layers';
import { latLonToScene } from '../sim/astro';
import { findEclipses, localSolar, moonElevation, shadow, shadowZone, solarPath, type Eclipse, type SolarEclipse, type Vec } from '../sim/eclipse';
import { fmt, fmtInt, fmtLat, fmtLon, h } from './dom';

const YEARS = 10;
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const utcTime = (ms: number) => new Date(ms).toISOString().slice(11, 16);

export const ECLIPSE_LABEL: Record<string, string> = {
  'solar-total': 'Total solar eclipse',
  'solar-annular': 'Annular solar eclipse',
  'solar-hybrid': 'Hybrid solar eclipse',
  'solar-partial': 'Partial solar eclipse',
  'lunar-total': 'Total lunar eclipse',
  'lunar-partial': 'Partial lunar eclipse',
  'lunar-penumbral': 'Penumbral lunar eclipse',
};
export const eclipseLabel = (e: Eclipse) => ECLIPSE_LABEL[`${e.kind}-${e.type}`];

export interface WatchCtx {
  app: App;
  body: HTMLElement;
  sub: HTMLElement;
  action: HTMLButtonElement;
  foot: HTMLElement;
  close: () => void;
}

/** Path lines on the globe (Earth-fixed), one eclipse at a time. */
function pathLayer(app: App) {
  const mk = (color: number, width: number, opacity: number) => {
    const m = new LineMaterial({ linewidth: width, color, transparent: true, opacity, depthWrite: false });
    return m;
  };
  const mats = [mk(0xffc95a, 2.6, 1), mk(0xffc95a, 1.4, 0.8), mk(0xdfe7ff, 1, 0.5)];
  const res = () => {
    const c = app.stage.renderer.domElement;
    for (const m of mats) m.resolution.set(c.clientWidth, c.clientHeight);
  };
  res();
  app.stage.onResize(res);
  const lines: Line2[] = [];
  const clear = () => {
    for (const l of lines) {
      l.geometry.dispose();
      app.earth.group.remove(l);
    }
    lines.length = 0;
  };
  const add = (pts: [number, number][], mat: LineMaterial) => {
    // Split where the line leaves the Earth (NaN) or wraps around the date line.
    let seg: number[] = [];
    const v = new THREE.Vector3();
    const flush = () => {
      if (seg.length >= 6) {
        const g = new LineGeometry();
        g.setPositions(seg);
        const l = new Line2(g, mat);
        l.frustumCulled = false;
        l.renderOrder = 6;
        app.earth.group.add(l);
        lines.push(l);
      }
      seg = [];
    };
    for (const [la, lo] of pts) {
      if (!Number.isFinite(la)) {
        flush();
        continue;
      }
      seg.push(...latLonToScene(la, lo, 1.0018, v).toArray());
    }
    flush();
  };
  return {
    show(e: SolarEclipse | null) {
      clear();
      if (!e) return;
      const p = solarPath(e);
      add(p.central.map(([a, b]) => [a, b]), mats[0]);
      for (const l of p.limits) add(l, mats[1]);
      for (const l of p.partial) add(l, mats[2]);
    },
  };
}

export function mountEclipses(app: App) {
  let list: Eclipse[] | null = null;
  const all = () => (list ??= findEclipses(Date.now() - 2 * 86400e3, Date.now() + YEARS * 365.25 * 86400e3));
  const solar = () => all().filter((e): e is SolarEclipse => e.kind === 'solar');
  /** The solar eclipse nearest the sim time (for the shadow layer). */
  let near: SolarEclipse | null = null;
  let nearAt = NaN;
  const nearest = () => {
    const t = app.clock.now();
    if (!(Math.abs(t - nearAt) < 3600e3)) {
      nearAt = t;
      const span = YEARS * 365.25 * 86400e3;
      // Outside the precomputed window (scrubbed far away), search around the sim time.
      const pool = t > Date.now() - 2 * 86400e3 && t < Date.now() + span ? solar() : (findEclipses(t - 2 * 86400e3, t + 2 * 86400e3).filter((e) => e.kind === 'solar') as SolarEclipse[]);
      near = pool.find((e) => t < e.end + 3600e3 && t > e.start - 3600e3) ?? null;
    }
    return near;
  };
  createEclipseShadow(app, nearest);
  const paths = pathLayer(app);

  // ---------- local circumstances, filled in lazily ----------
  const local = new Map<number, string>();
  let localFor = '';
  const localText = (e: Eclipse) => {
    const o = app.observer;
    if (!o) return '';
    const key = `${o.lat},${o.lon}`;
    if (key !== localFor) {
      local.clear();
      localFor = key;
    }
    if (!local.has(e.max)) {
      if (e.kind === 'solar') {
        const c = localSolar(e, o.lat, o.lon, o.alt);
        local.set(
          e.max,
          !c
            ? 'Not seen from your location'
            : c.centralStart
              ? `${e.type === 'annular' ? 'Annular' : 'Total'} from your location! ${timeFmt.format(c.centralStart)}–${timeFmt.format(c.centralEnd! + 20e3)}`
              : `From you: ${Math.round(c.obscuration * 100)}% of the Sun covered at ${timeFmt.format(c.max)}${c.sunEl < 3 ? ' (Sun very low)' : ''}`,
        );
      } else {
        const el = moonElevation(o.lat, o.lon, e.max);
        local.set(e.max, el > 0 ? `Visible from you: Moon ${Math.round(el)}° up at ${timeFmt.format(e.max)}` : 'Moon below your horizon at greatest eclipse');
      }
    }
    return local.get(e.max)!;
  };

  // ---------- HUD ----------
  const hud = h('div', { class: 'hud-card eclipse-hud', hidden: true, role: 'region', 'aria-label': 'Eclipse' });
  document.getElementById('app')!.append(hud);
  let current: Eclipse | null = null;
  const live = h('p', { class: 'sky-hint', style: 'margin:6px 0 0' });
  let inShadow: number[] = [];
  let liveAt = 0;

  function open(e: Eclipse) {
    current = e;
    app.exitHistory();
    app.clock.setRate(e.kind === 'solar' ? 60 : 30);
    app.clock.setPaused(false);
    app.clock.set(e.kind === 'solar' ? e.max - 45 * 60e3 : e.max - 60 * 60e3);
    paths.show(e.kind === 'solar' ? e : null);
    app.flyToLatLon(e.at.lat, e.at.lon, e.kind === 'solar' ? 3 : 3.6);
    const step = (dt: number) => h('button', { class: 'btn', onclick: () => app.clock.set(app.clock.now() + dt) }, dt > 0 ? `+${dt / 60e3} min` : `−${-dt / 60e3} min`);
    const facts =
      e.kind === 'solar'
        ? `Greatest eclipse ${utcTime(e.max)} UTC at ${fmtLat(e.at.lat)}, ${fmtLon(e.at.lon)} · magnitude ${fmt(e.magnitude, 3)}${e.type === 'partial' ? '' : ` · the gold line is the centre, the paler ones the edges of ${e.type === 'annular' ? 'annularity' : 'totality'}; the faint ones bound the partial eclipse`}`
        : `Greatest eclipse ${utcTime(e.max)} UTC · umbral magnitude ${fmt(e.magnitude, 3)} · seen from wherever the Moon is up then (the night side)`;
    const kids: (HTMLElement | null)[] = [
      h('button', { class: 'close', 'aria-label': 'Close', onclick: () => closeHud() }, '×'),
      h('div', { class: 'eyebrow' }, e.kind === 'solar' ? 'Solar eclipse' : 'Lunar eclipse'),
      h('h3', null, eclipseLabel(e), h('small', null, dateFmt.format(e.max))),
      h('p', { class: 'sky-hint', style: 'margin:4px 0 0' }, facts),
      app.observer ? h('p', { class: 'sky-hint', style: 'margin:4px 0 0' }, h('b', null, localText(e))) : null,
      e.kind === 'solar' ? live : null,
      h('div', { class: 'sky-actions' }, step(-30 * 60e3), h('button', { class: 'btn', onclick: () => (app.clock.set(e.max), app.flyToLatLon(e.at.lat, e.at.lon, e.kind === 'solar' ? 3 : 3.6)) }, 'Greatest'), step(30 * 60e3)),
      h('p', { class: 'hud-note' }, 'Paths are computed in your browser from a lunar theory good to roughly 10–30 km: fine for a map, not for choosing a spot at the edge of totality.'),
    ];
    hud.replaceChildren(...kids.filter((x): x is HTMLElement => !!x));
    hud.hidden = false;
    document.body.classList.add('hud-open');
    liveAt = 0;
    tickLive();
  }
  function closeHud() {
    current = null;
    hud.hidden = true;
    document.body.classList.remove('hud-open');
    paths.show(null);
    app.clock.setRate(1);
  }

  /** Satellites inside the Moon's shadow right now. */
  function tickLive() {
    const e = current;
    if (!e || e.kind !== 'solar' || hud.hidden) return;
    const now = performance.now();
    if (now - liveAt < 1500) return;
    liveAt = now;
    const t = app.clock.now();
    if (t < e.start || t > e.end) {
      live.textContent = t < e.start ? `The Moon’s shadow reaches Earth at ${timeFmt.format(e.start)}.` : 'The shadow has left the Earth.';
      inShadow = [];
      return;
    }
    const sh = shadow(t);
    const p = { x: 0, y: 0, z: 0 };
    let pen = 0;
    const umbra: number[] = [];
    const all: number[] = [];
    for (let i = 0; i < app.liveCount; i++) {
      if (!app.prop.valid[i]) continue;
      app.prop.position(i, t, p);
      const v: Vec = [p.x * 6371, -p.z * 6371, p.y * 6371];
      const z = shadowZone(sh, v);
      if (z) {
        all.push(app.cat.objects[i].norad);
        if (z === 2) umbra.push(i);
        else pen++;
      }
    }
    inShadow = all;
    live.replaceChildren(
      `In the Moon’s shadow now: ${fmtInt(umbra.length)} satellites in the ${e.type === 'annular' ? 'antumbra' : 'umbra'}, ${fmtInt(pen)} in the penumbra. `,
      all.length ? h('button', { class: 'link', onclick: () => app.setFilters({ ids: new Set(inShadow), idsLabel: 'In the Moon’s shadow' }) }, 'Show them') : '',
    );
  }
  app.on('frame', tickLive);

  // ---------- watch tab ----------
  function render(ctx: WatchCtx) {
    const now = Date.now();
    const upcoming = all().filter((e) => e.max > now - 6 * 3600e3);
    ctx.sub.textContent = `${upcoming.filter((e) => e.kind === 'solar').length} solar and ${upcoming.filter((e) => e.kind === 'lunar').length} lunar eclipses in the next ${YEARS} years`;
    ctx.action.hidden = true;
    ctx.foot.textContent = 'Computed in your browser from the positions of the Sun and Moon. Click a solar eclipse to see its path and the Moon’s shadow crossing the Earth (and which satellites fly through it); during any eclipse the shadow is drawn on the globe.';
    ctx.body.replaceChildren(
      ...upcoming.map((e) => {
        const sub = h('span', null, e.kind === 'solar' ? `${fmtLat(e.at.lat)}, ${fmtLon(e.at.lon)} · mag ${fmt(e.magnitude, 3)}` : `magnitude ${fmt(e.magnitude, 2)}`);
        const row = h(
          'button',
          {
            class: 'rw-row' + (e.max - now < 30 * 86400e3 ? ' soon' : ''),
            title: 'Show it on the globe',
            onclick: () => {
              ctx.close();
              open(e);
            },
          },
          h('i', { class: 'd', style: `background:${e.kind === 'solar' ? '#ffc95a' : '#d9663f'};color:${e.kind === 'solar' ? '#ffc95a' : '#d9663f'}` }),
          h('span', { class: 't' }, h('b', null, eclipseLabel(e)), sub),
          h('span', { class: 'r' }, h('b', null, dateFmt.format(e.max)), h('small', null, `${utcTime(e.max)} UTC`)),
        );
        if (app.observer)
          setTimeout(() => {
            if (row.isConnected) sub.append(h('em', { class: 'ecl-local' }, ` · ${localText(e)}`));
          }, 0);
        return row;
      }),
    );
  }

  return { render, count: () => all().filter((e) => e.max > Date.now() && e.max - Date.now() < 365 * 86400e3).length, open };
}

