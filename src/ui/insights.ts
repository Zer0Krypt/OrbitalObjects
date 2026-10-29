import type { App } from '../app';
import { TYPE_LABEL, type ObjectType, type SatObject } from '../data/catalog';
import { ownerName } from '../data/codes';
import { SLOTS, TYPE_COLOR, YEAR_MAX, YEAR_MIN } from '../data/model';
import { $, fmt, fmtCompact, fmtInt, fmtKm, h, s } from './dom';

/** Debris clouds for the Gabbard presets: launch designator prefixes. */
const DEBRIS_CLOUDS: { label: string; prefix: string; group: string }[] = [
  { label: 'Fengyun-1C', prefix: '1999-025', group: 'fengyun-1c-debris' },
  { label: 'Cosmos 2251', prefix: '1993-036', group: 'cosmos-2251-debris' },
  { label: 'Iridium 33', prefix: '1997-051', group: 'iridium-33-debris' },
  { label: 'Cosmos 1408', prefix: '1982-092', group: 'cosmos-1408-debris' },
];

// Crowding: 20 km shells through LEO.
const SHELL_MIN = 200;
const SHELL_MAX = 2000;
const SHELL = 20;
const RE = 6371;
const N_SHELLS = (SHELL_MAX - SHELL_MIN) / SHELL;
const shellVolume = (i: number) => {
  const r1 = RE + SHELL_MIN + i * SHELL;
  const r2 = r1 + SHELL;
  return ((4 / 3) * Math.PI * (r2 ** 3 - r1 ** 3)) / 1e9; // 10⁹ km³
};

const TYPES: ObjectType[] = ['P', 'R', 'D', 'U'];
const A_MIN = 150;
const A_MAX = 100000;
const A_BINS = 54;
const LA = Math.log(A_MAX / A_MIN);
const meanAlt = (o: SatObject) => (o.perigee + o.apogee) / 2;
const altBin = (a: number) => Math.min(A_BINS - 1, Math.max(0, Math.floor((Math.log(Math.max(A_MIN, a) / A_MIN) / LA) * A_BINS)));
const binEdge = (i: number) => A_MIN * Math.exp((i / A_BINS) * LA);

