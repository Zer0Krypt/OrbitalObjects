import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { eciToGeodetic, gmst } from '../sim/astro';
import { fmt, fmtInt } from './dom';

// The geostationary belt unrolled: longitude across, height relative to the
// geostationary altitude up. Station-kept satellites sit in a thin line at 0;
// drifting ones wander off it; retired ones are boosted into the graveyard
// a few hundred km above.

const GEO_ALT = 35786;
/** Sidereal rotation rate in rev/day: a satellite at this mean motion stays put. */
const N_SYNC = 1.00273791;
const Y_MIN = -400;
const Y_MAX = 700;

export type GeoClass = 'kept' | 'drift' | 'grave' | 'other';
export const GEO_CLASSES: { key: GeoClass; label: string; color: string; note: string }[] = [
  { key: 'kept', label: 'Holding station', color: '#3987e5', note: 'within 0.1°/day of a fixed longitude' },
  { key: 'drift', label: 'Drifting', color: '#fab219', note: 'moving east or west along the belt' },
  { key: 'grave', label: 'Graveyard', color: '#9085e9', note: 'retired 200 km or more above the belt' },
  { key: 'other', label: 'Stages & debris', color: '#7d8394', note: 'rocket bodies and fragments' },
];
const COLOR = Object.fromEntries(GEO_CLASSES.map((c) => [c.key, c.color])) as Record<GeoClass, string>;

export interface GeoPoint {
  o: SatObject;
  lon: number;
  dAlt: number;
  /** Drift in degrees of longitude per day (east positive). */
  drift: number;
  cls: GeoClass;
  x: number;
  y: number;
}

const nearGeo = (o: SatObject) => o.period > 1300 && o.period < 1600 && o.ecc < 0.05;

export function classify(o: SatObject, dAlt: number, drift: number): GeoClass {
  if (o.type !== 'P' && o.type !== 'U') return 'other';
  if (dAlt > 200) return 'grave';
  return Math.abs(drift) > 0.1 ? 'drift' : 'kept';
}

/** Current sub-satellite longitude and the belt metrics for each near-GEO object. */
export function geoPoints(app: App, list: SatObject[], t: number): GeoPoint[] {
  const g = gmst(t);
  const out: GeoPoint[] = [];
  for (const o of list) {
    if (!nearGeo(o) || !app.hasPosition(o)) continue;
    const s = app.scenePosition(o, undefined, t);
    const geo = eciToGeodetic(s.x * 6371, -s.z * 6371, s.y * 6371, g);
    const dAlt = (o.perigee + o.apogee) / 2 - GEO_ALT;
    const drift = (o.meanMotion - N_SYNC) * 360;
    out.push({ o, lon: geo.lon, dAlt, drift, cls: classify(o, dAlt, drift), x: 0, y: 0 });
  }
  return out;
}

const REGIONS: [number, string][] = [
  [-100, 'Americas'],
  [-30, 'Atlantic'],
  [20, 'Europe · Africa'],
  [70, 'Indian Ocean'],
  [120, 'Asia'],
  [170, 'Pacific'],
];

