import type { App, Settings } from '../app';
import { legendFor, NEUTRAL } from '../data/model';
import { $, fmtAgo, fmtCompact, fmtInt, fmtUtc, h, icon, ICONS } from './dom';

// ---------- time bar ----------
const RATES = [-86400, -3600, -600, -60, -10, 1, 10, 60, 600, 3600, 86400];

function rateLabel(r: number) {
  const a = Math.abs(r);
  const sign = r < 0 ? '−' : '';
  if (a < 60) return `${sign}${a}×`;
  if (a < 3600) return `${sign}${a / 60} min/s`;
  if (a < 86400) return `${sign}${a / 3600} h/s`;
  return `${sign}${a / 86400} d/s`;
}

export function mountTimebar(app: App) {
  const root = $('#timebar');
  const date = h('div', { class: 'd' });
  const sub = h('div', { class: 's' }, h('i', { class: 'live-dot' }), h('span'));
  const play = h('button', { class: 'tb play', 'aria-label': 'Play / pause (Space)', title: 'Play / pause (Space)' });
  const slower = h('button', { class: 'tb', 'aria-label': 'Slower', title: 'Slower ( [ )' }, icon(ICONS.rew));
  const faster = h('button', { class: 'tb', 'aria-label': 'Faster', title: 'Faster ( ] )' }, icon(ICONS.ffw));
  const speed = h('div', { class: 'speed', 'aria-live': 'polite' });
  const now = h('button', { class: 'tb-now', title: 'Return to live time (N)' }, 'LIVE');
  root.append(h('div', { class: 'clock' }, date, sub), h('div', { class: 'tb-sep' }), slower, play, faster, speed, h('div', { class: 'tb-sep' }), now);

  const step = (dir: 1 | -1) => {
    const c = app.clock;
    let i = RATES.indexOf(c.rate);
    if (i < 0) i = RATES.indexOf(1);
    i = Math.max(0, Math.min(RATES.length - 1, i + dir));
    c.setRate(RATES[i]);
    if (c.paused) c.setPaused(false);
  };
  slower.onclick = () => step(-1);
  faster.onclick = () => step(1);
  play.onclick = () => app.clock.setPaused(!app.clock.paused);
  now.onclick = () => app.clock.resetToNow();

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === ' ') {
      e.preventDefault();
      app.clock.setPaused(!app.clock.paused);
    } else if (e.key === ']') step(1);
    else if (e.key === '[') step(-1);
    else if (e.key === 'n' || e.key === 'N') app.clock.resetToNow();
  });

  const syncButtons = () => {
    play.replaceChildren(icon(app.clock.paused ? ICONS.play : ICONS.pause));
    speed.textContent = app.clock.paused ? 'paused' : rateLabel(app.clock.rate);
  };
  app.clock.onChange(syncButtons);
  syncButtons();

  let last = 0;
  app.on('frame', () => {
    const t = performance.now();
    if (t - last < 100) return;
    last = t;
    const sim = app.clock.now();
    date.textContent = fmtUtc(sim) + ' UTC';
    const live = app.clock.isLive;
    sub.classList.toggle('is-live', live);
    const off = sim - Date.now();
    (sub.lastChild as HTMLElement).textContent = live ? 'Live · real time' : app.clock.paused ? `Paused · ${fmtAgo(-off).replace('ahead', 'ahead of now').replace('ago', 'before now')}` : `Simulated · ${fmtAgo(-off).replace('ahead', 'ahead').replace('ago', 'behind')}`;
    now.classList.toggle('on', live);
  });
}

// ---------- KPIs ----------
export function mountKpis(app: App) {
  const root = $('#kpis');
  const kpi = (label: string) => {
    const v = h('div', { class: 'v' });
    root.append(h('div', { class: 'kpi' }, v, h('div', { class: 'l' }, label)));
    return v;
  };
  const tracked = kpi('Objects tracked');
  const shown = kpi('Shown');
  const pay = kpi('Active payloads');
  const deb = kpi('Debris & bodies');
  const upd = kpi('Elements updated');
  const objs = app.cat.objects;
  tracked.replaceChildren(h('i', { class: 'dot' }), fmtInt(objs.length));
  pay.textContent = fmtInt(objs.filter((o) => o.type === 'P' && ['+', 'P', 'B', 'S', 'X'].includes(o.status)).length || objs.filter((o) => o.type === 'P').length);
  deb.textContent = fmtInt(objs.filter((o) => o.type === 'D' || o.type === 'R').length);
  const refresh = () => (upd.textContent = fmtAgo(Date.now() - Date.parse(app.cat.generated)));
  refresh();
  setInterval(refresh, 30000);
  const sync = () => (shown.textContent = fmtInt(app.visibleList.length));
  app.on('filters', sync);
  sync();
}

