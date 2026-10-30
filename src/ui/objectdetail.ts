import type { App } from '../app';
import { RE, type SatObject } from '../data/catalog';
import { altitudeHistory, type AltPoint } from '../data/althistory';
import { describeFlux, latestFlux, latestKp, gScale, G_LABELS } from '../data/spaceweather';
import { SLOTS } from '../data/model';
import { fmt, fmtDate, fmtInt, h, s } from './dom';

const yearFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

// ---------- altitude history ----------
/** "Altitude history" section of the info panel: perigee and apogee over the object's life. */
export function altitudeSection(app: App, o: SatObject) {
  const plot = h('div', { class: 'alt-plot' }, h('p', { class: 'sky-hint', style: 'margin:0' }, 'Loading…'));
  const foot = h('p', { class: 'sky-hint', style: 'margin:6px 0 0' });
  const sub = h('span');
  const el = h('div', { class: 'isec', hidden: true }, h('h3', null, 'Altitude history', sub), plot, foot);
  void altitudeHistory(o.norad).then((hist) => {
    if (app.selected !== o) return;
    const pts: AltPoint[] = hist?.points.slice() ?? [];
    // Today's orbit from the current elements closes the line.
    if (!o.decay) pts.push({ t: o.epochMs, perigee: o.perigee, apogee: o.apogee });
    pts.sort((a, b) => a.t - b.t);
    if (pts.length < 3) return;
    el.hidden = false;
    sub.textContent = hist?.daily ? 'daily' : `${pts.length} points`;
    foot.textContent = hist?.daily
      ? 'Every day of its life from Space-Track’s archive of element sets: launch, orbit raising, reboosts and decay.'
      : 'Perigee and apogee from each history snapshot (yearly, then quarterly for the last decade) and today’s elements. Short manoeuvres between snapshots don’t show.';
    draw(plot, pts, o);
  });
  return el;
}

function draw(plot: HTMLElement, pts: AltPoint[], o: SatObject) {
  const W = 320;
  const H = 150;
  const pad = { l: 40, r: 8, t: 8, b: 18 };
  const t0 = pts[0].t;
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 86400e3);
  const lo = Math.min(...pts.map((p) => p.perigee));
  const hi = Math.max(...pts.map((p) => p.apogee));
  // Transfer orbits span thousands of km: switch to a log scale.
  const log = hi / Math.max(lo, 100) > 6;
  const f = (v: number) => (log ? Math.log(Math.max(v, 100)) : v);
  const y0 = f(log ? lo * 0.9 : lo - Math.max(5, (hi - lo) * 0.08));
  const y1 = f(log ? hi * 1.1 : hi + Math.max(5, (hi - lo) * 0.08));
  const X = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (f(v) - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Perigee and apogee of ${o.name} over time` });
  // Grid and labels.
  const ticks = log ? [200, 500, 1000, 2000, 5000, 10000, 20000, 36000].filter((v) => f(v) >= y0 && f(v) <= y1) : niceTicks(lo, hi);
  for (const v of ticks) {
    svg.append(s('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
    svg.append(s('text', { class: 'tick', x: pad.l - 4, y: Y(v) + 3, 'text-anchor': 'end' }, v >= 1000 ? `${fmt(v / 1000, v >= 10000 ? 0 : 1)}k` : String(Math.round(v))));
  }
  const y0d = new Date(t0).getUTCFullYear();
  const y1d = new Date(t1).getUTCFullYear();
  const every = Math.max(1, Math.ceil((y1d - y0d) / 5));
  for (let y = y0d + 1; y <= y1d; y += every) {
    const x = X(Date.UTC(y, 0, 1));
    if (x < pad.l + 10 || x > W - pad.r - 10) continue;
    svg.append(s('text', { class: 'tick', x, y: H - 5, 'text-anchor': 'middle' }, String(y)));
  }
  if (y1d === y0d) svg.append(s('text', { class: 'tick', x: (pad.l + W - pad.r) / 2, y: H - 5, 'text-anchor': 'middle' }, String(y0d)));
  const line = (key: 'perigee' | 'apogee') => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p[key]).toFixed(1)}`).join('');
  const area = `${line('apogee')}${pts
    .slice()
    .reverse()
    .map((p) => `L${X(p.t).toFixed(1)},${Y(p.perigee).toFixed(1)}`)
    .join('')}Z`;
  svg.append(s('path', { d: area, fill: 'rgba(57,135,229,0.12)' }));
  svg.append(s('path', { d: line('apogee'), fill: 'none', stroke: SLOTS[0], 'stroke-width': 1.4 }));
  svg.append(s('path', { d: line('perigee'), fill: 'none', stroke: SLOTS[1], 'stroke-width': 1.4 }));
  // Hover readout.
  const cursor = s('line', { x1: 0, x2: 0, y1: pad.t, y2: H - pad.b, stroke: 'rgba(255,255,255,0.35)', visibility: 'hidden' });
  const label = s('text', { class: 'tick', x: 0, y: pad.t + 9, visibility: 'hidden', fill: '#eaeef6' });
  svg.append(cursor, label);
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((x - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    const bx = X(best.t);
    cursor.setAttribute('x1', String(bx));
    cursor.setAttribute('x2', String(bx));
    cursor.setAttribute('visibility', 'visible');
    label.textContent = `${yearFmt.format(best.t)} · ${fmtInt(best.perigee)}–${fmtInt(best.apogee)} km`;
    label.setAttribute('x', String(Math.min(bx + 4, W - 150)));
    label.setAttribute('visibility', 'visible');
  });
  svg.addEventListener('pointerleave', () => {
    cursor.setAttribute('visibility', 'hidden');
    label.setAttribute('visibility', 'hidden');
  });
  plot.replaceChildren(
    svg,
    h(
      'div',
      { class: 'chart-legend', style: 'margin-top:4px' },
      h('span', null, h('i', { style: `background:${SLOTS[0]}` }), 'Apogee'),
      h('span', null, h('i', { style: `background:${SLOTS[1]}` }), 'Perigee'),
      h('span', { style: 'color:var(--ink-3)' }, log ? 'km, log scale' : 'km above Earth'),
    ),
  );
}

