import { FAMILIES, type Family } from '../sim/families';
import type { App } from '../app';
import type { ObjectType, Regime } from '../data/catalog';
import { ALT_MAX, ALT_MIN, COLOR_MODES, defaultFilters, YEAR_MAX, YEAR_MIN, type ColorMode, type Filters, type SkyFilter, type StatusFilter } from '../data/model';
import { $, debounce, fmtInt, h, icon, ICONS } from './dom';
import { canRecord, exportCsv, Recorder, screenshot } from './export';
import { mountEmbedBuilder } from './embed';
import { mountPoster } from './poster';

const ICON_IMAGE = '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 8"/>';
const ICON_TABLE = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>';
const ICON_REC = '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>';

// View state <-> URL hash, e.g. #s=25544&g=stations&c=owner&cam=1.2,3.4,0.5
// The plain "#25544" form from earlier links is still understood.

export interface ShareOptions {
  time: boolean;
  camera: boolean;
  location: boolean;
}

const ALL_TYPES: ObjectType[] = ['P', 'R', 'D', 'U'];
const ALL_REGIMES: Regime[] = ['LEO', 'MEO', 'GEO', 'HEO', 'XGEO'];
const MAX_IDS = 300;

export function stateParams(app: App, opts: ShareOptions) {
  const p = new URLSearchParams();
  const f = app.filters;
  const d = defaultFilters();
  if (app.selected) p.set('s', String(app.selected.norad));
  // Later views (close-up, sky view) set 'v'.
  if (app.closeup.active && app.closeup.phase !== 'out') p.set('v', '3d');
  if (app.skyView.active) {
    p.set('v', 'sky');
    p.set('look', `${Math.round(app.skyView.az)},${Math.round(app.skyView.el)}`);
  }
  if (f.query.trim()) p.set('q', f.query.trim());
  if (f.types.size < 4) p.set('t', [...f.types].join(''));
  if (f.regimes.size < 5) p.set('r', [...f.regimes].join(','));
  if (f.owners.size) p.set('o', [...f.owners].join(','));
  if (f.families.size) p.set('fam', [...f.families].join(','));
  if (f.groups.size) p.set('g', [...f.groups].map((i) => app.cat.groups[i]?.key).filter(Boolean).join(','));
  if (f.status !== 'all') p.set('st', f.status);
  if (f.yearMin !== d.yearMin || f.yearMax !== d.yearMax) p.set('y', `${f.yearMin}-${f.yearMax}`);
  if (f.altMin !== d.altMin || f.altMax !== d.altMax) p.set('a', `${Math.round(f.altMin)}-${Math.round(f.altMax)}`);
  if (f.sky !== 'off') {
    p.set('sky', f.sky);
    if (f.minEl !== d.minEl) p.set('el', String(f.minEl));
  }
  if (f.ids && f.ids.size <= MAX_IDS) {
    p.set('ids', [...f.ids].join(','));
    if (f.idsLabel) p.set('il', f.idsLabel);
  }
  if (app.colorMode !== 'type') p.set('c', app.colorMode);
  if (opts.time) {
    if (app.history) {
      p.set('h', new Date(app.history.cutoff).toISOString().slice(0, 10));
      if (app.history.playing) p.set('hp', '1');
    } else if (!app.clock.isLive) p.set('at', new Date(app.clock.now()).toISOString().replace(/\.\d+Z$/, 'Z'));
  }
  if (opts.camera) {
    const c = app.stage.camera.position;
    p.set('cam', [c.x, c.y, c.z].map((v) => v.toFixed(3)).join(','));
  }
  if (opts.location && app.observer) {
    const o = app.observer;
    p.set('loc', `${o.lat.toFixed(4)},${o.lon.toFixed(4)},${Math.round(o.alt * 1000)}`);
  }
  return p;
}

export function shareUrl(app: App, opts: ShareOptions) {
  const q = stateParams(app, opts).toString();
  return `${location.origin}${location.pathname}${location.search}${q ? '#' + q : ''}`;
}