// ---------- legend ----------
export function mountLegend(app: App) {
  const root = $('#legend');
  const render = () => {
    const items = legendFor(app.colorMode);
    const counts = new Map<string, number>();
    for (const o of app.visibleList) counts.set(app.colorsHex[o.idx], (counts.get(app.colorsHex[o.idx]) ?? 0) + 1);
    const title = { type: 'Object type', regime: 'Orbit regime', owner: 'Owner', status: 'Status', year: 'Launch year' }[app.colorMode];
    if (app.colorMode === 'year') {
      root.replaceChildren(
        h('div', { class: 'eyebrow' }, title),
        h('div', { class: 'grad', style: `background:linear-gradient(90deg, ${items.map((i) => i.color).join(',')})` }),
        h('div', { class: 'grad-l' }, ...items.filter((_, i) => i % 2 === 0).map((i) => h('span', null, i.label))),
      );
      return;
    }
    root.replaceChildren(
      h('div', { class: 'eyebrow' }, title),
      ...items.map((i) => {
        const n = i.color === NEUTRAL && app.colorMode === 'owner' ? counts.get(NEUTRAL) : counts.get(i.color);
        return h('div', { class: 'row' }, h('i', { style: `background:${i.color};color:${i.color}` }), h('span', { style: 'flex:1' }, i.label), h('span', { class: 'mono', style: 'color:var(--ink-3);font-size:10.5px' }, fmtCompact(n ?? 0)));
      }),
    );
  };
  app.on('colors', render);
  app.on('filters', render);
  render();
}

// ---------- layers ----------
const LAYERS: [keyof Settings, string][] = [
  ['clouds', 'Clouds'],
  ['atmosphere', 'Atmosphere'],
  ['borders', 'Country borders'],
  ['graticule', 'Lat / lon grid'],
  ['bloom', 'Glow (bloom)'],
];
const OVERLAYS: [keyof Settings, string][] = [
  ['track', 'Ground track'],
  ['footprint', 'Visibility footprint'],
  ['orbits', 'Orbits of filtered set (≤ 400)'],
  ['labels', 'Labels for stations'],
  ['ghosts', 'Show filtered-out as ghosts'],
];
const CAMERA: [keyof Settings, string][] = [
  ['earthFixed', 'Rotate with Earth'],
  ['autoRotate', 'Auto-rotate when idle'],
];

export function mountLayers(app: App) {
  const menu = $('#layers-menu');
  const btn = $('#btn-layers');
  const toggles: [keyof Settings, HTMLButtonElement][] = [];
  const group = (label: string, list: [keyof Settings, string][]) => {
    menu.append(h('div', { class: 'menu-label' }, label));
    for (const [k, l] of list) {
      const b = h('button', { class: 'toggle', role: 'switch', onclick: () => app.setSetting(k, !app.settings[k]) }, h('span', null, l), h('span', { class: 'sw' }));
      toggles.push([k, b]);
      menu.append(b);
    }
  };
  group('Earth', LAYERS);
  menu.append(h('div', { class: 'menu-sep' }));
  group('Overlays', OVERLAYS);
  menu.append(h('div', { class: 'menu-sep' }));
  group('Camera', CAMERA);
  const sync = () => {
    for (const [k, b] of toggles) b.setAttribute('aria-checked', String(!!app.settings[k]));
  };
  app.on('settings', sync);
  sync();
  const setOpen = (o: boolean) => {
    menu.hidden = !o;
    btn.setAttribute('aria-pressed', String(o));
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    setOpen(!!menu.hidden);
  };
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) setOpen(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'l' || e.key === 'L') setOpen(!!menu.hidden);
  });
}

// ---------- help ----------
export function mountHelp(app: App) {
  const modal = $('#help');
  const btn = $('#btn-help');
  const close = () => (modal.hidden = true);
  const sc = (k: string, d: string) => h('div', null, h('span', null, d), h('kbd', null, k));
  const card = h(
    'div',
    { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'About Orbital Objects' },
    h('button', { class: 'icon-btn close', onclick: close, 'aria-label': 'Close' }, icon(ICONS.close)),
    h('div', { class: 'eyebrow' }, 'About'),
    h('h2', null, 'Orbital Objects'),
    h(
      'p',
      null,
      `A live map of ${fmtInt(app.cat.objects.length)} catalogued objects in Earth orbit — working satellites, spent rocket stages and fragments of debris. Every position is computed in your browser with the SGP4/SDP4 propagator from the latest published element sets, so what you see is where each object is right now (or at whatever time you scrub to).`,
    ),
    h(
      'p',
      null,
      'Data: orbital elements and the satellite catalogue (owner, launch, size, status) from ',
      h('a', { href: 'https://celestrak.org', target: '_blank', rel: 'noopener' }, 'CelesTrak'),
      ', derived from the U.S. Space Force 18th/19th SDS catalogue',
      app.cat.source.includes('Space-Track') ? [' and ', h('a', { href: 'https://www.space-track.org', target: '_blank', rel: 'noopener' }, 'Space-Track.org')] : '',
      `. Source: ${app.cat.source}. Catalogue built ${new Date(app.cat.generated).toUTCString()}.`,
    ),
    h('p', null, 'Earth imagery: NASA Blue Marble & Black Marble. Positions are accurate to roughly a kilometre near the element epoch and degrade by a few km per day; classified objects are not published and so do not appear.'),
    h('h3', null, 'Shortcuts'),
    h(
      'div',
      { class: 'shortcuts' },
      sc('/', 'Search'),
      sc('Esc', 'Deselect / close'),
      sc('Space', 'Pause / resume time'),
      sc('[  ]', 'Slower / faster'),
      sc('N', 'Back to live time'),
      sc('F', 'Follow selected'),
      sc('I', 'Insights'),
      sc('L', 'Layers'),
      sc('Alt+click', 'Isolate a type / regime'),
      sc('Drag · Scroll', 'Rotate · Zoom'),
    ),
  );
  modal.append(card);
  modal.addEventListener('pointerdown', (e) => e.target === modal && close());
  btn.onclick = () => (modal.hidden = false);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === '?') modal.hidden = !modal.hidden;
    if (e.key === 'Escape' && !modal.hidden) close();
  });
}
