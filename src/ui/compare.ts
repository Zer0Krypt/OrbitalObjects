import type { App } from '../app';
import { TYPE_LABEL, type SatObject } from '../data/catalog';
import { ownerName } from '../data/codes';
import { satrecFor, stateAt } from '../render/orbits';
import { fmt, fmtDate, fmtDuration, fmtKm, fmtUtc, h, s } from './dom';
import { fmtCountdown } from './reentry';

interface Sample {
  t: number;
  d: number; // km
}

/** Distance between two objects over a window (SGP4), plus the refined closest approach. */
export function distanceSeries(a: SatObject, b: SatObject, from: number) {
  const ra = satrecFor(a);
  const rb = satrecFor(b);
  if (!ra || !rb) return null;
  // Long enough to cover a few revolutions of the slower object.
  const span = Math.min(72, Math.max(24, (3 * Math.max(a.period, b.period)) / 60)) * 3600e3;
  const N = 720;
  const dist = (t: number) => {
    const pa = stateAt(ra, t);
    const pb = stateAt(rb, t);
    if (!pa || !pb) return NaN;
    return Math.hypot(pa.position.x - pb.position.x, pa.position.y - pb.position.y, pa.position.z - pb.position.z);
  };
  const pts: Sample[] = [];
  for (let i = 0; i <= N; i++) {
    const t = from + (i / N) * span;
    const d = dist(t);
    if (Number.isFinite(d)) pts.push({ t, d });
  }
  if (pts.length < 2) return null;
  let k = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].d < pts[k].d) k = i;
  // Golden-section search around the coarse minimum.
  let lo = pts[Math.max(0, k - 1)].t;
  let hi = pts[Math.min(pts.length - 1, k + 1)].t;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 40; it++) {
    const m1 = hi - g * (hi - lo);
    const m2 = lo + g * (hi - lo);
    if (dist(m1) < dist(m2)) hi = m2;
    else lo = m1;
  }
  const tca = (lo + hi) / 2;
  const sa = stateAt(ra, tca);
  const sb = stateAt(rb, tca);
  const relSpeed = sa && sb ? Math.hypot(sa.velocity.x - sb.velocity.x, sa.velocity.y - sb.velocity.y, sa.velocity.z - sb.velocity.z) : NaN;
  return { pts, span, tca, minKm: dist(tca), relSpeed };
}

/** Angle (deg) between two orbit planes. */
function planeAngle(a: SatObject, b: SatObject) {
  const n = (o: SatObject) => {
    const i = (o.incl * Math.PI) / 180;
    const W = (o.raan * Math.PI) / 180;
    return [Math.sin(i) * Math.sin(W), -Math.sin(i) * Math.cos(W), Math.cos(i)];
  };
  const p = n(a);
  const q = n(b);
  return (Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))) * 180) / Math.PI;
}

