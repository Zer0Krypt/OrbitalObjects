import type { App } from '../app';
import { REGIME_LABEL, TYPE_LABEL, type ObjectType, type Regime, type SatObject } from '../data/catalog';
import { ownerName } from '../data/codes';
import {
  ALT_MAX,
  ALT_MIN,
  COLOR_MODES,
  defaultFilters,
  isDefault,
  REGIME_COLOR,
  FAMILY_COLOR,
  familyOf,
  TYPE_COLOR,
  YEAR_MAX,
  YEAR_MIN,
  passes,
  type Filters,
  type StatusFilter,
} from '../data/model';
import { $, debounce, fmt, fmtCompact, fmtInt, fmtKm, h, icon, ICONS } from './dom';
import { compass } from '../sim/observer';
import { mountSkySection } from './sky';
import { TOURS } from './tours';
import { mountWatchlist } from './watchlist';
import { mountOnThisDay } from './onthisday';
import { FAMILIES } from '../sim/families';
import { mountMine } from './mine';

const ALT_SPAN = Math.log(ALT_MAX / ALT_MIN);
const altToSlider = (km: number) => Math.round((Math.log(km / ALT_MIN) / ALT_SPAN) * 1000);
const sliderToAlt = (v: number) => ALT_MIN * Math.exp((v / 1000) * ALT_SPAN);
const meanAlt = (o: SatObject) => Math.max(ALT_MIN, (o.perigee + o.apogee) / 2);

interface Facets {
  types: Map<string, number>;
  regimes: Map<string, number>;
  families: Map<string, number>;
  owners: Map<string, number>;
  groups: Map<number, number>;
  status: Map<string, number>;
  years: Uint32Array;
  alts: Uint32Array;
}

const ALT_BINS = 60;

function computeFacets(app: App): Facets {
  const f = app.filters;
  const tokens = app.queryTokens;
  const sky = app.skyActive ? app.skyOk : null;
  const out: Facets = {
    types: new Map(),
    regimes: new Map(),
    families: new Map(),
    owners: new Map(),
    groups: new Map(),
    status: new Map(),
    years: new Uint32Array(YEAR_MAX - YEAR_MIN + 1),
    alts: new Uint32Array(ALT_BINS),
  };
  const inc = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const o of app.universe) {
    if (passes(o, f, tokens, 'types', sky)) inc(out.types, o.type);
    if (passes(o, f, tokens, 'regimes', sky)) inc(out.regimes, o.regime);
    if (passes(o, f, tokens, 'families', sky)) inc(out.families, familyOf(o));
    if (passes(o, f, tokens, 'owners', sky)) inc(out.owners, o.owner);
    if (passes(o, f, tokens, 'groups', sky)) for (const g of o.groups) inc(out.groups, g);
    if (passes(o, f, tokens, 'status', sky)) inc(out.status, o.type === 'P' && ['+', 'P', 'B', 'S', 'X'].includes(o.status) ? 'active' : 'inactive');
    if (o.launchYear && passes(o, f, tokens, 'yearMin', sky)) {
      const y = o.launchYear - YEAR_MIN;
      if (y >= 0 && y < out.years.length) out.years[y]++;
    }
    if (passes(o, f, tokens, 'altMin', sky)) {
      const b = Math.min(ALT_BINS - 1, Math.max(0, Math.floor((Math.log(meanAlt(o) / ALT_MIN) / ALT_SPAN) * ALT_BINS)));
      out.alts[b]++;
    }
  }
  return out;
}

