import type { App } from '../app';
import { TYPE_LABEL, type SatObject } from '../data/catalog';
import { satrecFor, stateAt } from '../render/orbits';
import { gmst, KM } from '../sim/astro';
import { apparentMagnitude, describeMag, fmtMag, phaseAngle } from '../sim/brightness';
import { compass, lookAngles, observerFrame, sunElevation, sunlitScene, sunScene } from '../sim/observer';
import { h, icon } from './dom';
import { ICON_SKY } from './skyview';

const DIRS: [string, number][] = [
  ['N', 0],
  ['NE', 45],
  ['E', 90],
  ['SE', 135],
  ['S', 180],
  ['SW', 225],
  ['W', 270],
  ['NW', 315],
];
const HEIGHTS: [string, number][] = [
  ['Low', 15],
  ['Halfway up', 40],
  ['High', 65],
  ['Overhead', 88],
];
/** How far from where you looked a candidate may be (deg). */
const RADIUS = 25;
const FAINTEST = 6.5;

interface Hit {
  o: SatObject;
  az: number;
  el: number;
  mag: number;
  sep: number;
  heading: number;
  range: number;
  score: number;
}
interface Train {
  launch: string;
  members: Hit[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const timeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** Angle (deg) between two alt-az directions. */
function separation(az1: number, el1: number, az2: number, el2: number) {
  const r = Math.PI / 180;
  const c = Math.sin(el1 * r) * Math.sin(el2 * r) + Math.cos(el1 * r) * Math.cos(el2 * r) * Math.cos((az1 - az2) * r);
  return Math.acos(Math.max(-1, Math.min(1, c))) / r;
}

/** Signed difference between headings, 0..180. */
const headingDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Everything sunlit and bright enough near a direction at a moment, best match first. */
export function identify(app: App, t: number, look: { az: number; el: number } | null, moving: number | null) {
  const ob = app.observer!;
  const f = observerFrame(ob, gmst(t));
  const f2 = observerFrame(ob, gmst(t + 30e3));
  const sun = sunScene(t);
  const sunEl = sunElevation(f, t);
  const hits: Hit[] = [];
  for (let i = 0; i < app.liveCount; i++) {
    const o = app.cat.objects[i];
    if (!app.launched(i)) continue;
    const rec = satrecFor(o);
    if (!rec) continue;
    const st = stateAt(rec, t);
    if (!st) continue;
    const p = st.position;
    const x = p.x * KM;
    const y = p.z * KM;
    const z = -p.y * KM;
    const la = lookAngles(f, x, y, z);
    if (la.el < 3) continue;
    const sep = look ? separation(la.az, la.el, look.az, look.el) : 0;
    if (sep > RADIUS) continue;
    if (!sunlitScene(x, y, z, sun)) continue;
    const mag = apparentMagnitude(app.stdMag(o).mag, la.range, phaseAngle([x, y, z], f.p, sun), la.el);
    if (mag > FAINTEST) continue;
    // Direction of travel across the sky, 30 s later.
    const st2 = stateAt(rec, t + 30e3);
    let heading = NaN;
    if (st2) {
      const q = st2.position;
      const lb = lookAngles(f2, q.x * KM, q.z * KM, -q.y * KM);
      const r = Math.PI / 180;
      const e1 = Math.cos(la.el * r) * Math.sin(la.az * r);
      const n1 = Math.cos(la.el * r) * Math.cos(la.az * r);
      const e2 = Math.cos(lb.el * r) * Math.sin(lb.az * r);
      const n2 = Math.cos(lb.el * r) * Math.cos(lb.az * r);
      heading = ((Math.atan2(e2 - e1, n2 - n1) / r) % 360 + 360) % 360;
    }
    // Close to where you looked, bright, and moving the right way.
    let score = sep / 5 + Math.max(0, mag - 1) * 1.2;
    if (moving !== null && Number.isFinite(heading)) score += (headingDiff(heading, moving) / 45) * 2;
    hits.push({ o, az: la.az, el: la.el, mag, sep, heading, range: la.range, score });
  }
  hits.sort((a, b) => a.score - b.score);

  // Starlink "trains": several satellites from one launch in a line, soon after launch.
  const byLaunch = new Map<string, Hit[]>();
  for (const x of hits) {
    if (!/^STARLINK/.test(x.o.name)) continue;
    const key = x.o.cospar.slice(0, 8);
    if (!byLaunch.has(key)) byLaunch.set(key, []);
    byLaunch.get(key)!.push(x);
  }
  const trains: Train[] = [...byLaunch.entries()]
    .filter(([, m]) => m.length >= 4 && m.some((x) => x.o.perigee < 450))
    .map(([launch, members]) => ({ launch, members }))
    .sort((a, b) => b.members.length - a.members.length);
  return { hits, trains, sunEl };
}

export function mountIdentify(app: App) {
  const when = h('input', { type: 'datetime-local', class: 'id-when', 'aria-label': 'When you saw it' });
  const ago = (min: number) => h('button', { class: 'chip', onclick: () => ((when.value = toLocalInput(Date.now() - min * 60e3)), run()) }, min ? `${min} min ago` : 'Just now');
  let dir: number | null = null;
  let height = 40;
  let moving: number | null = null;
  const dirBtns = DIRS.map(([l, az]) => h('button', { class: 'chip', 'data-az': String(az), onclick: () => ((dir = dir === az ? null : az), sync(), run()) }, l));
  const hBtns = HEIGHTS.map(([l, el]) => h('button', { class: 'chip', 'data-el': String(el), onclick: () => ((height = el), sync(), run()) }, l));
  const movBtns = DIRS.map(([l, az]) => h('button', { class: 'chip', 'data-az': String(az), title: `Moving toward the ${l}`, onclick: () => ((moving = moving === az ? null : az), sync(), run()) }, `→${l}`));
  const useView = h('button', { class: 'btn', hidden: true, onclick: () => ((dir = Math.round(app.skyView.az)), (height = Math.round(app.skyView.el)), sync(), run()) }, 'Where I\'m looking in sky view');
  const results = h('div', { class: 'scroll rw-body id-results' });
  const note = h('p', { class: 'rw-foot' });
  const panel = h(
    'div',
    { class: 'reentry-panel identify-panel', hidden: true, role: 'dialog', 'aria-label': 'What did I see?' },
    h(
      'div',
      { class: 'rw-head id-head' },
      h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 'eyebrow' }, 'Identify'), h('h3', { class: 'id-title' }, 'What did I just see?'), h('p', { class: 'rw-sub' }, 'Tell us when and where you looked; we check every tracked object that was sunlit and bright enough at that moment.')),
      h('button', { class: 'icon-mini', 'aria-label': 'Close', onclick: () => open(false) }, '×'),
    ),
    h(
      'div',
      { class: 'id-form' },
      h('label', null, h('span', null, 'When'), when),
      h('div', { class: 'chips' }, ago(0), ago(5), ago(15), ago(30)),
      h('label', null, h('span', null, 'Direction'), h('small', null, 'which way you were facing (leave empty if unsure)')),
      h('div', { class: 'chips dirs' }, ...dirBtns),
      h('div', { class: 'chips' }, ...hBtns),
      useView,
      h('label', null, h('span', null, 'Moving'), h('small', null, 'optional: which way it was heading')),
      h('div', { class: 'chips dirs' }, ...movBtns),
    ),
    results,
    note,
  );
  document.getElementById('app')!.append(panel);

  function sync() {
    for (const b of dirBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.az) === dir));
    for (const b of hBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.el) === height));
    for (const b of movBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.az) === moving));
    useView.hidden = !app.skyView.active;
  }

  let job = 0;
  function run() {
    if (!app.observer) {
      results.replaceChildren(h('p', { class: 'sky-hint', style: 'margin:14px' }, 'Set your location first (Your sky, in the explorer).'));
      return;
    }
    const t = Date.parse(when.value);
    if (!Number.isFinite(t)) return;
    const id = ++job;
    results.replaceChildren(h('p', { class: 'sky-hint', style: 'margin:14px' }, 'Checking every tracked object…'));
    // Let the message paint; the first search also builds every object's propagator.
    setTimeout(() => {
      if (id !== job) return;
      const look = dir === null ? null : { az: dir, el: height };
      const { hits, trains, sunEl } = identify(app, t, look, moving);
      render(t, hits, trains, sunEl, look);
    }, 30);
  }

  function pick(o: SatObject, t: number, x?: { az: number; el: number }) {
    app.exitHistory();
    app.clock.setPaused(true);
    app.clock.set(t);
    if (app.skyView.active && x) {
      app.skyView.az = x.az;
      app.skyView.el = x.el;
    }
    app.select(o, { fly: !app.skyView.active });
  }

  function render(t: number, hits: Hit[], trains: Train[], sunEl: number, look: { az: number; el: number } | null) {
    const rows: HTMLElement[] = [];
    if (sunEl > -3) rows.push(h('p', { class: 'sky-warn', style: 'margin:10px 14px' }, `The Sun was ${sunEl > 0 ? 'up' : 'only just below the horizon'} then (${Math.round(sunEl)}°). Satellites are hard to see until it's about 6° down, so this may have been a plane, a balloon or a planet.`));
    for (const tr of trains.slice(0, 2)) {
      const first = tr.members.sort((a, b) => a.score - b.score)[0];
      rows.push(
        h(
          'button',
          {
            class: 'rw-row id-row train',
            onclick: () => {
              app.setFilters({ ids: new Set(tr.members.map((m) => m.o.norad)), idsLabel: `Starlink train ${tr.launch}` });
              pick(first.o, t, first);
            },
          },
          h('i', { class: 'd', style: 'background:#ffd27a;color:#ffd27a' }),
          h('div', { class: 't' }, h('b', null, `Starlink train · ${tr.members.length} satellites`), h('span', null, `launch ${tr.launch} · a line of dots moving ${compass(first.heading)}, typical in the weeks after launch`)),
          h('div', { class: 'r' }, h('b', null, fmtMag(Math.min(...tr.members.map((m) => m.mag)))), h('small', null, 'mag')),
        ),
      );
    }
    for (const x of hits.slice(0, 12)) {
      const name = x.o.name.replace(/\s*\(.*\)$/, '');
      rows.push(
        h(
          'button',
          { class: 'rw-row id-row', onclick: () => pick(x.o, t, x), title: `${x.o.name}: ${describeMag(x.mag)}` },
          h('i', { class: 'd', style: `background:${app.colorsHex[x.o.idx]};color:${app.colorsHex[x.o.idx]}` }),
          h(
            'div',
            { class: 't' },
            h('b', null, name),
            h('span', null, `${TYPE_LABEL[x.o.type]} · ${Math.round(x.el)}° up in the ${compass(x.az)}${Number.isFinite(x.heading) ? ` · moving ${compass(x.heading)}` : ''}${look ? ` · ${Math.round(x.sep)}° off` : ''}`),
          ),
          h('div', { class: 'r' }, h('b', null, fmtMag(x.mag)), h('small', null, describeMag(x.mag))),
        ),
      );
    }
    if (!hits.length) rows.push(h('p', { class: 'sky-hint', style: 'margin:14px' }, look ? `Nothing sunlit and brighter than magnitude ${FAINTEST} within ${RADIUS}° of there. Try another direction, or a few minutes either side.` : 'Nothing bright enough was in sunlight above your horizon then.'));
    results.replaceChildren(
      h('div', { class: 'rw-h' }, `${timeFmt.format(t)} · ${hits.length} candidate${hits.length === 1 ? '' : 's'}`),
      ...rows,
      ...(app.skyView.active ? [] : [h('div', { style: 'padding:10px 14px' }, h('button', { class: 'btn', onclick: () => app.enterSkyView(look ?? undefined) }, icon(ICON_SKY), 'Look in sky view'))]),
    );
    note.textContent = 'Brightness is predicted from each object\'s size or published magnitude; flares from solar panels can make satellites briefly much brighter.';
  }

  function open(o: boolean) {
    panel.hidden = !o;
    if (!o) return;
    document.querySelectorAll<HTMLElement>('.watch-panel').forEach((p) => (p.hidden = true));
    when.value = toLocalInput(app.clock.now() - 2 * 60e3);
    if (app.skyView.active) {
      dir = Math.round(app.skyView.az);
      height = Math.round(app.skyView.el);
    }
    sync();
    run();
  }
  when.addEventListener('change', run);
  app.openIdentify = () => open(!!panel.hidden);
  app.on('skyview', sync);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) open(false);
  });
}
