import type { App, Settings } from '../app';
import { legendFor, NEUTRAL } from '../data/model';
import { $, fmtAgo, fmtCompact, fmtInt, h, icon, ICONS } from './dom';

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
  ['sightLines', 'Lines of sight from your location'],
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
      sc('H', 'Replay the space age'),
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
