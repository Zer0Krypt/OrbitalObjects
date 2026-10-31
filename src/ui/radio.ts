import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { fmtMHz, type Transmitter } from '../data/more';
import { satrecFor } from '../render/orbits';
import { compass, findPasses, lookAt, type Pass } from '../sim/observer';
import { h } from './dom';

const C_KMS = 299792.458;
const timeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** Range rate (km/s, positive when receding) from the observer. */
export function rangeRate(app: App, o: SatObject, t: number) {
  const rec = satrecFor(o);
  if (!rec || !app.observer) return null;
  const a = lookAt(rec, app.observer, t);
  const b = lookAt(rec, app.observer, t + 1000);
  if (!a || !b) return null;
  return { rr: b.range - a.range, el: a.el, az: a.az };
}

const fmtShift = (hz: number) => `${hz >= 0 ? '+' : '−'}${Math.abs(hz / 1000).toFixed(1)} kHz`;

function txLabel(x: Transmitter) {
  const bits = [x.mode, x.baud ? `${x.baud} bd` : '', x.inverted ? 'inverting' : ''].filter(Boolean);
  return bits.join(' · ');
}

/** "Radio" section of the info panel: transmitters, Doppler-corrected now, and the next pass. */
export function radioSection(app: App, o: SatObject) {
  const txs = app.radio?.sats.get(o.norad);
  if (!txs?.length) return null;
  const rows = txs.slice(0, 8).map((x) => {
    const now = h('span', { class: 'mono rx-now' });
    const row = h(
      'div',
      { class: 'rx-row' },
      h('div', { class: 'rx-desc' }, h('b', null, x.description), h('small', null, [txLabel(x), x.service].filter(Boolean).join(' · '))),
      h(
        'div',
        { class: 'rx-f' },
        x.downlink ? h('span', { class: 'mono' }, '↓ ', fmtMHz(x.downlink), x.downlinkHigh ? `–${(x.downlinkHigh / 1e6).toFixed(3)}` : '') : null,
        x.uplink ? h('small', { class: 'mono' }, '↑ ', fmtMHz(x.uplink), x.uplinkHigh ? `–${(x.uplinkHigh / 1e6).toFixed(3)}` : '') : null,
        now,
      ),
    );
    return { row, now, x };
  });
  const plot = h('canvas', { class: 'rx-plot', width: 300, height: 300, 'aria-label': 'Next pass: path across the sky' });
  const passNote = h('p', { class: 'sky-hint', style: 'margin:0' });
  const el = h(
    'div',
    { class: 'isec' },
    h('h3', null, 'Radio', h('span', null, 'SatNOGS DB')),
    ...rows.map((r) => r.row),
    app.observer ? h('div', { class: 'rx-pass' }, plot, h('div', null, h('div', { class: 'pass-head', style: 'margin-top:0' }, 'Next pass', h('span', null, 'any elevation')), passNote)) : h('p', { class: 'sky-hint', style: 'margin:6px 0 0' }, 'Set your location to see live Doppler-corrected frequencies and the next pass.'),
    h('p', { class: 'sky-hint', style: 'margin:8px 0 0' }, 'Doppler: a satellite coming toward you sounds higher, going away lower. Tune the downlink as shown; for uplinks, transmit the opposite way.'),
  );

  let pass: Pass | null = null;
  let track: { az: number; el: number }[] = [];
  let passAt = -Infinity;

  function findNext(t: number) {
    const rec = satrecFor(o);
    if (!rec || !app.observer) return;
    passAt = t;
    const ps = findPasses(rec, app.observer, t - 20 * 60e3, 24, 0, o.period, 6);
    pass = Array.isArray(ps) ? ps.find((p) => p.set > t) ?? null : null;
    track = [];
    if (pass) {
      const n = 60;
      for (let k = 0; k <= n; k++) {
        const la = lookAt(rec, app.observer, pass.rise + ((pass.set - pass.rise) * k) / n);
        if (la) track.push({ az: la.az, el: Math.max(0, la.el) });
      }
    }
    passNote.textContent = pass
      ? `${timeFmt.format(pass.rise)} – ${timeFmt.format(pass.set).replace(/^\w+\s/, '')} · rises ${compass(pass.riseAz)}, up to ${Math.round(pass.maxEl)}° ${compass(pass.peakAz)}, sets ${compass(pass.setAz)} · ${Math.round((pass.set - pass.rise) / 60e3)} min`
      : Array.isArray(ps)
        ? 'No pass in the next 24 hours.'
        : ps === 'always'
          ? 'Always above your horizon.'
          : 'Never rises above your horizon.';
  }

  function draw(cur: { az: number; el: number } | null) {
    const g = plot.getContext('2d')!;
    const S = 300;
    const c = S / 2;
    const R = S / 2 - 18;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(10,16,32,0.9)';
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(160,190,255,0.18)';
    g.lineWidth = 1.5;
    for (const e of [0, 30, 60]) {
      g.beginPath();
      g.arc(c, c, ((90 - e) / 90) * R, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#9aa3b5';
    g.font = '600 18px "Inter Variable", system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [l, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as [string, number][]) g.fillText(l, c + (R + 10) * Math.sin(a * (Math.PI / 180)), c - (R + 10) * Math.cos(a * (Math.PI / 180)));
    const P = (az: number, e: number) => {
      const r = ((90 - e) / 90) * R;
      return [c + r * Math.sin(az * (Math.PI / 180)), c - r * Math.cos(az * (Math.PI / 180))];
    };
    if (track.length) {
      g.strokeStyle = app.colorsHex[o.idx] ?? '#3987e5';
      g.lineWidth = 3;
      g.beginPath();
      track.forEach((p, i) => {
        const [x, y] = P(p.az, p.el);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
      const [x0, y0] = P(track[0].az, track[0].el);
      g.fillStyle = '#0ca30c';
      g.beginPath();
      g.arc(x0, y0, 5, 0, Math.PI * 2);
      g.fill();
    }
    if (cur && cur.el > 0) {
      const [x, y] = P(cur.az, cur.el);
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
    }
  }

  let lastDraw = 0;
  function update(t: number) {
    if (!app.observer) return;
    if (Math.abs(t - passAt) > 10 * 60e3 || (pass && t > pass.set)) findNext(t);
    const r = rangeRate(app, o, t);
    for (const { now, x } of rows) {
      if (!r || r.el <= 0 || !x.downlink) {
        now.textContent = r && x.downlink ? 'below horizon' : '';
        continue;
      }
      const f = x.downlink * (1 - r.rr / C_KMS);
      now.textContent = `now ${(f / 1e6).toFixed(4)} (${fmtShift(f - x.downlink)})`;
    }
    if (performance.now() - lastDraw > 500) {
      lastDraw = performance.now();
      draw(r);
    }
  }
  return { el, update };
}