/** Draw the belt on a canvas; returns the points with screen positions for hit-testing. */
export function drawGeoBelt(canvas: HTMLCanvasElement, W: number, H: number, pts: GeoPoint[], selected: SatObject | null, hovered: SatObject | null) {
  const dpr = Math.min(2, window.devicePixelRatio);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const pad = { l: 52, r: 12, t: 16, b: 22 };
  const X = (lon: number) => pad.l + ((lon + 180) / 360) * (W - pad.l - pad.r);
  const Y = (d: number) => pad.t + ((Y_MAX - Math.max(Y_MIN, Math.min(Y_MAX, d))) / (Y_MAX - Y_MIN)) * (H - pad.t - pad.b);

  // Bands: the protected GEO region (±200 km) and the graveyard above it.
  g.fillStyle = 'rgba(57,135,229,0.07)';
  g.fillRect(pad.l, Y(200), W - pad.l - pad.r, Y(-200) - Y(200));
  g.fillStyle = 'rgba(144,133,233,0.07)';
  g.fillRect(pad.l, Y(Y_MAX), W - pad.l - pad.r, Y(235) - Y(Y_MAX));
  g.font = '9.5px "JetBrains Mono Variable", monospace';
  g.fillStyle = '#7c8598';
  g.strokeStyle = 'rgba(160,190,255,0.07)';
  g.textAlign = 'right';
  for (let v = -400; v <= Y_MAX; v += 200) {
    g.beginPath();
    g.moveTo(pad.l, Y(v));
    g.lineTo(W - pad.r, Y(v));
    g.stroke();
    g.fillText(v === 0 ? 'GEO' : `${v > 0 ? '+' : '−'}${Math.abs(v)}`, pad.l - 5, Y(v) + 3);
  }
  g.strokeStyle = 'rgba(57,135,229,0.35)';
  g.beginPath();
  g.moveTo(pad.l, Y(0));
  g.lineTo(W - pad.r, Y(0));
  g.stroke();
  g.textAlign = 'left';
  g.fillStyle = 'rgba(144,133,233,0.8)';
  g.fillText('graveyard orbits', pad.l + 6, Y(Y_MAX) + 11);
  g.fillStyle = 'rgba(125,170,230,0.8)';
  g.fillText('protected GEO region ±200 km', pad.l + 6, Y(200) + 11);
  // Longitude axis and regions.
  g.textAlign = 'center';
  g.fillStyle = '#7c8598';
  for (let lon = -180; lon <= 180; lon += 60) g.fillText(`${Math.abs(lon)}°${lon < 0 ? 'W' : lon > 0 && lon < 180 ? 'E' : ''}`, X(lon), H - 6);
  g.fillStyle = 'rgba(180,188,204,0.35)';
  g.font = '500 10px "Inter Variable", system-ui';
  if (W > 520) for (const [lon, name] of REGIONS) g.fillText(name, X(lon), H - pad.b - 6);
  g.save();
  g.translate(12, (H - pad.b + pad.t) / 2);
  g.rotate(-Math.PI / 2);
  g.fillStyle = '#7c8598';
  g.font = '9.5px "Inter Variable", system-ui';
  g.fillText('km above / below GEO', 0, 0);
  g.restore();

  // Points: drifting ones get a short tail showing a day's drift.
  for (const p of pts) {
    p.x = X(p.lon);
    p.y = Y(p.dAlt);
  }
  g.lineWidth = 1;
  for (const p of pts) {
    if (p.cls !== 'drift') continue;
    const dx = (Math.max(-6, Math.min(6, p.drift)) / 360) * (W - pad.l - pad.r) * 3;
    g.strokeStyle = 'rgba(250,178,25,0.35)';
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.lineTo(p.x - dx, p.y);
    g.stroke();
  }
  for (const cls of ['other', 'grave', 'drift', 'kept'] as GeoClass[]) {
    g.fillStyle = COLOR[cls];
    for (const p of pts) {
      if (p.cls !== cls) continue;
      g.globalAlpha = cls === 'other' ? 0.55 : 0.9;
      g.beginPath();
      g.arc(p.x, p.y, cls === 'kept' ? 2.2 : 1.8, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  for (const o of [hovered, selected]) {
    const p = o && pts.find((q) => q.o === o);
    if (!p) continue;
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(p.x, p.y, 6, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#eaeef6';
    g.font = '600 11px "Inter Variable", system-ui';
    g.textAlign = p.x > W - 140 ? 'right' : 'left';
    g.fillText(p.o.name, p.x + (p.x > W - 140 ? -10 : 10), p.y - 8);
  }
  return pts;
}

export function geoRows(p: GeoPoint): [string, string, string?][] {
  const c = GEO_CLASSES.find((x) => x.key === p.cls)!;
  return [
    ['Longitude', `${fmt(Math.abs(p.lon), 1)}° ${p.lon >= 0 ? 'E' : 'W'}`],
    ['Height vs GEO', `${p.dAlt >= 0 ? '+' : '−'}${fmtInt(Math.abs(p.dAlt))} km`],
    ['Drift', `${Math.abs(p.drift) < 0.01 ? '0' : fmt(Math.abs(p.drift), 2)}°/day${Math.abs(p.drift) >= 0.01 ? (p.drift > 0 ? ' east' : ' west') : ''}`],
    ['Inclination', `${fmt(p.o.incl, 2)}°`],
    [c.label, '', c.color],
  ];
}
