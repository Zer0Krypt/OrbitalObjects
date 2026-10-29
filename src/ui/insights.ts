import type { App } from '../app';
import { TYPE_LABEL, type ObjectType, type SatObject } from '../data/catalog';
import { ownerName } from '../data/codes';
import { TYPE_COLOR, YEAR_MAX, YEAR_MIN } from '../data/model';
import { $, fmtCompact, fmtInt, fmtKm, h, s } from './dom';

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
    chartShell('Launches per year', 'Objects still in orbit, by launch year · click to filter', true),
    chartShell('Top owners', 'Objects by owner / operator · click to filter', false),
    chartShell('Inclination vs altitude', 'Every visible object · hover to identify, click to select', false),
  ];
  root.append(...charts.map((c) => c.el));

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
    for (const o of app.visibleList) bins[altBin(meanAlt(o))][o.type]++;
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
    for (const o of app.visibleList) {
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
    for (const o of app.visibleList) m.set(o.owner, (m.get(o.owner) ?? 0) + 1);
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
      hit.addEventListener('mousemove', (e) => tip(e as MouseEvent, name, [['Objects', fmtInt(v)], ['Share of shown', `${((v / app.visibleList.length) * 100).toFixed(1)}%`]]));
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
    const list = app.visibleList;
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

  // ---------- plumbing ----------
  const redraw = () => {
    if (root.hidden) return;
    drawAltitude();
    drawYears();
    drawOwners();
    drawScatter();
  };
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(redraw);
  };
  app.on('filters', schedule);
  app.on('colors', schedule);
  app.on('selection', schedule);
  window.addEventListener('resize', schedule);

  const setOpen = (o: boolean) => {
    root.hidden = !o;
    btn.setAttribute('aria-pressed', String(o));
    document.body.classList.toggle('insights-open', o);
    if (o) requestAnimationFrame(redraw);
  };
  btn.onclick = () => setOpen(!!root.hidden);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'i' || e.key === 'I') setOpen(!!root.hidden);
    if (e.key === 'Escape' && !root.hidden && !app.selected) setOpen(false);
  });
  // Layout changes when the info panel opens.
  app.on('selection', () => requestAnimationFrame(schedule));
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

function chartShell(title: string, desc: string, typeLegend: boolean) {
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
