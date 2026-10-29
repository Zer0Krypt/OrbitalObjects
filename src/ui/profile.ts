import type { App } from '../app';
import { REGIME_LABEL, TYPE_LABEL, type ObjectType, type Regime, type SatObject } from '../data/catalog';
import { OPS_STATUS, ownerName, siteName } from '../data/codes';
import { STATUS_COLORS, TYPE_COLOR } from '../data/model';
import { fmtCompact, fmtDate, fmtInt, h, icon, ICONS, s } from './dom';

const TYPES: ObjectType[] = ['P', 'R', 'D', 'U'];
const REGIMES: Regime[] = ['LEO', 'MEO', 'GEO', 'HEO', 'XGEO'];
const FIRST_YEAR = 1957;

const yearEnd = (y: number) => Date.UTC(y, 11, 31, 23, 59);
const decayMs = (o: SatObject) => (o.decay ? Date.parse(o.decay + 'T12:00:00Z') : Infinity);
const launchMs = (o: SatObject) => (o.launch ? Date.parse(o.launch + 'T00:00:00Z') : NaN);

/** Payload status buckets (status colours are reserved for state). */
function statusBucket(o: SatObject): 'good' | 'warn' | 'muted' | 'unknown' {
  const st = OPS_STATUS[o.status];
  if (!st || o.status === '?') return 'unknown';
  if (st.tone === 'good') return 'good';
  if (st.tone === 'warn') return 'warn';
  return 'muted';
}

