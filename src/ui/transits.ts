import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { satrecFor } from '../render/orbits';
import { latLonToScene } from '../sim/astro';
import { compass } from '../sim/observer';
import { findTransits, type Transit } from '../sim/transits';
import { fmt, fmtInt, h } from './dom';

const DAYS = 14;
const MAX_KM = 100;
const when = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const SUN = '☀';
const MOON = '☾';

/** The centre line of one transit drawn on the globe (one at a time). */
let shown: { line: Line2; edges: Line2[]; mat: LineMaterial; edgeMat: LineMaterial } | null = null;
function lineLayer(app: App) {
  if (shown) return shown;
  const mat = new LineMaterial({ linewidth: 2.4, color: 0xffd27a, transparent: true, depthWrite: false });
  const edgeMat = new LineMaterial({ linewidth: 1, color: 0xffd27a, transparent: true, opacity: 0.45, depthWrite: false, dashed: false });
  const res = () => {
    const c = app.stage.renderer.domElement;
    mat.resolution.set(c.clientWidth, c.clientHeight);
    edgeMat.resolution.set(c.clientWidth, c.clientHeight);
  };
  res();
  app.stage.onResize(res);
  const line = new Line2(new LineGeometry(), mat);
  const edges = [new Line2(new LineGeometry(), edgeMat), new Line2(new LineGeometry(), edgeMat)];
  for (const l of [line, ...edges]) {
    l.frustumCulled = false;
    l.renderOrder = 6;
    l.visible = false;
    app.earth.group.add(l);
  }
  shown = { line, edges, mat, edgeMat };
  return shown;
}

/** Draw a transit's centre line and the edges of the strip it is visible from. */
export function showTransitLine(app: App, tr: Transit | null) {
  const L = lineLayer(app);
  if (!tr) {
    L.line.visible = L.edges[0].visible = L.edges[1].visible = false;
    return;
  }
  const color = tr.body === 'sun' ? 0xffd27a : 0xcfe0ff;
  L.mat.color.set(color);
  L.edgeMat.color.set(color);
  const v = new THREE.Vector3();
  const pts = tr.line.map(([la, lo]) => latLonToScene(la, lo, 1.0015, v).toArray()).flat();
  const set = (l: Line2, p: number[]) => {
    const g = new LineGeometry();
    g.setPositions(p);
    l.geometry.dispose();
    l.geometry = g;
    l.visible = p.length >= 6;
  };
  set(L.line, pts);
  // Edges: offset each point sideways by the strip's half-width.
  const off = tr.halfWidthKm / 6371;
  for (const [i, sign] of [
    [0, 1],
    [1, -1],
  ] as const) {
    const e: number[] = [];
    for (let k = 0; k < tr.line.length; k++) {
      const a = tr.line[Math.max(0, k - 1)];
      const b = tr.line[Math.min(tr.line.length - 1, k + 1)];
      const p = latLonToScene(tr.line[k][0], tr.line[k][1], 1);
      const dir = latLonToScene(b[0], b[1], 1).sub(latLonToScene(a[0], a[1], 1)).normalize();
      const side = new THREE.Vector3().crossVectors(p, dir).normalize().multiplyScalar(sign * off);
      e.push(...p.add(side).normalize().multiplyScalar(1.0015).toArray());
    }
    set(L.edges[i], e);
  }
}

function describe(tr: Transit) {
  const dur = tr.duration < 1 ? `${fmt(tr.duration, 2)} s` : `${fmt(tr.duration, 1)} s`;
  return tr.fromHere
    ? `Crosses the ${tr.body === 'sun' ? 'Sun' : 'Moon'} from where you are · ${dur}`
    : `Centre line ${fmtInt(tr.lineKm)} km ${compass(tr.lineAz)} of you · visible within ±${fmt(tr.halfWidthKm, 1)} km of it · ${dur}`;
}

