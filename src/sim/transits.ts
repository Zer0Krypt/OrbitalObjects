import type { SatRec } from 'satellite.js';
import { gmst, KM, moonPositionEci } from './astro';
import { findPasses, observerFrame, sunScene, type Observer, type ObserverFrame } from './observer';
import { stateAt } from '../render/orbits';

/**
 * Transits of the Sun and Moon: moments when a satellite crosses the disc as
 * seen from somewhere near you. For each pass, the satellite's separation from
 * the Sun and Moon is minimised; then the "centre line" is traced, the strip
 * of ground from which it passes exactly across the centre, so you can see how
 * far you'd need to travel to catch it.
 */

const DEG = Math.PI / 180;
const RE = 6371;

export interface Transit {
  body: 'sun' | 'moon';
  /** Time of least separation from your location (ms). */
  t: number;
  /** Least separation from the body's centre, deg. */
  sepDeg: number;
  /** Body's angular radius, deg. */
  radiusDeg: number;
  /** Visible across the disc from your location itself. */
  fromHere: boolean;
  /** Seconds spent crossing the disc (from here, or on the centre line). */
  duration: number;
  /** Distance (km) and compass bearing from you to the nearest point of the centre line. */
  lineKm: number;
  lineAz: number;
  /** Half-width (km) of the strip from which it crosses the disc at all. */
  halfWidthKm: number;
  /** Elevation of the body (deg) and the satellite's range (km). */
  bodyEl: number;
  rangeKm: number;
  /** The centre line on the ground: [lat, lon] pairs around the moment. */
  line: [number, number][];
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: V, b: V) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b))))) / DEG;

/** Satellite position in scene units (Earth radii). */
function satScene(rec: SatRec, t: number): V | null {
  const st = stateAt(rec, t);
  if (!st) return null;
  const p = st.position;
  return [p.x * KM, p.z * KM, -p.y * KM];
}
function moonScene(t: number): V {
  const m = moonPositionEci(t);
  return [m[0] * KM, m[2] * KM, -m[1] * KM];
}
/** Direction from the observer to the body (unnormalised) and its position (null for the Sun: at infinity). */
function bodyDir(body: 'sun' | 'moon', f: ObserverFrame, t: number): { dir: V; pos: V | null } {
  if (body === 'sun') return { dir: sunScene(t), pos: null };
  const m = moonScene(t);
  return { dir: sub(m, f.p), pos: m };
}

// WGS-84, in scene units (Earth radii of 6371 km); scene y is the polar axis.
const A = 6378.137 / RE;
const B = A * (1 - 1 / 298.257223563);
const E2 = 1 - (B * B) / (A * A);

/** Scene point on the ellipsoid -> geodetic lat/lon (deg) at time t. */
function toLatLon(p: V, t: number): [number, number] {
  const g = gmst(t);
  const xi = p[0];
  const yi = -p[2];
  const x = xi * Math.cos(g) + yi * Math.sin(g);
  const y = -xi * Math.sin(g) + yi * Math.cos(g);
  // On the surface itself, tan(geodetic lat) = z / ((1 − e²) · p).
  return [Math.atan2(p[1], (1 - E2) * Math.hypot(x, y)) / DEG, Math.atan2(y, x) / DEG];
}

/** Where the line from the body through the satellite meets the ground (WGS-84), if it does. */
function shadowPoint(sat: V, body: 'sun' | 'moon', t: number): V | null {
  const d0: V = body === 'sun' ? (sunScene(t).map((v) => -v) as V) : sub(sat, moonScene(t));
  // Squash the ellipsoid into a unit sphere, intersect, and stretch back.
  const o: V = [sat[0] / A, sat[1] / B, sat[2] / A];
  const dr: V = [d0[0] / A, d0[1] / B, d0[2] / A];
  const l = len(dr);
  const d: V = [dr[0] / l, dr[1] / l, dr[2] / l];
  const b = dot(o, d);
  const c = dot(o, o) - 1;
  const disc = b * b - c;
  if (disc < 0) return null;
  const k = -b - Math.sqrt(disc);
  if (k < 0) return null;
  return [(o[0] + d[0] * k) * A, (o[1] + d[1] * k) * B, (o[2] + d[2] * k) * A];
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const a = Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  const d = 2 * RE * Math.asin(Math.sqrt(a));
  const az = Math.atan2(Math.sin((lon2 - lon1) * DEG) * Math.cos(lat2 * DEG), Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) - Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lon2 - lon1) * DEG)) / DEG;
  return { km: d, az: (az + 360) % 360 };
}

