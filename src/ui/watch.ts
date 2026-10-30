import type { App, WatchTab } from '../app';
import { describeManoeuvre, MANOEUVRE_LABEL, type Breakup, type Manoeuvre } from '../data/changes';
import { TYPE_LABEL, type ObjectType, type SatObject } from '../data/catalog';
import { ownerName, siteName } from '../data/codes';
import { uncertaintyMs, type ReentryPrediction } from '../data/reentry';
import { fmtProbability, type Conjunction, type Launch } from '../data/watch';
import { $, fmtAgo, fmtDate, fmtInt, fmtKm, fmtUtc, h } from './dom';
import { fmtCountdown, fmtUncertainty, watchReentry } from './reentry';

type Tab = WatchTab;
type ConjSort = 'range' | 'soon' | 'prob';

const DAY = 86400e3;
const localTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** ▼ when the predicted miss shrank since the first prediction, ▲ when it grew. */
function trendTag(c: Conjunction) {
  const h0 = c.history?.[0];
  if (!h0 || (c.history?.length ?? 0) < 2) return '';
  const r = c.rangeKm / Math.max(h0.rangeKm, 1e-6);
  if (r < 0.8) return h('em', { class: 'trend closer', title: `Predicted closer than at first (${fmtMiss(h0.rangeKm)} ${c.history!.length - 1} updates ago)` }, '▼ ');
  if (r > 1.25) return h('em', { class: 'trend farther', title: `Predicted farther apart than at first (${fmtMiss(h0.rangeKm)})` }, '▲ ');
  return '';
}