/** Apply state from the current URL hash. Returns true if it selected or positioned anything. */
export function applyHash(app: App) {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return false;
  const p = /^\d+$/.test(raw) ? new URLSearchParams({ s: raw }) : new URLSearchParams(raw);
  // "#tour=starlink" starts a guided tour.
  if (p.get('tour')) {
    app.startTour(p.get('tour')!);
    return true;
  }
  const f: Filters = defaultFilters();
  const csv = (k: string) => (p.get(k) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (p.has('q')) f.query = p.get('q')!;
  if (p.has('t')) f.types = new Set([...p.get('t')!].filter((x): x is ObjectType => ALL_TYPES.includes(x as ObjectType)));
  if (p.has('r')) f.regimes = new Set(csv('r').filter((x): x is Regime => ALL_REGIMES.includes(x as Regime)));
  if (p.has('o')) f.owners = new Set(csv('o'));
  if (p.has('fam')) f.families = new Set(csv('fam').filter((k) => FAMILIES.some((x) => x.key === k)) as Family[]);
  if (p.has('g')) f.groups = new Set(csv('g').map((k) => app.cat.groups.findIndex((g) => g.key === k)).filter((i) => i >= 0));
  if (['active', 'inactive'].includes(p.get('st') ?? '')) f.status = p.get('st') as StatusFilter;
  const range = (k: string) => (p.get(k) ?? '').split('-').map(Number);
  if (p.has('y')) {
    const [a, b] = range('y');
    if (a >= YEAR_MIN && b <= YEAR_MAX && a <= b) [f.yearMin, f.yearMax] = [a, b];
  }
  if (p.has('a')) {
    const [a, b] = range('a');
    if (a >= ALT_MIN && b <= ALT_MAX && a <= b) [f.altMin, f.altMax] = [a, b];
  }
  if (['above', 'visible'].includes(p.get('sky') ?? '')) f.sky = p.get('sky') as SkyFilter;
  if (p.has('el')) f.minEl = Math.max(0, Math.min(60, Number(p.get('el')) || 10));
  if (p.has('ids')) {
    f.ids = new Set(csv('ids').map(Number).filter(Number.isFinite));
    f.idsLabel = p.get('il') ?? 'Shared selection';
  }
  if (!f.types.size) f.types = new Set(ALL_TYPES);
  if (!f.regimes.size) f.regimes = new Set(ALL_REGIMES);

  // A shared location is used for this visit only; it never replaces your own saved one.
  if (p.has('loc')) {
    const [lat, lon, alt] = csv('loc').map(Number);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) app.setObserver({ lat, lon, alt: (alt || 0) / 1000, source: 'manual' }, false);
  }
  app.filters = f;
  app.applyFilters();
  app.emit('observer');
  const c = p.get('c') as ColorMode | null;
  if (c && COLOR_MODES.some((m) => m.key === c)) app.setColorMode(c);

  if (p.has('at')) {
    const t = Date.parse(p.get('at')!);
    if (Number.isFinite(t)) app.clock.set(t);
  }
  if (p.has('h')) {
    const t = Date.parse(p.get('h')! + 'T00:00:00Z');
    if (Number.isFinite(t)) app.setHistory({ cutoff: t, playing: p.get('hp') === '1' });
  }

  let positioned = false;
  // "#v=sky&look=az,el": the sky view (needs a location, shared or saved).
  if (p.get('v') === 'sky' && app.observer) {
    const [az, el] = csv('look').map(Number);
    setTimeout(() => app.enterSkyView(Number.isFinite(az) && Number.isFinite(el) ? { az, el } : undefined), 300);
    positioned = true;
  }
  const cam = csv('cam').map(Number);
  if (cam.length === 3 && cam.every(Number.isFinite) && Math.hypot(cam[0], cam[1], cam[2]) > 1.1) {
    app.stage.camera.position.set(cam[0], cam[1], cam[2]);
    positioned = true;
  }
  const norad = Number(p.get('s'));
  if (norad) {
    const sel = () => {
      const o = app.cat.byNorad.get(norad);
      if (o) app.select(o, { fly: !positioned });
      if (o && p.get('v') === '3d') setTimeout(() => app.enterCloseup(o), positioned ? 200 : 1700);
      return !!o;
    };
    // Re-entered objects only exist once history data has loaded.
    if (!sel() && app.history) {
      const off = app.on('history', () => {
        if (app.historyStatus === 'loading') return;
        off();
        sel();
      });
    }
    positioned = true;
  }
  return positioned;
}

/** Keep the URL hash in step with selection, filters and colours (not time or camera). */
export function syncUrl(app: App) {
  const write = debounce(() => {
    const q = stateParams(app, { time: false, camera: false, location: false }).toString();
    const url = `${location.pathname}${location.search}${q ? '#' + q : ''}`;
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, '', url);
  }, 300);
  app.on('filters', write);
  app.on('colors', write);
  app.on('selection', write);
  app.on('closeup', write);
  app.on('skyview', write);
}