/** One transit as a clickable row: jumps to it and draws its centre line. */
function row(app: App, o: SatObject, tr: Transit, withName: boolean) {
  return h(
    'button',
    {
      class: 'pass tr-row' + (tr.fromHere ? ' vis' : ''),
      title: 'Show the centre line and jump to a minute before',
      onclick: () => {
        app.exitHistory();
        app.select(o);
        app.setFollowing(false);
        app.clock.setRate(1);
        app.clock.set(tr.t - 60e3);
        showTransitLine(app, tr);
        const mid = tr.line[Math.floor(tr.line.length / 2)];
        app.flyToLatLon(mid[0], mid[1], 1.6);
      },
    },
    h('div', { class: 'tr-body' }, tr.body === 'sun' ? SUN : MOON),
    h('div', { class: 'tr-main' }, h('b', null, `${withName ? `${o.name.replace(/\s*\(.*\)$/, '')} · ` : ''}${when.format(tr.t)}`), h('small', null, describe(tr))),
    h('div', { class: 'pass-max' }, `${Math.round(tr.bodyEl)}°`, h('small', null, tr.body)),
  );
}

/** Find transits for several objects, a pass at a time, without freezing the page. */
function search(app: App, objs: SatObject[], onDone: (found: { o: SatObject; tr: Transit }[]) => void, onProgress: (k: number) => void) {
  const found: { o: SatObject; tr: Transit }[] = [];
  let k = 0;
  const from = app.clock.now();
  const step = () => {
    if (k >= objs.length || !app.observer) return onDone(found.sort((a, b) => a.tr.t - b.tr.t));
    const o = objs[k++];
    const rec = satrecFor(o);
    if (rec) for (const tr of findTransits(rec, app.observer, from, DAYS, o.period, MAX_KM)) found.push({ o, tr });
    onProgress(k);
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

/** "Sun & Moon transits" section in the info panel (low orbits, with a location set). */
export function transitSection(app: App, o: SatObject) {
  if (!app.observer || o.decay || o.period > 200) return null;
  const list = h('div', { class: 'passes' });
  const btn = h('button', { class: 'btn' }, `Find transits in the next ${DAYS} days`);
  const note = h('p', { class: 'sky-hint', style: 'margin:6px 0 0' }, `When it crosses the Sun or Moon as seen from within ${MAX_KM} km of you. Crossings last about a second: a treat for photographers, with a solar filter for the Sun.`);
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Searching…';
    search(
      app,
      [o],
      (found) => {
        btn.hidden = true;
        list.replaceChildren(
          ...(found.length ? found.map((f) => row(app, o, f.tr, false)) : [h('p', { class: 'sky-hint', style: 'margin:0' }, `No transits within ${MAX_KM} km of you in the next ${DAYS} days.`)]),
        );
      },
      () => {},
    );
  };
  return h('div', { class: 'isec' }, h('h3', null, 'Sun & Moon transits', h('span', null, `${DAYS} days · within ${MAX_KM} km`)), list, btn, note);
}

/** Transit finder in the sky section: stations, Hubble and My satellites in low orbit. */
export function mountTransitFinder(app: App) {
  const list = h('div', { class: 'passes' });
  const status = h('p', { class: 'sky-hint', style: 'margin:0' }, 'When the ISS, Tiangong or Hubble (and your satellites) cross the Sun or Moon near you.');
  const btn = h('button', { class: 'btn' }, 'Find transits');
  const clear = h('button', { class: 'chip', hidden: true, onclick: () => (showTransitLine(app, null), (clear.hidden = true)) }, 'Hide centre line');
  const el = h('div', { class: 'planner' }, h('div', { class: 'pass-head' }, 'Sun & Moon transits', h('span', null, `next ${DAYS} days`)), status, list, h('div', { class: 'sky-actions' }, btn, clear));
  btn.onclick = () => {
    if (!app.observer) return;
    const objs = [25544, 48274, 20580]
      .map((n) => app.cat.byNorad.get(n))
      .concat(app.watchlistObjects())
      .filter((o, i, a): o is SatObject => !!o && a.indexOf(o) === i && app.isLiveObject(o) && o.period < 200);
    btn.disabled = true;
    search(
      app,
      objs,
      (found) => {
        btn.disabled = false;
        btn.textContent = 'Search again';
        status.textContent = found.length
          ? `${found.length} within ${MAX_KM} km of you. Click one to see its centre line; stand inside the strip to see it cross the disc.`
          : `None within ${MAX_KM} km of you in the next ${DAYS} days.`;
        list.replaceChildren(...found.slice(0, 12).map((f) => row(app, f.o, f.tr, true)));
        list.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => (clear.hidden = false)));
      },
      (k) => (status.textContent = `Checking ${k} of ${objs.length}…`),
    );
  };
  app.on('observer', () => {
    list.replaceChildren();
    showTransitLine(app, null);
  });
  return el;
}