const fmtMiss = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km`);

/**
 * The Watch panel: re-entries, close approaches and launches — everything
 * time-critical, with countdowns. Replaces the earlier Re-entries panel.
 */
/** Highlight a breakup's debris and fly to its parent. */
export function showBreakup(app: App, b: Breakup, debris: SatObject[], parent?: SatObject) {
  app.exitHistory();
  app.select(null);
  const ids = new Set(debris.map((o) => o.norad));
  if (parent) ids.add(parent.norad);
  app.setFilters({ ids, idsLabel: `${b.parent?.name ?? b.cospar} breakup` });
  if (parent) app.select(parent, { fly: true });
  else app.flyHome();
}

export function mountWatch(app: App) {
  const btn = $('#btn-watch');
  const badge = btn.querySelector('.count-badge') as HTMLElement;
  let tab: Tab = 'reentry';
  let conjSort: ConjSort = 'range';
  let openLaunch: string | null = null;

  const tabBtns: Record<Tab, HTMLButtonElement> = {} as never;
  const tabCounts: Record<Tab, HTMLElement> = {} as never;
  const tabs = h('div', { class: 'tabs watch-tabs', role: 'tablist' });
  for (const [k, label] of [
    ['reentry', 'Re-entries'],
    ['conjunctions', 'Approaches'],
    ['launches', 'Launches'],
    ['manoeuvres', 'Manoeuvres'],
    ['breakups', 'Breakups'],
  ] as [Tab, string | (Node | string)[]][]) {
    const count = h('span', { class: 'count' });
    const b = h('button', { class: 'tab', role: 'tab', onclick: () => setTab(k) }, label, count);
    tabBtns[k] = b;
    tabCounts[k] = count;
    tabs.append(b);
  }
  const sub = h('p', { class: 'rw-sub' });
  const action = h('button', { class: 'btn', hidden: true });
  const body = h('div', { class: 'scroll rw-body' });
  const foot = h('p', { class: 'rw-foot' });
  const panel = h(
    'div',
    { class: 'reentry-panel watch-panel', hidden: true, role: 'dialog', 'aria-label': 'Watch: re-entries, close approaches and launches' },
    h('div', { class: 'rw-head' }, h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 'eyebrow' }, 'Watch'), tabs, h('div', { class: 'rw-subrow' }, sub, action))),
    body,
    foot,
  );
  document.getElementById('app')!.append(panel);

  const now = () => Date.now();
  const upcomingReentries = () => (app.reentry?.upcoming ?? []).filter((u) => u.decayMs > now() - 6 * 3600e3);
  const upcomingConj = () => (app.conjunctions?.items ?? []).filter((c) => c.tcaMs > now() - 600e3);
  const upcomingLaunches = () => (app.launches?.upcoming ?? []).filter((l) => l.netMs > now() - 3 * 3600e3).sort((a, b) => a.netMs - b.netMs);

  const dot = (o: SatObject | undefined) => {
    const c = o ? app.colorsHex[o.idx] : '#7d8394';
    return h('i', { class: 'd', style: `background:${c};color:${c}` });
  };
  const countdown = (ms: number) => h('b', { 'data-cd': String(ms) }, fmtCountdown(ms - now()));

  // ---------- re-entries ----------
  function reentryRow(p: ReentryPrediction) {
    const o = app.cat.byNorad.get(p.norad);
    const meta = o ? `${p.norad} · ${TYPE_LABEL[o.type]} · ${ownerName(o.owner)}` : `${p.norad}${p.cospar ? ' · ' + p.cospar : ''}`;
    return h(
      'button',
      {
        class: 'rw-row' + (p.decayMs - now() < DAY ? ' soon' : ''),
        disabled: !o,
        title: o ? 'Show on the globe' : 'Not in the current catalogue',
        onclick: () => {
          if (!o) return;
          app.exitHistory();
          open(false);
          app.select(o, { fly: true });
        },
      },
      dot(o),
      h(
        'span',
        { class: 't' },
        h('b', null, p.name, p.source === 'tip' ? h('em', { class: 'tag tip', title: 'Final Tracking & Impact Prediction' }, 'TIP') : null, p.tip?.highInterest ? h('em', { class: 'tag hi' }, 'High interest') : null),
        h('span', null, meta),
      ),
      h('span', { class: 'r' }, countdown(p.decayMs), h('small', null, `${fmtUtc(p.decayMs, false).slice(5)} UTC ${fmtUncertainty(uncertaintyMs(p, now()))}`)),
    );
  }

  function renderReentries() {
    const d = app.reentry;
    const up = upcomingReentries();
    action.hidden = !d?.predictions || !up.length;
    action.textContent = 'Show these on the globe';
    action.onclick = () => {
      app.exitHistory();
      app.select(null);
      app.setFilters({ ids: new Set(up.map((u) => u.norad)), idsLabel: 'Re-entry watch' });
      app.flyHome();
      open(false);
    };
    foot.textContent =
      'Predictions from the U.S. Space Force via Space-Track.org. Early predictions are uncertain — roughly ±20% of the time remaining — and narrow to a final Tracking & Impact Prediction (TIP) shortly before re-entry.';
    if (!d) {
      sub.textContent = 'Re-entry data is unavailable right now.';
      body.replaceChildren();
      return;
    }
    sub.textContent = `${d.predictions ? `${up.length} predicted` : 'No predictions in this build'} · updated ${fmtDate(d.generated.slice(0, 10))}${d.sample ? ' · sample data' : ''}`;
    const list: Node[] = [];
    if (d.predictions) list.push(...(up.length ? up.map(reentryRow) : [h('p', { class: 'rw-empty' }, 'No re-entries are currently predicted.')]));
    else {
      // Without Space-Track there are no predictions; show the lowest orbits instead.
      const low = app.cat.objects
        .slice(0, app.liveCount)
        .filter((o) => app.prop.valid[o.idx] && o.perigee < 260)
        .sort((a, b) => a.perigee - b.perigee)
        .slice(0, 15);
      list.push(
        h('p', { class: 'rw-empty' }, 'Predictions need Space-Track data (see the README). Meanwhile, these are the lowest orbits right now — the objects most likely to come down soon.'),
        ...low.map((o) =>
          h(
            'button',
            { class: 'rw-row', onclick: () => (open(false), app.select(o, { fly: true })) },
            dot(o),
            h('span', { class: 't' }, h('b', null, o.name), h('span', null, `${o.norad} · ${TYPE_LABEL[o.type]}`)),
            h('span', { class: 'r' }, h('b', null, `${fmtKm(o.perigee)} km`), h('small', null, 'perigee')),
          ),
        ),
      );
    }
    body.replaceChildren(
      h('h4', { class: 'rw-h' }, 'Coming down'),
      h('div', { class: 'rw-list' }, ...list),
      h('h4', { class: 'rw-h' }, 'Re-entered in the last 30 days'),
      h(
        'div',
        { class: 'rw-list' },
        ...(d.recent.length
          ? d.recent.slice(0, 40).map((r) =>
              h(
                'button',
                { class: 'rw-row', title: 'Replay its last day in history mode', onclick: () => (open(false), watchReentry(app, r.norad, r.decay)) },
                h('i', { class: 'd gone' }),
                h('span', { class: 't' }, h('b', null, r.name), h('span', null, `${r.norad} · ${TYPE_LABEL[(r.type as ObjectType) || 'U'] ?? r.type} · ${ownerName(r.owner)}`)),
                h('span', { class: 'r' }, h('b', null, fmtDate(r.decay)), h('small', null, 'replay ▸')),
              ),
            )
          : [h('p', { class: 'rw-empty' }, 'None recorded in the last 30 days.')]),
      ),
    );
  }

  // ---------- close approaches ----------
  function conjRow(c: Conjunction) {
    const a = app.cat.byNorad.get(c.a.norad);
    const b = app.cat.byNorad.get(c.b.norad);
    const ok = !!a && !!b;
    return h(
      'button',
      {
        class: 'rw-row conj' + (c.tcaMs - now() < DAY ? ' soon' : ''),
        disabled: !ok,
        title: ok ? 'Watch the encounter' : 'One of these objects is not in the current catalogue',
        onclick: () => {
          if (!ok) return;
          open(false);
          app.showEncounter(c.a.norad, c.b.norad, c.tcaMs, c.rangeKm);
        },
      },
      h('span', { class: 'pair-dots' }, dot(a), dot(b)),
      h(
        'span',
        { class: 't' },
        h('b', null, a?.name ?? c.a.name, h('em', { class: 'x' }, '×'), b?.name ?? c.b.name),
        h('span', null, `${c.a.norad} × ${c.b.norad}${c.speedKms ? ` · ${c.speedKms.toFixed(1)} km/s` : ''} · ${fmtProbability(c.prob)}`),
      ),
      h('span', { class: 'r' }, h('b', null, trendTag(c), fmtMiss(c.rangeKm)), h('small', { 'data-cd-s': String(c.tcaMs) }, fmtCountdown(c.tcaMs - now()))),
    );
  }

  function renderConjunctions() {
    const d = app.conjunctions;
    const items = upcomingConj();
    action.hidden = true;
    foot.textContent =
      'Predicted close approaches from CelesTrak SOCRATES, computed from public element sets. Operators use more precise data to decide whether to move a satellite; probabilities here are a rough guide.';
    if (!d || !d.available) {
      sub.textContent = 'Close-approach predictions are unavailable right now.';
      body.replaceChildren();
      return;
    }
    sub.textContent = `${items.length} in the next 7 days · updated ${fmtDate(d.generated.slice(0, 10))}${d.sample ? ' · sample data' : ''}`;
    const sorted = [...items].sort((x, y) => (conjSort === 'range' ? x.rangeKm - y.rangeKm : conjSort === 'soon' ? x.tcaMs - y.tcaMs : (y.prob ?? 0) - (x.prob ?? 0)));
    const seg = h('div', { class: 'seg', style: 'margin:8px 14px 4px' });
    for (const [k, l] of [
      ['range', 'Closest'],
      ['soon', 'Soonest'],
      ['prob', 'Most likely'],
    ] as [ConjSort, string][])
      seg.append(h('button', { 'aria-pressed': String(conjSort === k), onclick: () => ((conjSort = k), render()) }, l));
    body.replaceChildren(seg, h('div', { class: 'rw-list' }, ...(sorted.length ? sorted.map(conjRow) : [h('p', { class: 'rw-empty' }, 'No close approaches listed.')])));
  }

  // ---------- launches ----------
  function launchRow(l: Launch) {
    const expanded = openLaunch === l.id;
    const statusTone = /go|success/i.test(l.status ?? '') ? 'go' : /hold|fail/i.test(l.status ?? '') ? 'hold' : '';
    const row = h(
      'button',
      {
        class: 'rw-row launch' + (l.netMs - now() < DAY ? ' soon' : '') + (expanded ? ' open' : ''),
        onclick: () => {
          openLaunch = expanded ? null : l.id;
          render();
          if (!expanded && l.lat !== null && l.lon !== null) app.flyToLatLon(l.lat, l.lon);
        },
      },
      h('i', { class: 'd rocket' }),
      h(
        'span',
        { class: 't' },
        h('b', null, l.mission ?? l.name, l.status ? h('em', { class: `tag st ${statusTone}`, title: l.statusName ?? '' }, l.status) : null),
        h('span', null, [l.rocket, l.provider].filter(Boolean).join(' · ')),
      ),
      h('span', { class: 'r' }, countdown(l.netMs), h('small', null, localTime.format(l.netMs))),
    );
    if (!expanded) return row;
    const det = h(
      'div',
      { class: 'launch-detail' },
      l.image ? h('img', { src: l.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      h(
        'dl',
        { class: 'kv one' },
        ...([
          ['Launch site', [l.pad, l.location].filter(Boolean).join(', ') || '—'],
          ['Window', l.windowStart && l.windowEnd && l.windowStart !== l.windowEnd ? `${fmtUtc(Date.parse(l.windowStart), false)} – ${fmtUtc(Date.parse(l.windowEnd), false).slice(11)} UTC` : `${fmtUtc(l.netMs, false)} UTC`],
          ['Target orbit', l.orbit ?? '—'],
          ['Mission type', l.missionType ?? '—'],
          ['Status', l.statusName ?? l.status ?? '—'],
        ] as [string, string][]).map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))),
      ),
      l.description ? h('p', { class: 'sky-hint', style: 'margin:8px 0 0' }, l.description) : null,
      h('button', { class: 'btn primary', style: 'margin-top:10px', onclick: () => (open(false), app.followLaunch(l.id)) }, 'Launch day mode ›'),
    );
    return h('div', null, row, det);
  }

  /** Launches in the last 30 days, grouped by international designator, from the catalogue. */
  function recentLaunches() {
    const cutoff = now() - 30 * DAY;
    const groups = new Map<string, SatObject[]>();
    for (const o of app.cat.objects.slice(0, app.liveCount)) {
      if (!o.launch || Date.parse(o.launch) < cutoff) continue;
      const m = o.cospar.match(/^(\d{4}-\d{3})/);
      if (!m) continue;
      if (!groups.has(m[1])) groups.set(m[1], []);
      groups.get(m[1])!.push(o);
    }
    return [...groups.entries()].sort((a, b) => (a[1][0].launch < b[1][0].launch ? 1 : -1));
  }

  function renderLaunches() {
    const d = app.launches;
    const up = upcomingLaunches();
    action.hidden = true;
    foot.textContent = "Launch schedule from The Space Devs' Launch Library 2 — times change often. Recent launches are grouped from the catalogue by international designator.";
    sub.textContent = d?.available ? `${up.length} upcoming · updated ${fmtDate(d.generated.slice(0, 10))}${d.sample ? ' · sample data' : ''}` : 'The launch schedule is unavailable right now.';
    const recent = recentLaunches();
    body.replaceChildren(
      h('h4', { class: 'rw-h' }, 'Upcoming'),
      h('div', { class: 'rw-list' }, ...(up.length ? up.map(launchRow) : [h('p', { class: 'rw-empty' }, 'No upcoming launches listed.')])),
      h('h4', { class: 'rw-h' }, 'Launched in the last 30 days'),
      h(
        'div',
        { class: 'rw-list' },
        ...(recent.length
          ? recent.slice(0, 30).map(([des, objs]) => {
              const lead = objs.find((o) => o.type === 'P') ?? objs[0];
              return h(
                'button',
                {
                  class: 'rw-row',
                  title: 'Show the objects from this launch',
                  onclick: () => {
                    open(false);
                    app.exitHistory();
                    app.select(null);
                    app.setFilters({ ids: new Set(objs.map((o) => o.norad)), idsLabel: `Launch ${des}` });
                    app.select(lead, { fly: true });
                  },
                },
                dot(lead),
                h('span', { class: 't' }, h('b', null, lead.name, objs.length > 1 ? h('em', { class: 'tag' }, `+${objs.length - 1}`) : null), h('span', null, `${des} · ${siteName(lead.site)}`)),
                h('span', { class: 'r' }, h('b', null, fmtDate(lead.launch)), h('small', null, `${fmtInt(objs.length)} object${objs.length === 1 ? '' : 's'}`)),
              );
            })
          : [h('p', { class: 'rw-empty' }, 'No launches in the catalogue from the last 30 days.')]),
      ),
    );
  }

  // ---------- manoeuvres ----------
  const recentManoeuvres = () => (app.manoeuvres?.items ?? []).filter((m) => m.tMs > now() - 14 * DAY && app.cat.byNorad.has(m.norad));
  let manKind: Manoeuvre['kind'] | 'all' = 'all';
  function renderManoeuvres() {
    const d = app.manoeuvres;
    const all = recentManoeuvres();
    const items = manKind === 'all' ? all : all.filter((m) => m.kind === manKind);
    action.hidden = !items.length;
    action.textContent = 'Show these on the globe';
    action.onclick = () => {
      app.exitHistory();
      app.select(null);
      app.setFilters({ ids: new Set(items.map((m) => m.norad)), idsLabel: 'Recently manoeuvred' });
      app.flyHome();
      open(false);
    };
    foot.textContent =
      'Detected by comparing each satellite’s latest element set with the one before: a change in orbit size or tilt larger than drag and fitting noise explain. Δv is a rough estimate; small or frequent burns (e.g. Starlink’s) may be missed or merged.';
    if (!d || !d.available) {
      sub.textContent = d ? 'Detection starts with the next data update (it compares two builds).' : 'Manoeuvre data is unavailable right now.';
      body.replaceChildren();
      return;
    }
    sub.textContent = `${all.length} in the last 14 days · updated ${fmtDate(d.generated.slice(0, 10))}${d.sample ? ' · sample data' : ''}`;
    const seg = h('div', { class: 'seg', style: 'margin:8px 14px 4px' });
    for (const [k, l] of [['all', 'All'], ['raise', 'Raised'], ['lower', 'Lowered'], ['plane', 'Plane change']] as [typeof manKind, string][])
      seg.append(h('button', { 'aria-pressed': String(manKind === k), onclick: () => ((manKind = k), render()) }, l));
    body.replaceChildren(
      seg,
      h(
        'div',
        { class: 'rw-list' },
        ...(items.length
          ? items.slice(0, 150).map((m) => {
              const o = app.cat.byNorad.get(m.norad)!;
              return h(
                'button',
                { class: 'rw-row', title: 'Show on the globe', onclick: () => (app.exitHistory(), open(false), app.select(o, { fly: true })) },
                dot(o),
                h('span', { class: 't' }, h('b', null, o.name, h('em', { class: `tag man ${m.kind}` }, MANOEUVRE_LABEL[m.kind])), h('span', null, `${o.norad} · ${ownerName(o.owner)} · ${describeManoeuvre(m).split(' · ')[1]}`)),
                h('span', { class: 'r' }, h('b', null, m.kind === 'plane' ? `${m.diDeg > 0 ? '+' : ''}${m.diDeg.toFixed(3)}°` : `${m.daKm > 0 ? '+' : ''}${m.daKm.toFixed(1)} km`), h('small', null, fmtAgo(now() - m.tMs))),
              );
            })
          : [h('p', { class: 'rw-empty' }, 'No manoeuvres detected in the last 14 days.')]),
      ),
    );
  }

  // ---------- breakups ----------
  const debrisOf = (b: Breakup) => app.cat.objects.slice(0, app.liveCount).filter((o) => o.type === 'D' && o.cospar.startsWith(b.cospar));
  function renderBreakups() {
    const d = app.breakups;
    const items = d?.items ?? [];
    action.hidden = true;
    foot.textContent =
      'A breakup shows up as a jump in the debris catalogued from one launch between data updates. New pieces are added over days to weeks, so recent events keep growing. Counts depend on what the public catalogue lists.';
    if (!d || !d.available) {
      sub.textContent = d ? 'Detection starts with the next data update (it compares two builds).' : 'Breakup data is unavailable right now.';
      body.replaceChildren();
      return;
    }
    sub.textContent = `${items.length} in the last 180 days · updated ${fmtDate(d.generated.slice(0, 10))}${d.sample ? ' · sample data' : ''}`;
    body.replaceChildren(
      h(
        'div',
        { class: 'rw-list' },
        ...(items.length
          ? items.map((b) => {
              const parent = b.parent ? app.cat.byNorad.get(b.parent.norad) : undefined;
              return h(
                'button',
                {
                  class: 'rw-row' + (now() - b.firstMs < 7 * DAY ? ' soon' : ''),
                  title: 'Show the debris on the globe',
                  onclick: () => {
                    open(false);
                    showBreakup(app, b, debrisOf(b), parent);
                  },
                },
                h('i', { class: 'd', style: 'background:#ff6b5b;color:#ff6b5b' }),
                h('span', { class: 't' }, h('b', null, `${b.parent?.name ?? b.cospar}`, h('em', { class: 'tag hi' }, `+${fmtInt(b.added)} pieces`)), h('span', null, `${b.cospar} · ${b.parent ? `${TYPE_LABEL[b.parent.type as ObjectType] ?? ''} · ${ownerName(b.parent.owner)}` : 'parent unknown'}`)),
                h('span', { class: 'r' }, h('b', null, fmtDate(b.first.slice(0, 10))), h('small', null, `${fmtInt(b.total)} catalogued`)),
              );
            })
          : [h('p', { class: 'rw-empty' }, 'No new breakups detected in the last 180 days.')]),
      ),
    );
  }

  // ---------- shell ----------
  function render() {
    tabCounts.reentry.textContent = String(upcomingReentries().length || '');
    tabCounts.conjunctions.textContent = String(upcomingConj().length || '');
    tabCounts.launches.textContent = String(upcomingLaunches().length || '');
    tabCounts.manoeuvres.textContent = String(recentManoeuvres().length || '');
    tabCounts.breakups.textContent = String(app.breakups?.items.length || '');
    for (const k of Object.keys(tabBtns) as Tab[]) tabBtns[k].setAttribute('aria-selected', String(k === tab));
    // Badge: anything happening in the next 24 hours.
    const soon =
      upcomingReentries().filter((u) => u.decayMs - now() < DAY).length +
      upcomingConj().filter((c) => c.tcaMs - now() < DAY).length +
      upcomingLaunches().filter((l) => l.netMs - now() < DAY).length;
    badge.hidden = !soon;
    badge.textContent = String(soon);
    btn.title = soon ? `Watch: ${soon} in the next 24 hours (R)` : 'Watch: re-entries, close approaches, launches (R)';
    if (panel.hidden) return;
    if (tab === 'reentry') renderReentries();
    else if (tab === 'conjunctions') renderConjunctions();
    else if (tab === 'launches') renderLaunches();
    else if (tab === 'manoeuvres') renderManoeuvres();
    else renderBreakups();
  }

  function setTab(t: Tab) {
    tab = t;
    body.scrollTop = 0;
    render();
  }

  const open = (v: boolean) => {
    panel.hidden = !v;
    btn.setAttribute('aria-pressed', String(v));
    if (v) render();
  };
  app.openWatch = (t, id) => {
    tab = t;
    if (id) openLaunch = id;
    open(true);
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    open(!!panel.hidden);
  };
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Element;
    if (!panel.hidden && !panel.contains(t) && !btn.contains(t) && !t.closest?.('.launch-pin')) open(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'r' || e.key === 'R') open(!!panel.hidden);
    if (e.key === 'Escape' && !panel.hidden) open(false);
  });
  // Live countdowns
  setInterval(() => {
    if (panel.hidden) return;
    for (const el of panel.querySelectorAll<HTMLElement>('[data-cd]')) el.textContent = fmtCountdown(Number(el.dataset.cd) - now());
    for (const el of panel.querySelectorAll<HTMLElement>('[data-cd-s]')) el.textContent = fmtCountdown(Number(el.dataset.cdS) - now());
  }, 1000);
  setInterval(render, 60e3);

  app.on('reentry', render);
  app.on('watch', render);
  app.on('colors', () => !panel.hidden && render());
  render();
}
