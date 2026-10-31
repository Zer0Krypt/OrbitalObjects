import type { App, Settings } from '../app';
import { CONSTELLATIONS } from './coverage';
import { legendFor, NEUTRAL } from '../data/model';
import { $, fmtAgo, fmtCompact, fmtInt, h, icon, ICONS } from './dom';
import { glossaryList } from './glossary';

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
  // In history mode, count what's in orbit at that date.
  const sync = () => (shown.textContent = fmtInt(app.history ? app.historyShown : app.visibleList.length));
  app.on('filters', sync);
  let last = 0;
  app.on('history', () => {
    if (performance.now() - last < 400) return;
    last = performance.now();
    sync();
  });
  sync();
}

// ---------- legend ----------
export function mountLegend(app: App) {
  const root = $('#legend');
  const render = () => {
    const items = legendFor(app.colorMode);
    const counts = new Map<string, number>();
    for (const o of app.inOrbitList()) counts.set(app.colorsHex[o.idx], (counts.get(app.colorsHex[o.idx]) ?? 0) + 1);
    const title = { type: 'Object type', regime: 'Orbit regime', family: 'Orbit family', owner: 'Owner', status: 'Status', year: 'Launch year', age: 'Element set age' }[app.colorMode];
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
  let lastH = 0;
  app.on('history', () => {
    if (performance.now() - lastH < 600) return;
    lastH = performance.now();
    render();
  });
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
const SKY: [keyof Settings, string][] = [
  ['sun', 'Sun'],
  ['moon', 'Moon'],
  ['stars', 'Stars & Milky Way'],
  ['planets', 'Planets'],
  ['constellations', 'Constellation figures'],
  ['nightRed', 'Red night vision'],
  ['deepSpace', 'Spacecraft beyond Earth orbit'],
];
const OVERLAYS: [keyof Settings, string][] = [
  ['track', 'Ground track'],
  ['footprint', 'Visibility footprint'],
  ['orbits', 'Orbits of filtered set (≤ 400)'],
  ['labels', 'Labels for stations'],
  ['ghosts', 'Show filtered-out as ghosts'],
  ['sightLines', 'Lines of sight from your location'],
  ['launchSites', 'Upcoming launch sites'],
  ['debrisCloud', 'Debris density cloud'],
  ['aurora', 'Aurora forecast (NOAA)'],
  ['belts', 'Van Allen radiation belts'],
  ['eclipseShadow', 'Moon’s shadow during eclipses'],
  ['classified', 'Classified satellites (hobbyist-tracked, unofficial)'],
];
const CAMERA: [keyof Settings, string][] = [
  ['earthFixed', 'Rotate with Earth'],
  ['autoRotate', 'Auto-rotate when idle'],
  ['sound', 'Sound: passes & Sputnik'],
];

export function mountLayers(app: App) {
  const menu = $('#layers-menu');
  const btn = $('#btn-layers');
  const toggles: [keyof Settings, HTMLButtonElement][] = [];
  const group = (label: string, list: [keyof Settings, string][]) => {
    menu.append(h('div', { class: 'menu-label' }, label));
    for (const [k, l] of list) {
      const b = h(
        'button',
        {
          class: 'toggle',
          role: 'switch',
          title: k === 'classified' ? 'Orbits of classified satellites worked out by hobbyist observers (Mike McCants’ list). Unofficial and less precise. Reloads the page.' : undefined,
          onclick: () => {
            app.setSetting(k, !app.settings[k]);
            // Extra objects are merged into the catalogue at start-up.
            if (k === 'classified') location.reload();
          },
        },
        h('span', null, l),
        h('span', { class: 'sw' }),
      );
      toggles.push([k, b]);
      menu.append(b);
    }
  };
  group('Earth', LAYERS);
  menu.append(h('div', { class: 'menu-sep' }));
  group('Sky', SKY);
  menu.append(h('div', { class: 'menu-sep' }));
  group('Overlays', OVERLAYS);
  const cov = h(
    'select',
    { class: 'sky-select', 'aria-label': 'Coverage map', onchange: (e: Event) => app.setSetting('coverage', (e.target as HTMLSelectElement).value) },
    h('option', { value: '' }, 'Off'),
    ...CONSTELLATIONS.map((c) => h('option', { value: c.key }, c.label)),
  );
  menu.append(h('label', { class: 'toggle menu-select' }, h('span', null, 'Coverage map'), cov));
  menu.append(h('div', { class: 'menu-sep' }));
  menu.append(h('div', { class: 'menu-label' }, 'View'));
  const flat = h('button', { class: 'toggle', role: 'switch', title: 'The whole world flat (M)', onclick: () => app.setFlatMap(!app.flatMap) }, h('span', null, 'Flat map (M)'), h('span', { class: 'sw' }));
  menu.append(flat);
  menu.append(h('div', { class: 'menu-sep' }));
  group('Camera & sound', CAMERA);
  const sync = () => {
    cov.value = app.settings.coverage;
    for (const [k, b] of toggles) b.setAttribute('aria-checked', String(!!app.settings[k]));
    flat.setAttribute('aria-checked', String(app.flatMap));
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
      `. Source: ${app.cat.source}. Catalogue built ${new Date(app.cat.generated).toUTCString()}. `,
      h('a', { href: './status.html' }, 'Data status ›'),
    ),
    h('p', null, 'Close approaches come from CelesTrak SOCRATES; the launch schedule from The Space Devs (Launch Library 2). Satellite brightness uses standard magnitudes from Mike McCants\' list where published, otherwise an estimate from radar size. Operator-supplied orbits for big fleets come from CelesTrak SupGP, space weather and the aurora forecast from NOAA SWPC, and spacecraft beyond Earth orbit from NASA JPL Horizons. Radio frequencies are from SatNOGS DB (CC BY-SA 4.0); launch statistics from the satellite catalogue and Launch Library 2; the optional classified-satellite layer from Mike McCants’ hobbyist-tracked element sets. Eclipses are computed in your browser.'),
    h('p', null, 'Stars: the HYG database (CC BY-SA 4.0). Constellation figures: d3-celestial. Moon texture from the three.js examples. The Moon and Sun are placed with low-precision almanac formulas (about 0.3°).'),
    h('p', null, 'Selecting an object asks Wikipedia and Wikidata (directly from your browser) for a summary of it. Your location, if you set one, never leaves this browser unless you include it in a shared link or turn on the cloud forecast (which sends it, rounded to about 10 km, to Open-Meteo).'),
    h('p', null, 'Earth imagery: NASA Blue Marble & Black Marble. Positions are accurate to roughly a kilometre near the element epoch and degrade by a few km per day; classified objects are not published and so do not appear.'),
    h('p', null, 'Install it as an app from the Install button (or, on iPhone and iPad, Share → Add to Home Screen). Once loaded, it keeps working offline with the last data it downloaded. On slow or data-saver connections it sticks to lighter Earth textures.'),
    h(
      'p',
      null,
      'For a lobby screen or screensaver, ',
      h('button', { class: 'link', onclick: () => (close(), app.startKiosk()) }, 'start kiosk mode'),
      ': full screen, no panels, slowly cycling through scenes (or add ?kiosk to the address).',
    ),
    h('details', { class: 'glossary-wrap' }, h('summary', null, h('h3', { style: 'display:inline' }, 'Glossary')), glossaryList()),
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
      sc('R', 'Watch: re-entries, close approaches, launches'),
      sc('← →', 'Step through a tour'),
      sc('← ↑ → ↓  + −', 'Look around / zoom (sky view)'),
      sc('F', 'Follow selected'),
      sc('S', 'Add to / remove from My satellites'),
      sc('K', 'Kiosk mode'),
      sc('I', 'Insights'),
      sc('L', 'Layers'),
      sc('M', 'Flat map'),
      sc('P', 'Save a screenshot'),
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