export function mountExplorer(app: App) {
  const root = $('#explorer');
  const input = h('input', {
    type: 'search',
    placeholder: 'Search satellites, IDs, owners, missions…',
    'aria-label': 'Search objects',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const kbd = h('kbd', null, '/');
  const clear = h('button', { class: 'clear', 'aria-label': 'Clear search', hidden: true }, '×');
  const tabExplore = h('button', { class: 'tab', role: 'tab', 'aria-selected': 'true' }, 'Explore');
  const resCount = h('span', { class: 'count' });
  const tabResults = h('button', { class: 'tab', role: 'tab', 'aria-selected': 'false' }, 'Results ', resCount);

  const explorePane = h('div', { class: 'scroll', style: 'flex:1' });
  const resultsPane = h('div', { class: 'scroll results', hidden: true });
  const resultsInner = h('div', { class: 'results-inner' });
  resultsPane.append(resultsInner);

  const footCount = h('span');
  const resetBtn = h('button', { class: 'btn', onclick: () => resetFilters() }, 'Reset filters');

  root.append(
    h('div', { class: 'search' }, h('div', { class: 'search-box' }, icon(ICONS.search), input, kbd, clear), h('div', { class: 'tabs', role: 'tablist' }, tabExplore, tabResults)),
    explorePane,
    resultsPane,
    h('div', { class: 'explorer-foot' }, footCount, resetBtn),
  );

  // ---------- search ----------
  const runQuery = debounce(() => app.setFilters({ query: input.value }), 140);
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    kbd.hidden = !!input.value;
    runQuery();
    if (input.value.trim()) setTab('results');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = app.results[0];
      if (first) app.select(first, { fly: true });
    } else if (e.key === 'Escape') {
      input.value = '';
      input.dispatchEvent(new Event('input'));
      input.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setTab('results');
      (resultsInner.querySelector('.res') as HTMLElement | null)?.focus();
    }
  });
  clear.onclick = () => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  };

  function setTab(t: 'explore' | 'results') {
    tabExplore.setAttribute('aria-selected', String(t === 'explore'));
    tabResults.setAttribute('aria-selected', String(t === 'results'));
    explorePane.hidden = t !== 'explore';
    resultsPane.hidden = t !== 'results';
    if (t === 'results') renderResults(true);
  }
  tabExplore.onclick = () => setTab('explore');
  tabResults.onclick = () => setTab('results');

  function resetFilters() {
    input.value = '';
    clear.hidden = true;
    kbd.hidden = false;
    app.filters = defaultFilters();
    app.applyFilters();
  }

  // ---------- quick views ----------
  const gIdx = (key: string) => app.cat.groups.findIndex((g) => g.key === key);
  const featured: { label: string; sub: string; run: () => void; available: () => boolean }[] = [
    { label: 'ISS', sub: 'International Space Station', run: () => selectNorad(25544), available: () => app.cat.byNorad.has(25544) },
    { label: 'Tiangong', sub: 'China Space Station', run: () => selectNorad(48274), available: () => app.cat.byNorad.has(48274) },
    { label: 'Hubble', sub: 'Space Telescope', run: () => selectNorad(20580), available: () => app.cat.byNorad.has(20580) },
    { label: 'Starlink', sub: 'Mega-constellation', run: () => groupPreset('starlink'), available: () => gIdx('starlink') >= 0 },
    { label: 'GNSS', sub: 'GPS · Galileo · GLONASS · BeiDou', run: () => groupPreset('gnss', ['gps-ops', 'glo-ops', 'galileo', 'beidou']), available: () => true },
    { label: 'GEO belt', sub: 'Geosynchronous ring', run: () => (regimePreset('GEO'), app.openInsights('geo')), available: () => true },
    { label: 'Debris', sub: 'Fragments & breakups', run: () => typePreset('D'), available: () => true },
    { label: 'Space stations', sub: 'Crewed & visiting', run: () => groupPreset('stations'), available: () => gIdx('stations') >= 0 },
    { label: 'Deep space', sub: 'L1, L2 and the Moon', run: () => app.openDeepSpace(), available: () => true },
  ];
  function selectNorad(n: number) {
    const o = app.cat.byNorad.get(n);
    if (o) app.select(o, { fly: true });
  }
  function groupPreset(...keys: (string | string[])[]) {
    const idx = keys.flat().map(gIdx).filter((i) => i >= 0);
    app.select(null);
    app.filters = { ...defaultFilters(), groups: new Set(idx) };
    input.value = '';
    app.applyFilters();
    app.flyHome();
  }
  function regimePreset(r: Regime) {
    app.select(null);
    app.filters = { ...defaultFilters(), regimes: new Set([r]) };
    app.applyFilters();
    if (r === 'GEO') app.zoomTo(16);
  }
  function typePreset(t: ObjectType) {
    app.select(null);
    app.filters = { ...defaultFilters(), types: new Set([t]) };
    app.applyFilters();
  }

  // ---------- sections ----------
  const featGrid = h('div', { class: 'featured' });
  for (const f of featured) {
    if (!f.available()) continue;
    featGrid.append(h('button', { class: 'feat', onclick: f.run }, h('b', null, f.label), h('span', null, f.sub)));
  }

  const colorSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Colour objects by' });
  for (const m of COLOR_MODES) {
    colorSeg.append(h('button', { 'data-k': m.key, onclick: () => app.setColorMode(m.key) }, m.label));
  }

  const typeFacet = h('div', { class: 'facet' });
  const regimeFacet = h('div', { class: 'facet' });
  const familyFacet = h('div', { class: 'facet multi' });
  const familyClear = h('button', { class: 'link', onclick: () => app.setFilters({ families: new Set() }) }, 'Clear');
  const ownerFacet = h('div', { class: 'facet multi' });
  const groupBox = h('div');
  const statusSeg = h('div', { class: 'seg' });
  for (const [k, l] of [
    ['all', 'All'],
    ['active', 'Active payloads'],
    ['inactive', 'Inactive & debris'],
  ] as [StatusFilter, string][]) {
    statusSeg.append(h('button', { 'data-k': k, onclick: () => app.setFilters({ status: k }) }, l));
  }
  let ownersExpanded = false;
  const ownerMore = h('button', { class: 'link', onclick: () => ((ownersExpanded = !ownersExpanded), render()) }, 'Show all');
  const ownerClear = h('button', { class: 'link', onclick: () => app.setFilters({ owners: new Set() }) }, 'Clear');
  const groupClear = h('button', { class: 'link', onclick: () => app.setFilters({ groups: new Set() }) }, 'Clear');

  const yearRange = makeRange({
    min: YEAR_MIN,
    max: YEAR_MAX,
    bin: (i) => YEAR_MIN + i,
    get: () => [app.filters.yearMin, app.filters.yearMax],
    set: (a, b) => app.setFilters({ yearMin: a, yearMax: b }),
    fmt: (v) => String(v),
  });
  const altRange = makeRange({
    min: 0,
    max: 1000,
    bin: (i, n) => ((i + 0.5) / n) * 1000,
    get: () => [altToSlider(app.filters.altMin), altToSlider(app.filters.altMax)],
    set: (a, b) => app.setFilters({ altMin: a <= 0 ? ALT_MIN : sliderToAlt(a), altMax: b >= 1000 ? ALT_MAX : sliderToAlt(b) }),
    fmt: (v) => (v <= 0 ? '≤100 km' : v >= 1000 ? '400k+ km' : `${fmtCompact(sliderToAlt(v))} km`),
  });

  const section = (title: string, body: Node, extra?: Node) =>
    h('div', { class: 'section' }, h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, title), extra ?? null), body);

  const idsNotice = h('div', { class: 'ids-notice', hidden: true });
  const tourList = h(
    'div',
    { class: 'tour-list' },
    ...TOURS.map((t) => h('button', { class: 'feat tour', onclick: () => app.startTour(t.id) }, h('b', null, t.title), h('span', null, t.blurb), h('em', null, `${t.steps.length} steps ▸`))),
  );
  explorePane.append(
    idsNotice,
    mountWatchlist(app),
    mountMine(app),
    mountOnThisDay(app),
    section('Quick views', featGrid),
    section('Guided tours', tourList),
    mountSkySection(app),
    section('Colour by', colorSeg),
    section('Object type', typeFacet),
    section('Orbit regime', regimeFacet),
    section('Orbit family', familyFacet, familyClear),
    section('Status', statusSeg),
    section('Owner / operator', ownerFacet, h('span', { style: 'display:flex;gap:10px' }, ownerClear, ownerMore)),
    section('Missions & constellations', groupBox, groupClear),
    section('Launch year', yearRange.el),
    section('Mean altitude', altRange.el),
  );

  // ---------- facet rows ----------
  function toggleRow(label: string, color: string | null, count: number, max: number, pressed: boolean, onClick: () => void, sub?: string) {
    return h(
      'button',
      { class: 'frow', 'aria-pressed': String(pressed), onclick: onClick, title: label },
      color ? h('i', { class: 'sw', style: `background:${color}` }) : h('i', { class: 'chk' }),
      h('span', { class: 'lbl' }, label, sub ? h('small', null, sub) : null),
      h('span', { class: 'n' }, fmtInt(count)),
      h('span', { class: 'bar' }, h('i', { style: `width:${max ? (count / max) * 100 : 0}%;background:${color ?? 'var(--accent-2)'}` })),
    );
  }

  function toggleSet<T>(set: Set<T>, v: T, all: T[], exclusive: boolean) {
    const next = new Set(set);
    if (exclusive) {
      // Alt/shift-click (or clicking the only enabled one) isolates.
      if (next.size === 1 && next.has(v)) return new Set(all);
      return new Set([v]);
    }
    if (next.has(v)) next.delete(v);
    else next.add(v);
    if (!next.size) return new Set(all);
    return next;
  }

  let facets: Facets;
  function render() {
    const f = app.filters;
    facets = computeFacets(app);
    const n = app.visibleList.length;
    const total = app.universe.length;
    resCount.textContent = fmtCompact(n);
    footCount.replaceChildren('Showing ', h('b', null, fmtInt(n)), ` of ${fmtInt(total)}`);
    resetBtn.disabled = isDefault(f);
    resetBtn.style.opacity = isDefault(f) ? '0.4' : '1';

    idsNotice.hidden = !f.ids;
    if (f.ids)
      idsNotice.replaceChildren(
        h('span', null, 'Showing ', h('b', null, f.idsLabel || 'a custom selection'), f.ids.size ? ` · ${fmtInt(f.ids.size)} objects` : ''),
        h('button', { class: 'link', onclick: () => app.setFilters({ ids: null, idsLabel: '' }) }, 'Show everything'),
      );
    for (const b of colorSeg.children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.k === app.colorMode));
    for (const b of statusSeg.children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.k === f.status));

    const types = Object.keys(TYPE_LABEL) as ObjectType[];
    const tMax = Math.max(...types.map((t) => facets.types.get(t) ?? 0));
    typeFacet.replaceChildren(
      ...types.map((t) =>
        toggleRow(TYPE_LABEL[t], TYPE_COLOR[t], facets.types.get(t) ?? 0, tMax, f.types.has(t), () => {
          app.setFilters({ types: toggleSet(f.types, t, types, lastClickExclusive) });
        }),
      ),
    );
    const regimes = Object.keys(REGIME_LABEL) as Regime[];
    const rMax = Math.max(...regimes.map((r) => facets.regimes.get(r) ?? 0));
    regimeFacet.replaceChildren(
      ...regimes.map((r) =>
        toggleRow(REGIME_LABEL[r], REGIME_COLOR[r], facets.regimes.get(r) ?? 0, rMax, f.regimes.has(r), () => {
          app.setFilters({ regimes: toggleSet(f.regimes, r, regimes, lastClickExclusive) });
        }, r === 'XGEO' ? undefined : r),
      ),
    );

    const fMax = Math.max(...FAMILIES.map((x) => facets.families.get(x.key) ?? 0));
    familyClear.hidden = !f.families.size;
    familyFacet.replaceChildren(
      ...FAMILIES.map((x) => {
        const row = toggleRow(x.label, FAMILY_COLOR[x.key], facets.families.get(x.key) ?? 0, fMax, f.families.has(x.key), () => {
          const next = new Set(f.families);
          if (next.has(x.key)) next.delete(x.key);
          else next.add(x.key);
          app.setFilters({ families: next });
        });
        row.title = x.note;
        return row;
      }),
    );

    const owners = [...facets.owners.entries()].sort((a, b) => b[1] - a[1]);
    for (const o of f.owners) if (!facets.owners.has(o)) owners.push([o, 0]);
    const shown = ownersExpanded ? owners : owners.slice(0, 8).concat(owners.slice(8).filter(([k]) => f.owners.has(k)));
    const oMax = owners[0]?.[1] ?? 0;
    ownerFacet.replaceChildren(
      ...shown.map(([k, c]) =>
        h(
          'div',
          { class: 'frow-wrap' },
          toggleRow(ownerName(k), null, c, oMax, f.owners.has(k), () => {
            const next = new Set(f.owners);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            app.setFilters({ owners: next });
          }, k),
          h('button', { class: 'frow-more', title: `${ownerName(k)}: owner profile`, 'aria-label': `${ownerName(k)} profile`, onclick: () => app.setProfile(k) }, '›'),
        ),
      ),
    );
    ownerMore.textContent = ownersExpanded ? 'Show fewer' : `Show all ${owners.length}`;
    ownerMore.hidden = owners.length <= 8;
    ownerClear.hidden = !f.owners.size;
    groupClear.hidden = !f.groups.size;

    // Groups by category
    const cats = new Map<string, { i: number; label: string; n: number }[]>();
    app.cat.groups.forEach((g, i) => {
      const c = facets.groups.get(i) ?? 0;
      if (!c && !f.groups.has(i)) return;
      if (!cats.has(g.category)) cats.set(g.category, []);
      cats.get(g.category)!.push({ i, label: g.label, n: c });
    });
    const nodes: Node[] = [];
    for (const [cat, list] of cats) {
      nodes.push(h('div', { class: 'group-cat' }, cat));
      nodes.push(
        h(
          'div',
          { class: 'chips' },
          ...list.map((g) =>
            h(
              'button',
              {
                class: 'chip',
                'aria-pressed': String(f.groups.has(g.i)),
                onclick: () => {
                  const next = new Set(f.groups);
                  if (next.has(g.i)) next.delete(g.i);
                  else next.add(g.i);
                  app.setFilters({ groups: next });
                },
              },
              g.label,
              h('span', { class: 'n' }, fmtCompact(g.n)),
            ),
          ),
        ),
      );
    }
    if (!nodes.length) nodes.push(h('div', { class: 'empty', style: 'padding:8px 0' }, 'No mission groups in this catalog.'));
    groupBox.replaceChildren(...nodes);

    yearRange.update(facets.years);
    altRange.update(facets.alts);
    renderResults(true);
  }

  let lastClickExclusive = false;
  root.addEventListener('pointerdown', (e) => (lastClickExclusive = e.altKey || e.shiftKey), true);

  // ---------- results (virtualised) ----------
  const ROW = 52;
  let rendered = '';
  function renderResults(force = false) {
    if (resultsPane.hidden) return;
    const list = app.results;
    resultsInner.style.height = `${Math.max(list.length * ROW, 1)}px`;
    if (!list.length) {
      resultsInner.replaceChildren(h('div', { class: 'empty' }, 'No objects match these filters.'));
      rendered = '';
      return;
    }
    const top = resultsPane.scrollTop;
    const from = Math.max(0, Math.floor(top / ROW) - 6);
    const to = Math.min(list.length, Math.ceil((top + resultsPane.clientHeight) / ROW) + 6);
    const key = `${from}:${to}:${list.length}:${list[0]?.idx}:${app.selected?.idx}:${app.colorMode}:${app.skyTime}`;
    if (!force && key === rendered) return;
    rendered = key;
    const rows: Node[] = [];
    for (let i = from; i < to; i++) {
      const o = list[i];
      const alt = (o.perigee + o.apogee) / 2;
      rows.push(
        h(
          'button',
          {
            class: 'res' + (app.selected === o ? ' active' : ''),
            style: `top:${i * ROW}px`,
            onclick: () => app.select(o, { fly: true }),
            onmouseenter: () => app.setHover(o),
            onmouseleave: () => app.setHover(null),
          },
          h('i', { class: 'd', style: `background:${app.colorsHex[o.idx]};color:${app.colorsHex[o.idx]}` }),
          h('span', { class: 't' }, h('b', null, o.name), h('span', null, `${o.norad} · ${o.cospar || '—'} · ${TYPE_LABEL[o.type]}`)),
          app.skyActive
            ? h('span', { class: 'r' }, `El ${fmt(app.skyEl[o.idx], 0)}°`, h('small', null, `Az ${fmt(app.skyAz[o.idx], 0)}° ${compass(app.skyAz[o.idx])}`))
            : h('span', { class: 'r' }, `${fmtKm(alt)} km`, h('small', null, `${o.regime} · ${o.owner}`)),
        ),
      );
    }
    resultsInner.replaceChildren(...rows);
  }
  resultsPane.addEventListener('scroll', () => renderResults());

  app.on('filters', render);
  app.on('colors', render);
  // Sky refreshes arrive about once a second. Never swap DOM out from under a
  // press in progress (that would swallow the click); catch up on release.
  let pressing = false;
  let pending = false;
  root.addEventListener('pointerdown', () => (pressing = true));
  window.addEventListener('pointerup', () => {
    pressing = false;
    if (pending) {
      pending = false;
      setTimeout(render, 0);
    }
  });
  app.on('sky', () => {
    if (!app.skyActive) return;
    if (pressing) pending = true;
    else render();
  });
  app.on('selection', () => renderResults(true));
  render();

  // Keyboard: "/" focuses search
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !(document.activeElement instanceof HTMLInputElement)) {
      e.preventDefault();
      document.body.classList.add('explorer-open');
      input.focus();
    }
  });

  // Mobile toggle
  $('#fab-explorer').onclick = () => {
    document.body.classList.add('explorer-open');
    setTimeout(() => input.focus(), 300);
  };
  const closeMobile = h('button', { class: 'btn', style: 'display:none', onclick: () => document.body.classList.remove('explorer-open') }, 'Done');
  root.querySelector('.explorer-foot')!.append(closeMobile);
  const mq = window.matchMedia('(max-width: 760px)');
  const syncMq = () => (closeMobile.style.display = mq.matches ? '' : 'none');
  mq.addEventListener('change', syncMq);
  syncMq();
  app.on('selection', () => {
    if (app.selected && mq.matches) document.body.classList.remove('explorer-open');
  });

  return { focus: () => input.focus(), setQuery: (q: string) => ((input.value = q), input.dispatchEvent(new Event('input'))) };
}