/** A profile of one owner / operator: fleet over time, orbits, status, groups, sites, notable objects. */
export function mountProfile(app: App) {
  const root = h('aside', { class: 'panel info profile', id: 'profile', hidden: true, 'aria-label': 'Owner profile' });
  document.getElementById('app')!.append(root);

  function build() {
    const code = app.profile;
    root.hidden = !code;
    if (!code) {
      root.replaceChildren();
      return;
    }
    const all = app.cat.objects.filter((o) => o.owner === code);
    const inOrbit = all.filter((o) => !o.decay);
    const gone = all.filter((o) => o.decay);
    const historyReady = app.historyStatus === 'ready';
    const by = (list: SatObject[], t: ObjectType) => list.filter((o) => o.type === t).length;
    const activePayloads = inOrbit.filter((o) => o.type === 'P' && statusBucket(o) === 'good').length;

    const close = h('button', { class: 'close', 'aria-label': 'Close profile', onclick: () => app.setProfile(null) }, icon(ICONS.close));
    const head = h(
      'div',
      { class: 'info-head' },
      close,
      h('div', { class: 'eyebrow' }, 'Owner / operator'),
      h('h2', null, ownerName(code)),
      h('div', { class: 'ids' }, h('span', null, 'Code ', h('b', null, code)), h('span', null, 'Objects catalogued ', h('b', null, historyReady ? fmtInt(all.length) : '…'))),
    );
    const actions = h(
      'div',
      { class: 'info-actions' },
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            app.setFilters({ owners: new Set([code]) });
            app.flyHome();
          },
        },
        icon(ICONS.target),
        'Show on globe',
      ),
      h('button', { class: 'btn', onclick: () => app.setColorMode('owner') }, 'Colour by owner'),
    );

    const cell = (label: string, v: string, sub?: string) => h('div', null, h('div', { class: 'l' }, label), h('div', { class: 'v' }, v, sub ? h('small', null, sub) : ''));
    const kpis = h(
      'div',
      { class: 'live' },
      cell('In orbit now', fmtInt(inOrbit.length)),
      cell('Active payloads', fmtInt(activePayloads)),
      cell('Debris', fmtInt(by(inOrbit, 'D'))),
      cell('Rocket bodies', fmtInt(by(inOrbit, 'R'))),
      cell('Re-entered', historyReady ? fmtInt(gone.length) : '…'),
      cell('Payloads ever', historyReady ? fmtInt(by(all, 'P')) : '…'),
    );

    const sections: (Node | string)[] = [kpis, fleetChart(all, historyReady), regimeSection(inOrbit), statusSection(inOrbit), groupSection(inOrbit, code), siteSection(all), notableSection(inOrbit)];
    root.replaceChildren(head, actions, h('div', { class: 'scroll', style: 'flex:1' }, ...sections));
  }

  // ---------- fleet over time ----------
  function fleetChart(all: SatObject[], historyReady: boolean) {
    const thisYear = new Date().getUTCFullYear();
    const years = thisYear - FIRST_YEAR + 1;
    const counts = Array.from({ length: years }, () => ({ P: 0, R: 0, D: 0, U: 0 }) as Record<ObjectType, number>);
    for (const o of all) {
      const l = launchMs(o);
      if (!Number.isFinite(l)) continue;
      const d = decayMs(o);
      const y0 = Math.max(FIRST_YEAR, new Date(l).getUTCFullYear());
      for (let y = y0; y <= thisYear; y++) {
        const t = y === thisYear ? Date.now() : yearEnd(y);
        if (d <= t) break;
        counts[y - FIRST_YEAR][o.type]++;
      }
    }
    const totals = counts.map((c) => c.P + c.R + c.D + c.U);
    const W = 372;
    const H = 120;
    const pad = { l: 36, r: 6, t: 8, b: 16 };
    const max = Math.max(1, ...totals);
    const X = (i: number) => pad.l + (i / (years - 1)) * (W - pad.l - pad.r);
    const Y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const svg = s('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Objects in orbit by year, stacked by type' });
    for (const v of [max / 2, max]) {
      svg.append(s('line', { class: 'grid', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
      svg.append(s('text', { x: pad.l - 4, y: Y(v) + 3, 'text-anchor': 'end' }, fmtCompact(v)));
    }
    for (let y = 1960; y <= thisYear; y += 20) svg.append(s('text', { x: X(y - FIRST_YEAR), y: H - 3, 'text-anchor': 'middle' }, String(y)));
    // Stacked areas, bottom to top: payloads, rocket bodies, debris, unknown.
    const base = new Array(years).fill(0);
    for (const t of TYPES) {
      const top = counts.map((c, i) => base[i] + c[t]);
      if (top.every((v, i) => v === base[i])) continue;
      const back = base.map((_, i) => `L${X(years - 1 - i).toFixed(1)},${Y(base[years - 1 - i]).toFixed(1)}`).join('');
      const d = `M${X(0)},${Y(base[0])}` + top.map((v, i) => `L${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('') + back + 'Z';
      svg.append(s('path', { d, fill: TYPE_COLOR[t], 'fill-opacity': 0.85, stroke: 'none' }));
      for (let i = 0; i < years; i++) base[i] = top[i];
    }
    const cursor = s('line', { class: 'grid', y1: pad.t, y2: H - pad.b, stroke: 'rgba(255,255,255,0.4)', visibility: 'hidden' });
    svg.append(cursor);
    const tooltip = document.getElementById('tooltip')!;
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(years - 1, Math.round(((((e.clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r)) * (years - 1))));
      cursor.setAttribute('x1', String(X(i)));
      cursor.setAttribute('x2', String(X(i)));
      cursor.setAttribute('visibility', 'visible');
      tooltip.hidden = false;
      tooltip.style.left = `${e.clientX}px`;
      tooltip.style.top = `${e.clientY}px`;
      tooltip.replaceChildren(
        h('b', null, `End of ${FIRST_YEAR + i}`),
        ...TYPES.filter((t) => counts[i][t]).map((t) => h('div', { class: 'tt-row' }, h('span', null, h('i', { style: `background:${TYPE_COLOR[t]}` }), TYPE_LABEL[t]), h('span', null, fmtInt(counts[i][t])))),
        h('div', { class: 'tt-row' }, h('span', null, 'In orbit'), h('span', null, fmtInt(totals[i]))),
      );
    });
    svg.addEventListener('mouseleave', () => {
      tooltip.hidden = true;
      cursor.setAttribute('visibility', 'hidden');
    });
    const peak = totals.indexOf(max);
    return h(
      'div',
      { class: 'isec' },
      h('h3', null, 'Fleet in orbit over time', h('span', null, historyReady ? 'incl. re-entered objects' : 'loading history…')),
      h('div', { class: 'chart-legend' }, ...TYPES.map((t) => h('span', null, h('i', { style: `background:${TYPE_COLOR[t]}` }), TYPE_LABEL[t]))),
      svg,
      h('p', { class: 'sky-hint', style: 'margin:4px 0 0' }, historyReady ? `Peak: ${fmtInt(max)} objects in orbit (${FIRST_YEAR + peak === thisYear ? 'today' : `end of ${FIRST_YEAR + peak}`}).` : 'Showing objects still in orbit until the history data loads.'),
    );
  }

  // ---------- orbits ----------
  function regimeSection(inOrbit: SatObject[]) {
    const n = Math.max(1, inOrbit.length);
    const rows = REGIMES.map((r) => [r, inOrbit.filter((o) => o.regime === r).length] as const).filter(([, c]) => c > 0);
    return h(
      'div',
      { class: 'isec' },
      h('h3', null, 'Where they orbit'),
      h(
        'div',
        { class: 'facet' },
        ...rows.map(([r, c]) =>
          h(
            'button',
            { class: 'frow', 'aria-pressed': 'true', onclick: () => app.setFilters({ owners: new Set([app.profile!]), regimes: new Set([r]) }), title: `Show ${REGIME_LABEL[r]} objects on the globe` },
            h('i', { class: 'sw', style: 'background:var(--accent-2)' }),
            h('span', { class: 'lbl' }, REGIME_LABEL[r], h('small', null, r === 'XGEO' ? '' : r)),
            h('span', { class: 'n' }, `${fmtInt(c)} · ${Math.round((c / n) * 100)}%`),
            h('span', { class: 'bar' }, h('i', { style: `width:${(c / n) * 100}%;background:var(--accent-2)` })),
          ),
        ),
      ),
    );
  }

  // ---------- status ----------
  function statusSection(inOrbit: SatObject[]) {
    const payloads = inOrbit.filter((o) => o.type === 'P');
    const buckets: [string, string, number][] = [
      ['Operational', STATUS_COLORS.good, payloads.filter((o) => statusBucket(o) === 'good').length],
      ['Partial / standby', STATUS_COLORS.warn, payloads.filter((o) => statusBucket(o) === 'warn').length],
      ['Non-operational', STATUS_COLORS.muted, payloads.filter((o) => statusBucket(o) === 'muted').length],
      ['Unknown', '#3a3f4b', payloads.filter((o) => statusBucket(o) === 'unknown').length],
    ];
    const n = Math.max(1, payloads.length);
    return h(
      'div',
      { class: 'isec' },
      h('h3', null, 'Payloads: active vs. inactive', h('span', null, `${fmtInt(payloads.length)} in orbit`)),
      h('div', { class: 'status-bar' }, ...buckets.filter(([, , c]) => c).map(([l, c, v]) => h('i', { style: `flex:${v};background:${c}`, title: `${l}: ${fmtInt(v)}` }))),
      h('div', { class: 'chart-legend', style: 'margin-top:8px' }, ...buckets.filter(([, , c]) => c).map(([l, c, v]) => h('span', null, h('i', { style: `background:${c}` }), `${l} ${fmtInt(v)} (${Math.round((v / n) * 100)}%)`))),
    );
  }

  // ---------- groups ----------
  function groupSection(inOrbit: SatObject[], code: string) {
    const m = new Map<number, number>();
    for (const o of inOrbit) for (const g of o.groups) m.set(g, (m.get(g) ?? 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (!top.length) return '';
    return h(
      'div',
      { class: 'isec' },
      h('h3', null, 'Constellations & missions'),
      h(
        'div',
        { class: 'chips' },
        ...top.map(([g, c]) =>
          h('button', { class: 'chip', onclick: () => app.setFilters({ owners: new Set([code]), groups: new Set([g]) }) }, app.cat.groups[g]?.label ?? '?', h('span', { class: 'n' }, fmtCompact(c))),
        ),
      ),
    );
  }

  // ---------- sites ----------
  function siteSection(all: SatObject[]) {
    // Count launches (distinct designators), not objects.
    const launches = new Map<string, string>();
    for (const o of all) {
      const m = o.cospar.match(/^(\d{4}-\d{3})/);
      if (m && o.site) launches.set(m[1], o.site);
    }
    const bySite = new Map<string, number>();
    for (const site of launches.values()) bySite.set(site, (bySite.get(site) ?? 0) + 1);
    const top = [...bySite.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!top.length) return '';
    const max = top[0][1];
    return h(
      'div',
      { class: 'isec' },
      h('h3', null, 'Launch sites', h('span', null, `${fmtInt(launches.size)} launches`)),
      h(
        'div',
        { class: 'facet' },
        ...top.map(([site, c]) =>
          h('div', { class: 'frow static' }, h('i', { class: 'sw', style: 'background:#fab219;transform:rotate(45deg)' }), h('span', { class: 'lbl' }, siteName(site), h('small', null, site)), h('span', { class: 'n' }, fmtInt(c)), h('span', { class: 'bar' }, h('i', { style: `width:${(c / max) * 100}%;background:#fab219` }))),
        ),
      ),
    );
  }

  // ---------- notable ----------
  function notableSection(inOrbit: SatObject[]) {
    const payloads = inOrbit.filter((o) => o.type === 'P' && o.launch);
    const pickBy = (list: SatObject[], f: (o: SatObject) => number, best: 'min' | 'max') =>
      list.reduce<SatObject | null>((acc, o) => (!acc || (best === 'min' ? f(o) < f(acc) : f(o) > f(acc)) ? o : acc), null);
    const oldest = pickBy(payloads, launchMs, 'min');
    const newest = pickBy(payloads, launchMs, 'max');
    const largest = pickBy(
      inOrbit.filter((o) => o.rcs !== null),
      (o) => o.rcs ?? 0,
      'max',
    );
    const row = (label: string, o: SatObject | null, detail: string) =>
      o
        ? h(
            'button',
            { class: 'rw-row', onclick: () => app.select(o, { fly: true }) },
            h('i', { class: 'd', style: `background:${app.colorsHex[o.idx]};color:${app.colorsHex[o.idx]}` }),
            h('span', { class: 't' }, h('b', null, o.name), h('span', null, label)),
            h('span', { class: 'r' }, h('small', null, detail)),
          )
        : '';
    return h(
      'div',
      { class: 'isec' },
      h('h3', null, 'Notable objects'),
      h(
        'div',
        { class: 'rw-list notable' },
        row('Oldest payload still in orbit', oldest, oldest ? fmtDate(oldest.launch) : ''),
        row('Most recent launch', newest, newest ? fmtDate(newest.launch) : ''),
        row('Largest radar cross-section', largest, largest?.rcs ? `${largest.rcs.toFixed(1)} m²` : ''),
      ),
    );
  }

  app.on('profile', build);
  // History data (re-entered objects) completes the counts and the chart.
  app.on('history', () => {
    if (app.profile && app.historyStatus !== 'loading' && root.dataset.ready !== app.historyStatus) {
      root.dataset.ready = app.historyStatus;
      build();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.profile && !(e.target instanceof HTMLInputElement)) app.setProfile(null);
  });
}