function niceTicks(lo: number, hi: number) {
  const span = Math.max(1, hi - lo);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => span / s <= 4) ?? 10000;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

// ---------- drag ----------
/** Altitude lost per day to drag (km/day), from the element set's mean-motion rate. */
export function decayRate(o: SatObject) {
  // TLE ṅ/2 is in rev/day²; a ∝ n^(−2/3).
  return ((2 / 3) * o.sma * (2 * o.ndot)) / o.meanMotion;
}

/** Very rough time left in orbit at today's decay rate, assuming density rises steeply as it sinks. */
export function lifetimeDays(o: SatObject) {
  const r0 = decayRate(o);
  const h0 = o.sma - RE;
  if (!(r0 > 1e-6) || h0 < 150) return null;
  const Hs = 40 + 0.06 * Math.max(0, h0 - 200);
  return (Hs / r0) * (1 - Math.exp((180 - h0) / Hs));
}

export function fmtLifetime(days: number) {
  if (days < 2) return 'about a day';
  if (days < 60) return `about ${Math.round(days)} days`;
  if (days < 730) return `about ${Math.round(days / 30.4)} months`;
  if (days < 365.25 * 100) return `about ${Math.round(days / 365.25)} years`;
  return 'centuries';
}

/** "Drag and decay" section: how fast the orbit is sinking and how solar activity affects it. */
export function dragSection(app: App, o: SatObject) {
  if (o.decay || o.perigee > 1500) return null;
  const rate = decayRate(o);
  const life = lifetimeDays(o);
  const flux = latestFlux(app.spaceWeather);
  const kp = latestKp(app.spaceWeather);
  const rows: Node[] = [];
  if (rate > 0.0005) {
    rows.push(
      h('p', { class: 'sky-hint', style: 'margin:0 0 6px' }, h('b', null, `Sinking about ${rate >= 1 ? `${fmt(rate, 1)} km` : `${fmtInt(rate * 1000)} m`} a day`), ' as the thin upper atmosphere drags on it.'),
      h(
        'p',
        { class: 'sky-hint', style: 'margin:0 0 6px' },
        life !== null ? `At today’s rate it would re-enter in ${fmtLifetime(life)} (a rough guide: solar activity and any manoeuvres change it).` : '',
      ),
    );
  } else if (rate < -0.0005) rows.push(h('p', { class: 'sky-hint', style: 'margin:0 0 6px' }, h('b', null, 'Climbing'), ': its latest elements show the orbit rising, so it is being boosted.'));
  else rows.push(h('p', { class: 'sky-hint', style: 'margin:0 0 6px' }, 'Drag is negligible at this height: the orbit will last decades or more.'));
  if (flux !== null || kp !== null) {
    rows.push(
      h(
        'p',
        { class: 'sky-hint', style: 'margin:0' },
        `Space weather now: solar flux ${flux !== null ? `${Math.round(flux)} (${describeFlux(flux)})` : '—'}, Kp ${kp !== null ? `${fmt(kp, 1)} (${G_LABELS[gScale(kp)].toLowerCase()})` : '—'}. A more active Sun heats and swells the upper atmosphere, so low satellites sink faster. `,
        h('button', { class: 'link', onclick: () => app.openInsights('weather') }, 'Space weather ›'),
      ),
    );
  }
  return h('div', { class: 'isec' }, h('h3', null, 'Drag and decay', h('span', null, `elements ${fmtDate(o.epoch.slice(0, 10))}`)), ...rows);
}