export function mountInsights(app: App) {
  const root = $('#insights');
  const btn = $('#btn-insights');
  const tooltip = $('#tooltip');

  const charts = [
    chartShell('Altitude distribution', 'Mean altitude, log scale · stacked by type · click a bar to filter', true),
    chartShell('Launches per year', 'Objects in orbit, by launch year · click to filter', true),
    chartShell('Top owners', 'Objects by owner / operator · click to filter', false),
    chartShell('Inclination vs altitude', 'Every visible object · hover to identify, click to select', false),
  ];
  const gabbard = chartShell('Gabbard diagram', 'Apogee and perigee against orbital period — how a debris cloud spreads · hover to identify, click to select', false, [
    ['Apogee', SLOTS[0]],
    ['Perigee', SLOTS[1]],
  ]);
  const crowding = chartShell('Crowding by altitude', 'Objects per billion km³ in 20 km shells through low Earth orbit · stacked by type · click a shell to filter', true);
  const presets = h('div', { class: 'chips gabbard-presets' });
  gabbard.el.insertBefore(presets, gabbard.plot);

  type Tab = 'overview' | 'debris';
  let tab: Tab = 'overview';
  const tabBtns: Record<Tab, HTMLButtonElement> = {
    overview: h('button', { class: 'tab', role: 'tab', onclick: () => setTab('overview') }, 'Overview'),
    debris: h('button', { class: 'tab', role: 'tab', onclick: () => setTab('debris') }, 'Debris & crowding'),
  };
  const scope = h('span', { class: 'insights-scope' });
  const gridOverview = h('div', { class: 'insights-grid' }, ...charts.map((c) => c.el));
  const gridDebris = h('div', { class: 'insights-grid two', hidden: true }, gabbard.el, crowding.el);
  root.append(h('div', { class: 'insights-head' }, h('div', { class: 'tabs', role: 'tablist' }, tabBtns.overview, tabBtns.debris), scope), gridOverview, gridDebris);
  function setTab(t: Tab) {
    tab = t;
    for (const k of Object.keys(tabBtns) as Tab[]) tabBtns[k].setAttribute('aria-selected', String(k === t));
    gridOverview.hidden = t !== 'overview';
    gridDebris.hidden = t !== 'debris';
    schedule();
  }

  /** The objects every chart describes: filtered, and in orbit at the current date. */
  let list: SatObject[] = [];

  function tip(e: MouseEvent, title: string, rows: [string, string, string?][]) {
    tooltip.hidden = false;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.replaceChildren(
      h('b', null, title),
      ...rows.map(([k, v, c]) => h('div', { class: 'tt-row' }, h('span', null, c ? h('i', { style: `background:${c}` }) : null, k), h('span', null, v))),
    );
  }
  const untip = () => (tooltip.hidden = true);

  // ---------- 1. altitude histogram ----------
  function drawAltitude() {
    const c = charts[0];
    const bins = Array.from({ length: A_BINS }, () => ({ P: 0, R: 0, D: 0, U: 0 }) as Record<ObjectType, number>);
    for (const o of list) bins[altBin(meanAlt(o))][o.type]++;
    const totals = bins.map((b) => b.P + b.R + b.D + b.U);
    const { W, H, svg } = c.svg();
    const pad = { l: 36, r: 6, t: 6, b: 18 };
    const max = Math.max(1, ...totals);
    const bw = (W - pad.l - pad.r) / A_BINS;
    const Y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
    // Regime bands
    const X = (km: number) => pad.l + (Math.log(km / A_MIN) / LA) * (W - pad.l - pad.r);
    for (const [a, b, l] of [
      [A_MIN, 2000, 'LEO'],
      [2000, 35586, 'MEO'],
      [35586, 35986, 'GEO'],
    ] as [number, number, string][]) {
      svg.append(s('rect', { x: X(a), y: pad.t, width: Math.max(1, X(b) - X(a)), height: H - pad.t - pad.b, fill: l === 'GEO' ? 'rgba(25,158,112,0.08)' : l === 'MEO' ? 'rgba(160,190,255,0.025)' : 'rgba(160,190,255,0.045)' }));
      svg.append(s('text', { class: 'tick', x: l === 'GEO' ? X(b) + 3 : (X(a) + X(b)) / 2, y: pad.t + 10, 'text-anchor': l === 'GEO' ? 'start' : 'middle', fill: '#545c6e' }, l));
    }
    gridY(svg, max, W, pad, Y);
    for (let i = 0; i < A_BINS; i++) {
      const g = s('g');
      let y0 = H - pad.b;
      const x = pad.l + i * bw + 0.5;
      for (const t of TYPES) {
        const v = bins[i][t];
        if (!v) continue;
        const hgt = (v / max) * (H - pad.t - pad.b);
        g.append(s('rect', { class: 'mark', x, y: y0 - hgt, width: Math.max(1, bw - 1.5), height: Math.max(0.5, hgt - (y0 < H - pad.b ? 1 : 0)), fill: TYPE_COLOR[t], rx: 1 }));
        y0 -= hgt;
      }
      const hit = s('rect', { class: 'hit', x: pad.l + i * bw, y: pad.t, width: bw, height: H - pad.t - pad.b });
      hit.addEventListener('mousemove', (e) =>
        tip(e as MouseEvent, `${fmtKm(binEdge(i))} – ${fmtKm(binEdge(i + 1))} km`, [
          ...TYPES.filter((t) => bins[i][t]).map((t) => [TYPE_LABEL[t], fmtInt(bins[i][t]), TYPE_COLOR[t]] as [string, string, string]),
          ['Total', fmtInt(totals[i])],
        ]),
      );
      hit.addEventListener('mouseleave', untip);
      hit.addEventListener('click', () => app.setFilters({ altMin: binEdge(i), altMax: binEdge(i + 1) }));
      svg.append(g, hit);
    }
    for (const km of [200, 500, 1000, 2000, 5000, 20000, 36000, 100000]) {
      svg.append(s('text', { class: 'tick', x: X(km), y: H - 4, 'text-anchor': 'middle' }, km >= 1000 ? `${km / 1000}k` : String(km)));
    }
    svg.append(s('line', { class: 'baseline', x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b }));
    c.setTable(['Altitude (km)', ...TYPES.map((t) => TYPE_LABEL[t]), 'Total'], bins.map((b, i) => [`${fmtKm(binEdge(i))}–${fmtKm(binEdge(i + 1))}`, ...TYPES.map((t) => fmtInt(b[t])), fmtInt(totals[i])]).filter((r) => r[5] !== '0'));
  }

  // ---------- 2. launches per year ----------
  function drawYears() {
    const c = charts[1];
    const n = YEAR_MAX - YEAR_MIN + 1;
    const bins = Array.from({ length: n }, () => ({ P: 0, R: 0, D: 0, U: 0 }) as Record<ObjectType, number>);
    for (const o of list) {
      const y = o.launchYear;
      if (y && y >= YEAR_MIN && y <= YEAR_MAX) bins[y - YEAR_MIN][o.type]++;
    }
    const totals = bins.map((b) => b.P + b.R + b.D + b.U);
    const { W, H, svg } = c.svg();
    const pad = { l: 36, r: 6, t: 6, b: 18 };
    const max = Math.max(1, ...totals);
    const bw = (W - pad.l - pad.r) / n;
    const Y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
    gridY(svg, max, W, pad, Y);
    for (let i = 0; i < n; i++) {
      let y0 = H - pad.b;
      const x = pad.l + i * bw + 0.25;
      for (const t of TYPES) {
        const v = bins[i][t];
        if (!v) continue;
        const hgt = (v / max) * (H - pad.t - pad.b);
        svg.append(s('rect', { class: 'mark', x, y: y0 - hgt, width: Math.max(0.8, bw - 1), height: Math.max(0.5, hgt), fill: TYPE_COLOR[t] }));
        y0 -= hgt;
      }
      const hit = s('rect', { class: 'hit', x: pad.l + i * bw, y: pad.t, width: bw, height: H - pad.t - pad.b });
      const year = YEAR_MIN + i;
      hit.addEventListener('mousemove', (e) =>
        tip(e as MouseEvent, `Launched in ${year}`, [
          ...TYPES.filter((t) => bins[i][t]).map((t) => [TYPE_LABEL[t], fmtInt(bins[i][t]), TYPE_COLOR[t]] as [string, string, string]),
          ['Total in orbit', fmtInt(totals[i])],
        ]),
      );
      hit.addEventListener('mouseleave', untip);
      hit.addEventListener('click', () => app.setFilters({ yearMin: year, yearMax: year }));
      svg.append(hit);
    }
    for (let y = 1960; y <= YEAR_MAX; y += 10) {
      svg.append(s('text', { class: 'tick', x: pad.l + (y - YEAR_MIN + 0.5) * bw, y: H - 4, 'text-anchor': 'middle' }, String(y)));
    }
    svg.append(s('line', { class: 'baseline', x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b }));
    c.setTable(['Year', ...TYPES.map((t) => TYPE_LABEL[t]), 'Total'], bins.map((b, i) => [String(YEAR_MIN + i), ...TYPES.map((t) => fmtInt(b[t])), fmtInt(totals[i])]).filter((r) => r[5] !== '0'));
  }

  // ---------- 3. owners ----------
  function drawOwners() {
    const c = charts[2];
    const m = new Map<string, number>();
    for (const o of list) m.set(o.owner, (m.get(o.owner) ?? 0) + 1);
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = rows.slice(0, 9);
    const { W, H, svg } = c.svg();
    const pad = { l: 92, r: 44, t: 2, b: 2 };
    const max = Math.max(1, top[0]?.[1] ?? 1);
    const rh = (H - pad.t - pad.b) / Math.max(top.length, 1);
    const barH = Math.min(14, rh - 5);
    top.forEach(([k, v], i) => {
      const y = pad.t + i * rh + (rh - barH) / 2;
      const wv = (v / max) * (W - pad.l - pad.r);
      const name = ownerName(k);
      svg.append(s('text', { class: 'tick', x: pad.l - 8, y: y + barH / 2 + 3.5, 'text-anchor': 'end', fill: '#b4bccc', style: 'fill:#b4bccc;font-family:var(--sans);font-size:11px' }, name.length > 14 ? k : name));
      svg.append(s('rect', { class: 'mark', x: pad.l, y, width: Math.max(2, wv), height: barH, rx: 3, fill: app.filters.owners.has(k) ? '#7cc4ff' : '#3987e5' }));
      svg.append(s('text', { class: 'tick', x: pad.l + wv + 6, y: y + barH / 2 + 3.5 }, fmtCompact(v)));
      const hit = s('rect', { class: 'hit', x: 0, y: pad.t + i * rh, width: W, height: rh });
      hit.addEventListener('mousemove', (e) => tip(e as MouseEvent, name, [['Objects', fmtInt(v)], ['Share of shown', `${((v / Math.max(1, list.length)) * 100).toFixed(1)}%`]]));
      hit.addEventListener('mouseleave', untip);
      hit.addEventListener('click', () => {
        const next = new Set(app.filters.owners);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        app.setFilters({ owners: next });
      });
      svg.append(hit);
    });
    if (!top.length) svg.append(s('text', { class: 'tick', x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'No objects'));
    c.setTable(['Owner', 'Code', 'Objects'], rows.map(([k, v]) => [ownerName(k), k, fmtInt(v)]));
  }

  // ---------- 4. scatter ----------
  let scatterPts: { x: number; y: number; o: SatObject }[] = [];
  function drawScatter() {
    const c = charts[3];
    const plot = c.plot;
    let canvas = plot.querySelector('canvas');
    if (!canvas) {
      canvas = h('canvas');
      plot.replaceChildren(canvas);
      canvas.addEventListener('mousemove', (e) => {
        const r = canvas!.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        let best: (typeof scatterPts)[0] | null = null;
        let bd = 64;
        for (const p of scatterPts) {
          const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        if (best) {
          canvas!.style.cursor = 'pointer';
          tip(e, best.o.name, [
            ['Inclination', `${best.o.incl.toFixed(2)}°`],
            ['Mean altitude', `${fmtKm(meanAlt(best.o))} km`],
            [TYPE_LABEL[best.o.type], best.o.owner, app.colorsHex[best.o.idx]],
          ]);
          app.setHover(best.o);
        } else {
          canvas!.style.cursor = '';
          untip();
          app.setHover(null);
        }
        (canvas as HTMLCanvasElement & { _hit?: SatObject | null })._hit = best?.o ?? null;
      });
      canvas.addEventListener('mouseleave', () => {
        untip();
        app.setHover(null);
      });
      canvas.addEventListener('click', () => {
        const o = (canvas as HTMLCanvasElement & { _hit?: SatObject | null })._hit;
        if (o) app.select(o, { fly: true });
      });
    }
    const dpr = Math.min(2, window.devicePixelRatio);
    const W = plot.clientWidth;
    const H = plot.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext('2d')!;
    g.scale(dpr, dpr);
    const pad = { l: 30, r: 14, t: 6, b: 18 };
    const X = (a: number) => pad.l + (Math.log(Math.max(A_MIN, a) / A_MIN) / LA) * (W - pad.l - pad.r);
    const IMAX = 150;
    const Y = (i: number) => pad.t + (1 - Math.min(i, IMAX) / IMAX) * (H - pad.t - pad.b);
    g.font = '9.5px "JetBrains Mono Variable", monospace';
    g.fillStyle = '#7c8598';
    g.strokeStyle = 'rgba(160,190,255,0.07)';
    for (const i of [0, 30, 60, 90, 120, 150]) {
      g.beginPath();
      g.moveTo(pad.l, Y(i));
      g.lineTo(W - pad.r, Y(i));
      g.stroke();
      g.textAlign = 'right';
      g.fillText(`${i}°`, pad.l - 4, Y(i) + 3);
    }
    g.textAlign = 'center';
    for (const km of [200, 500, 1000, 2000, 5000, 20000, 36000, 100000]) g.fillText(km >= 1000 ? `${km / 1000}k` : String(km), X(km), H - 4);
    const step = list.length > 40000 ? 2 : 1;
    scatterPts = [];
    g.globalAlpha = list.length > 8000 ? 0.45 : list.length > 1500 ? 0.7 : 0.9;
    const r = list.length > 8000 ? 1.1 : list.length > 1500 ? 1.5 : 2.2;
    for (let k = 0; k < list.length; k += step) {
      const o = list[k];
      const x = X(meanAlt(o));
      const y = Y(o.incl);
      g.fillStyle = app.colorsHex[o.idx];
      g.fillRect(x - r, y - r, r * 2, r * 2);
      scatterPts.push({ x, y, o });
    }
    g.globalAlpha = 1;
    if (app.selected) {
      const x = X(meanAlt(app.selected));
      const y = Y(app.selected.incl);
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.stroke();
    }
  }

  // ---------- 5. Gabbard diagram ----------
  let gabPts: { x: number; y: number; o: SatObject; apo: boolean }[] = [];
  let gabHit: SatObject | null = null;
  function drawPresets() {
    const active = app.filters.ids && app.filters.idsLabel.startsWith('Debris: ') ? app.filters.idsLabel.slice(8) : null;
    presets.replaceChildren(
      h('button', { class: 'chip', 'aria-pressed': String(!active), onclick: () => app.filters.ids && app.filters.idsLabel.startsWith('Debris: ') && app.setFilters({ ids: null, idsLabel: '' }) }, 'Current filters'),
      ...DEBRIS_CLOUDS.map((d) =>
        h(
          'button',
          {
            class: 'chip',
            'aria-pressed': String(active === d.label),
            onclick: () => {
              const gi = app.cat.groups.findIndex((g) => g.key === d.group);
              const ids = new Set(app.universe.filter((o) => o.cospar.startsWith(d.prefix) || o.groups.includes(gi)).map((o) => o.norad));
              app.setFilters({ ids, idsLabel: `Debris: ${d.label}` });
            },
          },
          d.label,
        ),
      ),
    );
  }
  function drawGabbard() {
    drawPresets();
    const plot = gabbard.plot;
    let canvas = plot.querySelector('canvas');
    if (!canvas) {
      canvas = h('canvas');
      plot.replaceChildren(canvas);
      canvas.addEventListener('mousemove', (e) => {
        const r = canvas!.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        let best: (typeof gabPts)[0] | null = null;
        let bd = 64;
        for (const p of gabPts) {
          const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        gabHit = best?.o ?? null;
        canvas!.style.cursor = best ? 'pointer' : '';
        app.setHover(gabHit);
        if (!best) return untip();
        tip(e, best.o.name, [
          ['Period', `${fmt(best.o.period, 1)} min`],
          ['Apogee', `${fmtKm(best.o.apogee)} km`, SLOTS[0]],
          ['Perigee', `${fmtKm(best.o.perigee)} km`, SLOTS[1]],
        ]);
      });
      canvas.addEventListener('mouseleave', () => {
        untip();
        app.setHover(null);
      });
      canvas.addEventListener('click', () => gabHit && app.select(gabHit, { fly: true }));
    }
    const dpr = Math.min(2, window.devicePixelRatio);
    const W = plot.clientWidth;
    const H = plot.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext('2d')!;
    g.scale(dpr, dpr);
    const pad = { l: 44, r: 12, t: 6, b: 20 };
    // Fit to the bulk of the data (2nd–98th percentile), so outliers don't flatten it.
    const objs = list.length > 30000 ? list.filter((_, i) => i % 2 === 0) : list;
    const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(f * (arr.length - 1))))];
    const periods = objs.map((o) => o.period).sort((a, b) => a - b);
    const apos = objs.map((o) => o.apogee).sort((a, b) => a - b);
    if (!objs.length) {
      g.fillStyle = '#7c8598';
      g.font = '11px "Inter Variable", system-ui';
      g.textAlign = 'center';
      g.fillText('No objects', W / 2, H / 2);
      gabPts = [];
      gabbard.setTable([], []);
      return;
    }
    let x0 = Math.max(80, q(periods, 0.02) - 2);
    // Debris clouds live in LEO; when most objects do, keep the axis there.
    let x1 = q(periods, 0.5) < 128 ? Math.min(q(periods, 0.98) + 2, 130) : q(periods, 0.98) + 2;
    if (x1 - x0 < 6) {
      x0 -= 3;
      x1 += 3;
    }
    const inRange = objs.filter((o) => o.period >= x0 && o.period <= x1).map((o) => o.apogee).sort((a, b) => a - b);
    const y1 = Math.max(400, q(inRange.length ? inRange : apos, 0.99) * 1.08);
    const X = (p: number) => pad.l + ((p - x0) / (x1 - x0)) * (W - pad.l - pad.r);
    const Y = (a: number) => H - pad.b - (a / y1) * (H - pad.t - pad.b);
    g.font = '9.5px "JetBrains Mono Variable", monospace';
    g.fillStyle = '#7c8598';
    g.strokeStyle = 'rgba(160,190,255,0.07)';
    const ys = niceStep(y1 / 4);
    g.textAlign = 'right';
    for (let v = 0; v <= y1; v += ys) {
      g.beginPath();
      g.moveTo(pad.l, Y(v));
      g.lineTo(W - pad.r, Y(v));
      g.stroke();
      g.fillText(fmtCompact(v), pad.l - 4, Y(v) + 3);
    }
    g.textAlign = 'center';
    const xs = niceStep((x1 - x0) / 5);
    for (let v = Math.ceil(x0 / xs) * xs; v <= x1; v += xs) g.fillText(`${v} min`, X(v), H - 5);
    g.save();
    g.translate(10, (H - pad.b) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText('altitude (km)', 0, 0);
    g.restore();
    gabPts = [];
    const r = objs.length > 6000 ? 1.1 : objs.length > 1200 ? 1.6 : 2.3;
    g.globalAlpha = objs.length > 6000 ? 0.55 : 0.85;
    for (const [apo, color] of [
      [true, SLOTS[0]],
      [false, SLOTS[1]],
    ] as [boolean, string][]) {
      g.fillStyle = color;
      for (const o of objs) {
        if (o.period < x0 || o.period > x1) continue;
        const x = X(o.period);
        const y = Y(apo ? o.apogee : o.perigee);
        if (y < pad.t) continue;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        gabPts.push({ x, y, o, apo });
      }
    }
    g.globalAlpha = 1;
    const sel = app.selected;
    if (sel && sel.period >= x0 && sel.period <= x1) {
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      for (const a of [sel.apogee, sel.perigee]) {
        g.beginPath();
        g.arc(X(sel.period), Y(a), 5.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
    gabbard.setTable(
      ['Object', 'Period (min)', 'Apogee (km)', 'Perigee (km)'],
      objs.slice(0, 500).map((o) => [o.name, fmt(o.period, 1), fmtKm(o.apogee), fmtKm(o.perigee)]),
    );
  }

  // ---------- 6. crowding by altitude ----------
  function drawCrowding() {
    const c = crowding;
    // Spread each orbit across the shells it passes through, weighted by the
    // time it spends in each (sampled uniformly in mean anomaly).
    const SAMPLES = 24;
    const bins = Array.from({ length: N_SHELLS }, () => ({ P: 0, R: 0, D: 0, U: 0 }) as Record<ObjectType, number>);
    let above = 0;
    for (const o of list) {
      if (o.perigee > SHELL_MAX) {
        above++;
        continue;
      }
      const a = o.sma;
      const e = o.ecc;
      if (e < 0.002) {
        const i = Math.floor(((a - RE) - SHELL_MIN) / SHELL);
        if (i >= 0 && i < N_SHELLS) bins[i][o.type]++;
        continue;
      }
      for (let k = 0; k < SAMPLES; k++) {
        const M = ((k + 0.5) / SAMPLES) * 2 * Math.PI;
        let E = e < 0.8 ? M : Math.PI;
        for (let it = 0; it < 8; it++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        const alt = a * (1 - e * Math.cos(E)) - RE;
        const i = Math.floor((alt - SHELL_MIN) / SHELL);
        if (i >= 0 && i < N_SHELLS) bins[i][o.type] += 1 / SAMPLES;
      }
    }
    const counts = bins.map((b) => b.P + b.R + b.D + b.U);
    const dens = counts.map((n, i) => n / shellVolume(i));
    const { W, H, svg } = c.svg();
    const pad = { l: 40, r: 8, t: 14, b: 18 };
    const max = Math.max(1e-9, ...dens);
    const bw = (W - pad.l - pad.r) / N_SHELLS;
    const Y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
    const step = niceStep(max / 3);
    for (let v = step; v <= max; v += step) {
      svg.append(s('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
      svg.append(s('text', { class: 'tick', x: pad.l - 5, y: Y(v) + 3, 'text-anchor': 'end' }, v >= 10 ? fmtCompact(v) : fmt(v, v < 1 ? 2 : 1)));
    }
    for (let i = 0; i < N_SHELLS; i++) {
      let y0 = H - pad.b;
      const x = pad.l + i * bw + 0.3;
      for (const t of TYPES) {
        const v = bins[i][t] / shellVolume(i);
        if (!v) continue;
        const hgt = (v / max) * (H - pad.t - pad.b);
        svg.append(s('rect', { class: 'mark', x, y: y0 - hgt, width: Math.max(0.8, bw - 1), height: Math.max(0.4, hgt), fill: TYPE_COLOR[t] }));
        y0 -= hgt;
      }
      const lo = SHELL_MIN + i * SHELL;
      const hit = s('rect', { class: 'hit', x: pad.l + i * bw, y: pad.t, width: bw, height: H - pad.t - pad.b });
      hit.addEventListener('mousemove', (e) =>
        tip(e as MouseEvent, `${lo}–${lo + SHELL} km`, [
          ...TYPES.filter((t) => bins[i][t] >= 0.5).map((t) => [TYPE_LABEL[t], fmtInt(bins[i][t]), TYPE_COLOR[t]] as [string, string, string]),
          ['Objects (time-averaged)', fmtInt(counts[i])],
          ['Per billion km³', fmt(dens[i], dens[i] < 10 ? 2 : 1)],
        ]),
      );
      hit.addEventListener('mouseleave', untip);
      hit.addEventListener('click', () => app.setFilters({ altMin: lo, altMax: lo + SHELL }));
      svg.append(hit);
    }
    for (let km = 400; km <= SHELL_MAX; km += 400) svg.append(s('text', { class: 'tick', x: pad.l + ((km - SHELL_MIN) / SHELL) * bw, y: H - 4, 'text-anchor': 'middle' }, `${km}`));
    svg.append(s('line', { class: 'baseline', x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b }));
    // Label the most crowded shell.
    const peak = dens.indexOf(max);
    if (counts[peak] > 0) {
      const px = pad.l + (peak + 0.5) * bw;
      svg.append(
        s(
          'text',
          { class: 'tick', x: Math.min(W - pad.r - 4, Math.max(pad.l + 4, px)), y: pad.t - 3, 'text-anchor': px > W * 0.7 ? 'end' : px < W * 0.3 ? 'start' : 'middle', style: 'fill:#eaeef6' },
          `Most crowded: ${SHELL_MIN + peak * SHELL}–${SHELL_MIN + (peak + 1) * SHELL} km · ${fmt(max, max < 10 ? 2 : 1)} per 10⁹ km³`,
        ),
      );
    }
    c.setTable(
      ['Shell (km)', ...TYPES.map((t) => TYPE_LABEL[t]), 'Objects', 'Per 10⁹ km³'],
      bins
        .map((b, i) => [`${SHELL_MIN + i * SHELL}–${SHELL_MIN + (i + 1) * SHELL}`, ...TYPES.map((t) => fmtInt(b[t])), fmtInt(counts[i]), fmt(dens[i], 2)])
        .filter((_, i) => counts[i] >= 0.5),
    );
    crowdingNote.textContent = above ? `${fmtInt(above)} objects above 2,000 km aren't shown.` : '';
  }
  const crowdingNote = h('span', { class: 'chart-note' });
  crowding.el.append(crowdingNote);

  // ---------- plumbing ----------
  const redraw = () => {
    if (root.hidden) return;
    list = app.inOrbitList();
    const h = app.history;
    scope.textContent = `${fmtInt(list.length)} objects${h ? ` in orbit on ${new Date(h.cutoff).toISOString().slice(0, 10)}` : ''}`;
    if (tab === 'overview') {
      drawAltitude();
      drawYears();
      drawOwners();
      drawScatter();
    } else {
      drawGabbard();
      drawCrowding();
    }
  };
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(redraw);
  };
  app.on('filters', schedule);
  app.on('colors', schedule);
  app.on('selection', schedule);
  // History playback changes what's in orbit; redraw a couple of times a second.
  let lastHist = 0;
  app.on('history', () => {
    if (root.hidden || performance.now() - lastHist < 500) return;
    lastHist = performance.now();
    schedule();
  });
  window.addEventListener('resize', schedule);

  const setOpen = (o: boolean) => {
    root.hidden = !o;
    btn.setAttribute('aria-pressed', String(o));
    document.body.classList.toggle('insights-open', o);
    if (o) requestAnimationFrame(redraw);
  };
  app.openInsights = (t, open = true) => {
    if (t) setTab(t);
    setOpen(open);
  };
  btn.onclick = () => setOpen(!!root.hidden);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'i' || e.key === 'I') setOpen(!!root.hidden);
    if (e.key === 'Escape' && !root.hidden && !app.selected) setOpen(false);
  });
  // Layout changes when the info panel opens.
  app.on('selection', () => requestAnimationFrame(schedule));
  setTab('overview');
}

function gridY(svg: SVGElement, max: number, W: number, pad: { l: number; r: number; t: number; b: number }, Y: (v: number) => number) {
  const step = niceStep(max / 3);
  for (let v = step; v <= max; v += step) {
    svg.append(s('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
    svg.append(s('text', { class: 'tick', x: pad.l - 5, y: Y(v) + 3, 'text-anchor': 'end' }, fmtCompact(v)));
  }
}

function niceStep(x: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, x)));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function chartShell(title: string, desc: string, typeLegend: boolean, legend?: [string, string][]) {
  const plot = h('div', { class: 'plot' });
  let table: { head: string[]; rows: string[][] } = { head: [], rows: [] };
  let tableOpen = false;
  const toggle = h('button', { class: 'chart-table' }, 'View as table');
  const el = h(
    'div',
    { class: 'chart' },
    h('h4', null, title),
    h('p', null, desc),
    typeLegend ? h('div', { class: 'chart-legend' }, ...TYPES.map((t) => h('span', null, h('i', { style: `background:${TYPE_COLOR[t]}` }), TYPE_LABEL[t]))) : null,
    legend ? h('div', { class: 'chart-legend' }, ...legend.map(([l, c]) => h('span', null, h('i', { style: `background:${c};border-radius:50%` }), l))) : null,
    plot,
    toggle,
  );
  const tableEl = h('div', { class: 'table-view' });
  toggle.onclick = () => {
    tableOpen = !tableOpen;
    toggle.textContent = tableOpen ? 'View as chart' : 'View as table';
    renderTable();
  };
  function renderTable() {
    if (!tableOpen) {
      tableEl.remove();
      return;
    }
    tableEl.replaceChildren(
      h('table', null, h('thead', null, h('tr', null, ...table.head.map((c) => h('th', null, c)))), h('tbody', null, ...table.rows.map((r) => h('tr', null, ...r.map((c) => h('td', null, c)))))),
    );
    plot.append(tableEl);
  }
  return {
    el,
    plot,
    svg() {
      const W = Math.max(120, plot.clientWidth);
      const H = Math.max(80, plot.clientHeight);
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
      plot.replaceChildren(svg);
      return { W, H, svg };
    },
    setTable(head: string[], rows: string[][]) {
      table = { head, rows };
      renderTable();
    },
  };
}