// ---------- share menu ----------
export function mountShare(app: App) {
  const opts: ShareOptions = { time: true, camera: true, location: false };
  const input = h('input', { class: 'share-url', readonly: true, 'aria-label': 'Link to this view' });
  const copy = h('button', { class: 'btn primary' }, icon(ICONS.link), 'Copy link');
  const native = h('button', { class: 'btn', hidden: !('share' in navigator) }, icon(ICONS.share), 'Share…');
  // ---------- export ----------
  const recorder = new Recorder(app);
  const shotBtn = h('button', { class: 'btn', title: 'Save this view as a PNG image (P)' }, icon(ICON_IMAGE), 'Screenshot');
  const csvBtn = h('button', { class: 'btn', title: 'Download the filtered objects as a spreadsheet' }, icon(ICON_TABLE), 'CSV');
  const recBtn = h('button', { class: 'btn', title: 'Record what you see to a video file' }, icon(ICON_REC), 'Record video');
  const replayBtn = h('button', { class: 'btn', title: 'Record the space age, 1957 to today, in about 40 seconds' }, icon(ICON_REC), 'Record replay');
  const recNote = h('p', { class: 'share-sub', hidden: canRecord() }, "This browser can't record video from the page.");
  const openPoster = mountPoster(app);
  const posterBtn = h('button', { class: 'btn', title: 'A high-resolution print with a title, date and legend' }, icon(ICON_IMAGE), 'Poster…');
  posterBtn.onclick = () => {
    open(false);
    openPoster();
  };
  recBtn.disabled = replayBtn.disabled = !canRecord();
  const recTime = h('b', { class: 'mono' }, '0:00');
  const recPill = h('div', { class: 'rec-pill', hidden: true, role: 'status' }, h('i'), 'Recording', recTime, h('button', { class: 'btn', onclick: () => recorder.stop() }, 'Stop & save'));
  shotBtn.onclick = () => {
    open(false);
    void screenshot(app);
  };
  csvBtn.onclick = () => exportCsv(app);
  recBtn.onclick = () => {
    open(false);
    recorder.start();
  };
  replayBtn.onclick = () => {
    open(false);
    recorder.start({ replay: true });
  };
  recorder.onChange(() => {
    recPill.hidden = !recorder.active;
    document.body.classList.toggle('recording', recorder.active);
  });
  setInterval(() => {
    if (!recorder.active) return;
    const s = Math.floor((performance.now() - recorder.startedAt) / 1000);
    recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
    if (e.key === 'p' || e.key === 'P') void screenshot(app);
  });

  // ---------- embed ----------
  const embedBox = mountEmbedBuilder(app);

  const toggles: Record<keyof ShareOptions, HTMLButtonElement> = {} as never;
  const notes: Record<keyof ShareOptions, HTMLElement> = {} as never;
  const toggle = (k: keyof ShareOptions, label: string) => {
    const note = h('small');
    const b = h('button', { class: 'toggle', role: 'switch', onclick: () => ((opts[k] = !opts[k]), sync()) }, h('span', null, label, note), h('span', { class: 'sw' }));
    toggles[k] = b;
    notes[k] = note;
    return b;
  };
  const menu = h(
    'div',
    { class: 'share-menu', hidden: true, role: 'dialog', 'aria-label': 'Share this view' },
    h('div', { class: 'menu-label' }, 'Share this view'),
    h('p', { class: 'share-sub' }, 'The link opens with the same selection, filters and colours.'),
    toggle('time', 'Include the time'),
    toggle('camera', 'Include the camera angle'),
    toggle('location', 'Include my location'),
    input,
    h('div', { class: 'share-actions' }, copy, native),
    h('div', { class: 'menu-sep' }),
    h('div', { class: 'menu-label' }, 'Export'),
    h('div', { class: 'share-actions export-actions' }, shotBtn, posterBtn, csvBtn),
    h('div', { class: 'share-actions export-actions' }, recBtn, replayBtn),
    recNote,
    h('div', { class: 'menu-sep' }),
    h('div', { class: 'menu-label' }, 'Embed'),
    embedBox,
  );
  document.getElementById('app')!.append(menu, recPill);

  function sync() {
    const live = !app.history && app.clock.isLive;
    toggles.time.disabled = live;
    notes.time.textContent = live ? 'Live — the link opens at the viewer’s current time' : app.history ? 'History date' : 'Simulated time';
    toggles.location.disabled = !app.observer;
    notes.location.textContent = app.observer ? 'Off by default — your location stays private' : 'No location set';
    for (const k of Object.keys(toggles) as (keyof ShareOptions)[]) toggles[k].setAttribute('aria-checked', String(opts[k] && !toggles[k].disabled));
    input.value = shareUrl(app, { time: opts.time && !live, camera: opts.camera, location: opts.location && !!app.observer });
    csvBtn.replaceChildren(icon(ICON_TABLE), `CSV · ${fmtInt(app.inOrbitList().length)} rows`);
    embedBox.refresh();
  }

  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand?.('copy');
    }
    copy.lastChild!.textContent = 'Copied';
    setTimeout(() => (copy.lastChild!.textContent = 'Copy link'), 1500);
  };
  native.onclick = () => navigator.share?.({ title: 'Orbital Objects', text: app.selected ? app.selected.name : 'Everything in Earth orbit', url: input.value }).catch(() => {});

  const btn = $('#btn-share');
  const open = (v: boolean) => {
    menu.hidden = !v;
    btn.setAttribute('aria-pressed', String(v));
    if (v) {
      opts.location = false;
      sync();
      input.focus();
      input.select();
    }
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    open(!!menu.hidden);
  };
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (!menu.hidden && !menu.contains(t) && !btn.contains(t) && !(t as Element).closest?.('[data-share]')) open(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) open(false);
  });
  return { open: () => open(true) };
}
