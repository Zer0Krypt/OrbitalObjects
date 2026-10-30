import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { gScale, G_COLORS, G_LABELS, type SpaceWeather } from '../data/spaceweather';
import { fmt, fmtInt, s } from './dom';
import { decayRate } from './objectdetail';

// Charts for Insights → Space weather. Each takes a chart shell (from
// insights.ts) and draws into a fresh SVG.

interface Shell {
  svg(): { W: number; H: number; svg: SVGElement };
  setTable(head: string[], rows: string[][]): void;
}
type Tip = (e: MouseEvent, title: string, rows: [string, string, string?][]) => void;

const pad = { l: 34, r: 10, t: 10, b: 18 };
const monthMs = (m: string) => Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 15);

function empty(svg: SVGElement, W: number, H: number, msg: string) {
  svg.append(s('text', { class: 'tick', x: W / 2, y: H / 2, 'text-anchor': 'middle' }, msg));
}

function yGrid(svg: SVGElement, W: number, max: number, Y: (v: number) => number, step: number, fmtv = (v: number) => String(v)) {
  for (let v = step; v <= max; v += step) {
    svg.append(s('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
    svg.append(s('text', { class: 'tick', x: pad.l - 4, y: Y(v) + 3, 'text-anchor': 'end' }, fmtv(v)));
  }
}

/** Monthly sunspot number since 1996, with NOAA's prediction dashed. */
export function drawCycle(c: Shell, sw: SpaceWeather | null, tip: Tip, untip: () => void) {
  const { W, H, svg } = c.svg();
  const obs = (sw?.cycle ?? []).filter((r) => r[1] !== null) as [string, number, number | null][];
  const pred = (sw?.predicted ?? []).filter((r) => r[1] !== null) as [string, number, number | null][];
  if (!obs.length) return empty(svg, W, H, 'No solar cycle data');
  const t0 = monthMs(obs[0][0]);
  const t1 = monthMs((pred.length ? pred : obs)[(pred.length ? pred : obs).length - 1][0]);
  const max = Math.max(...obs.map((r) => r[1]), ...pred.map((r) => r[1])) * 1.1;
  const X = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const Y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  yGrid(svg, W, max, Y, max > 200 ? 100 : 50);
  for (let y = Math.ceil(new Date(t0).getUTCFullYear() / 5) * 5; y <= new Date(t1).getUTCFullYear(); y += 5) svg.append(s('text', { class: 'tick', x: X(Date.UTC(y, 0, 1)), y: H - 4, 'text-anchor': 'middle' }, String(y)));
  const path = (rows: [string, number, unknown][]) => rows.map((r, i) => `${i ? 'L' : 'M'}${X(monthMs(r[0])).toFixed(1)},${Y(r[1]).toFixed(1)}`).join('');
  svg.append(s('path', { d: `${path(obs)}L${X(monthMs(obs[obs.length - 1][0]))},${Y(0)}L${X(t0)},${Y(0)}Z`, fill: 'rgba(250,178,25,0.16)' }));
  svg.append(s('path', { d: path(obs), fill: 'none', stroke: '#fab219', 'stroke-width': 1.3 }));
  if (pred.length) svg.append(s('path', { d: path([obs[obs.length - 1], ...pred]), fill: 'none', stroke: '#fab219', 'stroke-width': 1.3, 'stroke-dasharray': '3 3', opacity: 0.8 }));
  const xn = X(Date.now());
  svg.append(s('line', { x1: xn, x2: xn, y1: pad.t, y2: H - pad.b, stroke: 'rgba(255,255,255,0.4)', 'stroke-dasharray': '2 3' }));
  svg.append(s('text', { class: 'tick', x: xn - 3, y: pad.t + 8, 'text-anchor': 'end' }, 'now'));
  // Hover: nearest month.
  const all = [...obs, ...pred.map((p) => [...p, true] as const)];
  svg.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + (((e.clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r) * (t1 - t0);
    let best = all[0];
    for (const m of all) if (Math.abs(monthMs(m[0]) - t) < Math.abs(monthMs(best[0]) - t)) best = m;
    tip(e, `${best[0]}${best.length > 3 ? ' (predicted)' : ''}`, [
      ['Sunspot number', fmt(best[1] as number, 0), '#fab219'],
      ['Solar flux F10.7', best[2] !== null ? fmt(best[2] as number, 0) : '—'],
    ]);
  });
  svg.addEventListener('mouseleave', untip);
  c.setTable(['Month', 'Sunspot number', 'F10.7'], all.map((r) => [`${r[0]}${r.length > 3 ? ' (predicted)' : ''}`, fmt(r[1] as number, 0), r[2] !== null ? fmt(r[2] as number, 0) : '—']));
}

/** Daily 10.7 cm flux over the last months: the Sun's ~27-day rotation shows as ripples. */
export function drawFlux(c: Shell, sw: SpaceWeather | null, tip: Tip, untip: () => void) {
  const { W, H, svg } = c.svg();
  const f = sw?.f107 ?? [];
  if (!f.length) return empty(svg, W, H, 'No solar flux data');
  const t0 = Date.parse(f[0][0]);
  const t1 = Date.parse(f[f.length - 1][0]);
  const lo = Math.min(...f.map((r) => r[1])) * 0.9;
  const hi = Math.max(...f.map((r) => r[1])) * 1.05;
  const X = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const Y = (v: number) => H - pad.b - ((v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  for (let v = Math.ceil(lo / 50) * 50; v <= hi; v += 50) {
    svg.append(s('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
    svg.append(s('text', { class: 'tick', x: pad.l - 4, y: Y(v) + 3, 'text-anchor': 'end' }, String(v)));
  }
  const mf = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
  for (let k = 0; k < f.length; k++) if (f[k][0].endsWith('-01')) svg.append(s('text', { class: 'tick', x: X(Date.parse(f[k][0])), y: H - 4, 'text-anchor': 'middle' }, mf.format(Date.parse(f[k][0]))));
  svg.append(s('path', { d: f.map((r, i) => `${i ? 'L' : 'M'}${X(Date.parse(r[0])).toFixed(1)},${Y(r[1]).toFixed(1)}`).join(''), fill: 'none', stroke: '#ff8a3d', 'stroke-width': 1.4 }));
  const last = f[f.length - 1];
  svg.append(s('circle', { cx: X(t1), cy: Y(last[1]), r: 3, fill: '#ff8a3d' }));
  svg.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + (((e.clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r) * (t1 - t0);
    const best = f.reduce((b, x) => (Math.abs(Date.parse(x[0]) - t) < Math.abs(Date.parse(b[0]) - t) ? x : b));
    tip(e, best[0], [['F10.7', `${fmt(best[1], 1)} sfu`, '#ff8a3d']]);
  });
  svg.addEventListener('mouseleave', untip);
  c.setTable(['Day', 'F10.7 (sfu)'], f.map((r) => [r[0], fmt(r[1], 1)]));
}

/** 3-hourly Kp for the last week and NOAA's 3-day forecast, coloured by storm level. */
export function drawKp(c: Shell, sw: SpaceWeather | null, tip: Tip, untip: () => void) {
  const { W, H, svg } = c.svg();
  const k = sw?.kp ?? [];
  if (!k.length) return empty(svg, W, H, 'No Kp data');
  const t0 = Date.parse(k[0][0]);
  const t1 = Date.parse(k[k.length - 1][0]) + 3 * 3600e3;
  const X = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const Y = (v: number) => H - pad.b - (v / 9) * (H - pad.t - pad.b);
  yGrid(svg, W, 9, Y, 3);
  svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(5), y2: Y(5), stroke: 'rgba(201,133,0,0.6)', 'stroke-dasharray': '3 3' }));
  svg.append(s('text', { class: 'tick', x: W - pad.r, y: Y(5) - 3, 'text-anchor': 'end' }, 'storm (G1)'));
  const bw = Math.max(1, X(t0 + 3 * 3600e3) - X(t0) - 1);
  for (const [iso, kp, obs] of k) {
    const x = X(Date.parse(iso));
    const g = gScale(kp);
    const r = s('rect', { x, y: Y(kp), width: bw, height: Math.max(0.5, Y(0) - Y(kp)), fill: G_COLORS[g], opacity: obs ? 0.95 : 0.45 });
    r.addEventListener('mousemove', (e) => tip(e as MouseEvent, new Date(iso).toUTCString().slice(0, 22), [['Kp', fmt(kp, 1), G_COLORS[g]], [G_LABELS[g], obs ? 'observed' : 'forecast']]));
    r.addEventListener('mouseleave', untip);
    svg.append(r);
  }
  const xn = X(Date.now());
  svg.append(s('line', { x1: xn, x2: xn, y1: pad.t, y2: H - pad.b, stroke: 'rgba(255,255,255,0.45)', 'stroke-dasharray': '2 3' }));
  svg.append(s('text', { class: 'tick', x: xn + 3, y: pad.t + 8 }, 'forecast →'));
  const df = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
  // One label per day where there's room, else every other day.
  const every = X(t0 + 86400e3) - X(t0) < 30 ? 2 : 1;
  let d = 0;
  for (let t = Math.ceil(t0 / 86400e3) * 86400e3; t < t1; t += 86400e3, d++) if (d % every === 0) svg.append(s('text', { class: 'tick', x: X(t + 43200e3), y: H - 4, 'text-anchor': 'middle' }, df.format(t)));
  c.setTable(['Time (UTC)', 'Kp', 'Level', ''], k.map(([iso, kp, obs]) => [iso.slice(0, 16).replace('T', ' '), fmt(kp, 1), G_LABELS[gScale(kp)], obs ? 'observed' : 'forecast']));
}

/** How fast near-circular orbits are sinking right now, by altitude, from their current elements. */
export function drawDecay(c: Shell, app: App, tip: Tip, untip: () => void) {
  const { W, H, svg } = c.svg();
  const bands: { lo: number; rates: number[] }[] = [];
  for (let lo = 250; lo < 800; lo += 50) bands.push({ lo, rates: [] });
  for (let i = 0; i < app.liveCount; i++) {
    const o: SatObject = app.cat.objects[i];
    if (o.ecc > 0.01 || o.ndot <= 0) continue;
    const alt = o.sma - 6378.137;
    const b = bands.find((x) => alt >= x.lo && alt < x.lo + 50);
    if (b) b.rates.push(decayRate(o) * 1000);
  }
  const med = bands.map((b) => {
    const r = b.rates.sort((x, y) => x - y);
    return r.length >= 5 ? r[Math.floor(r.length / 2)] : null;
  });
  const vals = med.filter((v): v is number => v !== null && v > 0);
  if (!vals.length) return empty(svg, W, H, 'Not enough low, circular orbits');
  // Rates span orders of magnitude: log scale (m/day).
  const lmin = Math.log10(Math.max(0.01, Math.min(...vals) / 2));
  const lmax = Math.log10(Math.max(...vals) * 2);
  const Y = (v: number) => H - pad.b - ((Math.log10(Math.max(v, 10 ** lmin)) - lmin) / (lmax - lmin)) * (H - pad.t - pad.b);
  for (let e = Math.ceil(lmin); e <= lmax; e++) {
    const v = 10 ** e;
    svg.append(s('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
    svg.append(s('text', { class: 'tick', x: pad.l - 4, y: Y(v) + 3, 'text-anchor': 'end' }, v >= 1000 ? `${v / 1000}k` : String(v)));
  }
  const bw = (W - pad.l - pad.r) / bands.length;
  bands.forEach((b, i) => {
    const v = med[i];
    const x = pad.l + i * bw;
    if (i % 2 === 0) svg.append(s('text', { class: 'tick', x: x + bw / 2, y: H - 4, 'text-anchor': 'middle' }, String(b.lo)));
    if (v === null || v <= 0) return;
    const r = s('rect', { x: x + 1, y: Y(v), width: bw - 2, height: Y(10 ** lmin) - Y(v), fill: '#3987e5', rx: 2 });
    r.addEventListener('mousemove', (e) => tip(e as MouseEvent, `${b.lo}–${b.lo + 50} km`, [['Typical sinking rate', v >= 1000 ? `${fmt(v / 1000, 2)} km/day` : `${fmt(v, v < 10 ? 1 : 0)} m/day`], ['Objects', fmtInt(b.rates.length)]]));
    r.addEventListener('mouseleave', untip);
    svg.append(r);
  });
  c.setTable(['Altitude (km)', 'Median sinking rate (m/day)', 'Objects'], bands.map((b, i) => [`${b.lo}–${b.lo + 50}`, med[i] !== null ? fmt(med[i]!, 1) : '—', fmtInt(b.rates.length)]));
}