export function compareSection(app: App, a: SatObject, b: SatObject) {
  const el = h('div', { class: 'isec compare' });
  if (a.decay || b.decay || app.history) {
    el.append(
      h('h3', null, 'Compared with', h('span', null, b.name)),
      h('p', { class: 'sky-hint', style: 'margin:0 0 8px' }, 'Comparisons use current orbits, so they work in live time with objects that are still in orbit.'),
      h('button', { class: 'btn', onclick: () => app.clearCompare() }, 'Stop comparing'),
    );
    return { el, update: () => {} };
  }
  const from = app.clock.now();
  const series = distanceSeries(a, b, from);
  const head = h(
    'h3',
    null,
    'Compared with',
    h('span', null, h('button', { class: 'link-btn', onclick: () => app.select(b, { fly: true }), title: 'Select it instead' }, b.name)),
  );
  const nowCell = h('div', { class: 'v' }, '—');
  const closeCell = h('div', { class: 'v' }, series ? fmtKm(series.minKm) : '—', h('small', null, 'km'));
  const whenCell = h('div', { class: 'v' }, series ? fmtCountdown(series.tca - Date.now()) : '—');
  const live = h(
    'div',
    { class: 'live live-sky' },
    h('div', null, h('div', { class: 'l' }, 'Distance now'), nowCell),
    h('div', null, h('div', { class: 'l' }, 'Closest'), closeCell),
    h('div', null, h('div', { class: 'l' }, 'When'), whenCell),
  );

  // Distance chart
  const W = 372;
  const H = 110;
  const pad = { l: 40, r: 6, t: 8, b: 16 };
  const svg = s('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Distance between the two objects over time' });
  const cursor = s('line', { class: 'grid', y1: pad.t, y2: H - pad.b, stroke: 'rgba(255,255,255,0.35)' });
  const nowDot = s('circle', { r: 3, fill: '#fff' });
  if (series) {
    const max = Math.max(...series.pts.map((p) => p.d));
    const X = (t: number) => pad.l + ((t - from) / series.span) * (W - pad.l - pad.r);
    const Y = (d: number) => pad.t + (1 - d / max) * (H - pad.t - pad.b);
    for (const v of [0, max / 2, max]) {
      svg.append(s('line', { class: 'grid', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
      svg.append(s('text', { x: pad.l - 4, y: Y(v) + 3, 'text-anchor': 'end' }, fmtKm(v)));
    }
    const hours = series.span / 3600e3;
    const every = hours > 48 ? 24 : hours > 24 ? 12 : 6;
    for (let hh = 0; hh <= hours; hh += every) svg.append(s('text', { x: X(from + hh * 3600e3), y: H - 3, 'text-anchor': hh === 0 ? 'start' : 'middle' }, hh === 0 ? 'now' : `+${hh} h`));
    const d = series.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.d).toFixed(1)}`).join('');
    svg.append(s('path', { d, fill: 'none', stroke: '#ff8a7a', 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' }));
    svg.append(s('circle', { cx: X(series.tca), cy: Y(series.minKm), r: 4, fill: 'none', stroke: '#fff', 'stroke-width': 1.5 }));
    svg.append(cursor, nowDot);
    // Hover: time and distance under the pointer.
    const tooltip = document.getElementById('tooltip')!;
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const t = from + ((((e.clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r)) * series.span;
      let best = series.pts[0];
      for (const p of series.pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      cursor.setAttribute('x1', String(X(best.t)));
      cursor.setAttribute('x2', String(X(best.t)));
      tooltip.hidden = false;
      tooltip.style.left = `${e.clientX}px`;
      tooltip.style.top = `${e.clientY}px`;
      tooltip.replaceChildren(h('b', null, `${fmtKm(best.d)} km`), h('div', { class: 'tt-sub' }, `${fmtUtc(best.t, false)} UTC`));
    });
    svg.addEventListener('mouseleave', () => (tooltip.hidden = true));
    svg.addEventListener('click', () => {
      const x = Number(cursor.getAttribute('x1'));
      const t = from + ((x - pad.l) / (W - pad.l - pad.r)) * series.span;
      app.clock.set(t);
    });
    (svg as unknown as { _xy: unknown })._xy = { X, Y };
  }

  const rows: [string, string, string][] = [
    ['Type', TYPE_LABEL[a.type], TYPE_LABEL[b.type]],
    ['Owner', ownerName(a.owner), ownerName(b.owner)],
    ['Apogee', `${fmtKm(a.apogee)} km`, `${fmtKm(b.apogee)} km`],
    ['Perigee', `${fmtKm(a.perigee)} km`, `${fmtKm(b.perigee)} km`],
    ['Inclination', `${fmt(a.incl, 2)}°`, `${fmt(b.incl, 2)}°`],
    ['Period', fmtDuration(a.period), fmtDuration(b.period)],
    ['RAAN', `${fmt(a.raan, 1)}°`, `${fmt(b.raan, 1)}°`],
    ['Launched', a.launch ? fmtDate(a.launch) : '—', b.launch ? fmtDate(b.launch) : '—'],
  ];
  const table = h(
    'table',
    { class: 'cmp-table' },
    h('thead', null, h('tr', null, h('th'), h('th', null, a.name), h('th', null, b.name))),
    h('tbody', null, ...rows.map(([k, x, y]) => h('tr', null, h('td', null, k), h('td', null, x), h('td', null, y)))),
  );
  const plane = planeAngle(a, b);

  el.append(
    head,
    live,
    series ? h('div', { class: 'cmp-chart' }, svg, h('p', { class: 'sky-hint', style: 'margin:4px 0 0' }, `Over the next ${Math.round(series.span / 3600e3)} hours. Closest ${fmtUtc(series.tca, false)} UTC at ${series.relSpeed.toFixed(2)} km/s relative speed. Click the chart to jump there.`)) : h('p', { class: 'sky-hint' }, 'Distance unavailable for this pair.'),
    h(
      'div',
      { class: 'sky-actions', style: 'margin:10px 0' },
      series ? h('button', { class: 'btn primary', onclick: () => (app.clock.setRate(1), app.clock.setPaused(false), app.clock.set(series.tca - 60e3)) }, 'Jump to closest approach') : null,
      h('button', { class: 'btn', onclick: () => app.setComparePicking(true) }, 'Compare another'),
      h('button', { class: 'btn', onclick: () => app.clearCompare() }, 'Stop'),
    ),
    table,
    h('p', { class: 'sky-hint', style: 'margin:8px 0 0' }, `Orbit planes are ${fmt(plane, 1)}° apart${plane < 2 ? ' — nearly the same plane' : ''}.`),
  );

  function update(t: number) {
    const km = app.pairDistanceKm(t);
    nowCell.replaceChildren(km === null ? '—' : fmtKm(km), h('small', null, 'km'));
    if (series) {
      whenCell.textContent = series.tca > t ? fmtCountdown(series.tca - t) : 'passed';
      const xy = (svg as unknown as { _xy?: { X: (t: number) => number; Y: (d: number) => number } })._xy;
      if (xy && km !== null && t >= from && t <= from + series.span) {
        nowDot.setAttribute('cx', String(xy.X(t)));
        nowDot.setAttribute('cy', String(xy.Y(km)));
      }
    }
  }
  return { el, update };
}