// ---------- dual range with histogram ----------
function makeRange(o: { min: number; max: number; bin: (i: number, n: number) => number; get: () => [number, number]; set: (a: number, b: number) => void; fmt: (v: number) => string }) {
  const canvas = h('canvas');
  const a = h('input', { type: 'range', min: o.min, max: o.max, step: 1, 'aria-label': 'Minimum' });
  const b = h('input', { type: 'range', min: o.min, max: o.max, step: 1, 'aria-label': 'Maximum' });
  const fill = h('i');
  const va = h('span');
  const vb = h('span');
  const el = h('div', { class: 'range' }, canvas, h('div', { class: 'track' }, h('div', { class: 'rail' }, fill), a, b), h('div', { class: 'vals' }, va, vb));
  let hist: ArrayLike<number> = [];

  const commit = debounce(() => o.set(Number(a.value), Number(b.value)), 60);
  const onInput = (which: HTMLInputElement) => {
    let lo = Number(a.value);
    let hi = Number(b.value);
    if (lo > hi) {
      if (which === a) a.value = String((lo = hi));
      else b.value = String((hi = lo));
    }
    sync(lo, hi);
    commit();
  };
  a.addEventListener('input', () => onInput(a));
  b.addEventListener('input', () => onInput(b));

  function sync(lo: number, hi: number) {
    const span = o.max - o.min;
    fill.style.left = `${((lo - o.min) / span) * 100}%`;
    fill.style.right = `${100 - ((hi - o.min) / span) * 100}%`;
    va.textContent = o.fmt(lo);
    vb.textContent = o.fmt(hi);
    draw(lo, hi);
  }

  function draw(lo: number, hi: number) {
    const dpr = Math.min(2, window.devicePixelRatio);
    const w = canvas.clientWidth || 320;
    const hgt = 42;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    const g = canvas.getContext('2d')!;
    g.scale(dpr, dpr);
    const n = hist.length;
    if (!n) return;
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, hist[i]);
    const bw = (w - 14) / n;
    for (let i = 0; i < n; i++) {
      const v = hist[i];
      if (!v) continue;
      const bh = Math.max(1.5, (Math.sqrt(v) / Math.sqrt(max || 1)) * (hgt - 4));
      const pos = o.bin(i, n);
      g.fillStyle = pos >= lo && pos <= hi ? '#3987e5' : 'rgba(160,190,255,0.16)';
      const x = 7 + i * bw;
      g.beginPath();
      g.roundRect(x + 0.5, hgt - bh, Math.max(1, bw - 1.5), bh, [1.5, 1.5, 0, 0]);
      g.fill();
    }
  }

  return {
    el,
    update(h: ArrayLike<number>) {
      hist = h;
      const [lo, hi] = o.get();
      a.value = String(lo);
      b.value = String(hi);
      sync(lo, hi);
    },
  };
}

export type { Filters };