/**
 * Transits within `maxKm` of the observer over `days`, for one object.
 * `periodMin` is the object's orbital period (for the pass search).
 */
export function findTransits(rec: SatRec, ob: Observer, from: number, days: number, periodMin: number, maxKm = 100): Transit[] {
  const passes = findPasses(rec, ob, from, days * 24, 0, periodMin, 99);
  if (!Array.isArray(passes)) return [];
  const out: Transit[] = [];
  for (const p of passes) {
    for (const body of ['sun', 'moon'] as const) {
      const sepAt = (t: number) => {
        const f = observerFrame(ob, gmst(t));
        const s = satScene(rec, t);
        if (!s) return { sep: 999, f, s };
        return { sep: angle(sub(s, f.p), bodyDir(body, f, t).dir), f, s };
      };
      // The body must be up during the pass.
      const mid = (p.rise + p.set) / 2;
      const fm = observerFrame(ob, gmst(mid));
      const bd = bodyDir(body, fm, mid).dir;
      if (dot(bd, fm.up) / len(bd) < Math.sin(-1 * DEG)) continue;
      // Coarse: every 3 s across the pass.
      let bestT = p.rise;
      let best = 999;
      for (let t = p.rise; t <= p.set; t += 3000) {
        const v = sepAt(t).sep;
        if (v < best) {
          best = v;
          bestT = t;
        }
      }
      // From far away (even 100 km off the line) the separation is at most a few degrees.
      if (best > 12) continue;
      let lo = bestT - 3000;
      let hi = bestT + 3000;
      const g = (Math.sqrt(5) - 1) / 2;
      for (let k = 0; k < 30 && hi - lo > 2; k++) {
        const m1 = hi - g * (hi - lo);
        const m2 = lo + g * (hi - lo);
        if (sepAt(m1).sep < sepAt(m2).sep) hi = m2;
        else lo = m1;
      }
      const t = (lo + hi) / 2;
      const { sep, f, s } = sepAt(t);
      if (!s) continue;
      const bdir = bodyDir(body, f, t);
      const bodyEl = Math.asin(dot(bdir.dir, f.up) / len(bdir.dir)) / DEG;
      if (bodyEl < 0) continue;
      const radiusDeg = body === 'sun' ? 0.2666 : Math.asin(1737.4 / (len(bdir.dir) / KM)) / DEG;
      const rangeKm = len(sub(s, f.p)) / KM;
      // Angular speed across the sky, for how long the crossing lasts.
      const a1 = satScene(rec, t - 500);
      const a2 = satScene(rec, t + 500);
      const f1 = observerFrame(ob, gmst(t - 500));
      const f2 = observerFrame(ob, gmst(t + 500));
      const rate = a1 && a2 ? angle(sub(a1, f1.p), sub(a2, f2.p)) : 1;
      // The centre line: ±30 s of shadow-ray ground points.
      const line: [number, number][] = [];
      let nearest = { km: Infinity, az: 0 };
      for (let dt = -30000; dt <= 30000; dt += 500) {
        const sp = satScene(rec, t + dt);
        const gp = sp && shadowPoint(sp, body, t + dt);
        if (!gp) continue;
        const ll = toLatLon(gp, t + dt);
        line.push(ll);
        const d = haversine(ob.lat, ob.lon, ll[0], ll[1]);
        if (d.km < nearest.km) nearest = d;
      }
      if (!line.length || nearest.km > maxKm) continue;
      const halfWidthKm = rangeKm * Math.tan(radiusDeg * DEG);
      const fromHere = sep < radiusDeg;
      const chordDeg = 2 * Math.sqrt(Math.max(0, radiusDeg ** 2 - (fromHere ? sep ** 2 : 0)));
      out.push({ body, t, sepDeg: sep, radiusDeg, fromHere, duration: chordDeg / Math.max(rate, 1e-6), lineKm: nearest.km, lineAz: nearest.az, halfWidthKm, bodyEl, rangeKm, line });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
