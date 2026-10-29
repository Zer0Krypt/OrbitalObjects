import type { SatRec } from 'satellite.js';
import { gmst, KM, sunDirectionEci } from './astro';
import { stateAt } from '../render/orbits';
import { apparentMagnitude, NAKED_EYE_MAG, phaseAngle } from './brightness';

export interface Observer {
  lat: number; // deg, geodetic
  lon: number; // deg, east positive
  alt: number; // km above the WGS-84 ellipsoid
  source: 'device' | 'manual' | 'globe';
  accuracy?: number; // metres (device only)
}

const DEG = Math.PI / 180;
const A = 6378.137;
const E2 = 0.00669437999014;

/** Observer position and local frame (up / east / north) in scene coordinates at a given GMST. */
export interface ObserverFrame {
  p: [number, number, number];
  up: [number, number, number];
  east: [number, number, number];
  north: [number, number, number];
}

/** ECEF (x, y, z) -> scene, rotated into the inertial frame by GMST g. */
function toScene(x: number, y: number, z: number, g: number, scale: number): [number, number, number] {
  const c = Math.cos(g);
  const s = Math.sin(g);
  const xi = x * c - y * s;
  const yi = x * s + y * c;
  return [xi * scale, z * scale, -yi * scale];
}

export function observerFrame(o: Observer, g: number): ObserverFrame {
  const la = o.lat * DEG;
  const lo = o.lon * DEG;
  const sl = Math.sin(la);
  const cl = Math.cos(la);
  const N = A / Math.sqrt(1 - E2 * sl * sl);
  const x = (N + o.alt) * cl * Math.cos(lo);
  const y = (N + o.alt) * cl * Math.sin(lo);
  const z = (N * (1 - E2) + o.alt) * sl;
  return {
    p: toScene(x, y, z, g, KM),
    up: toScene(cl * Math.cos(lo), cl * Math.sin(lo), sl, g, 1),
    east: toScene(-Math.sin(lo), Math.cos(lo), 0, g, 1),
    north: toScene(-sl * Math.cos(lo), -sl * Math.sin(lo), cl, g, 1),
  };
}

/** Azimuth (deg from north, clockwise), elevation (deg) and range (km) of a scene point. */
export function lookAngles(f: ObserverFrame, x: number, y: number, z: number) {
  const dx = x - f.p[0];
  const dy = y - f.p[1];
  const dz = z - f.p[2];
  const r = Math.hypot(dx, dy, dz) || 1e-9;
  const u = (dx * f.up[0] + dy * f.up[1] + dz * f.up[2]) / r;
  const e = dx * f.east[0] + dy * f.east[1] + dz * f.east[2];
  const n = dx * f.north[0] + dy * f.north[1] + dz * f.north[2];
  let az = Math.atan2(e, n) / DEG;
  if (az < 0) az += 360;
  return { az, el: Math.asin(Math.max(-1, Math.min(1, u))) / DEG, range: r / KM };
}

/** Sun elevation (deg) at the observer. */
export function sunElevation(f: ObserverFrame, ms: number) {
  const s = sunDirectionEci(ms);
  // ECI (x, y, z) -> scene (x, z, -y)
  const d = s[0] * f.up[0] + s[2] * f.up[1] - s[1] * f.up[2];
  return Math.asin(Math.max(-1, Math.min(1, d))) / DEG;
}

/** Is a scene point (Earth radii) in sunlight? Cylindrical shadow model. */
export function sunlitScene(x: number, y: number, z: number, sunScene: [number, number, number]) {
  const d = x * sunScene[0] + y * sunScene[1] + z * sunScene[2];
  if (d > 0) return true;
  const px = x - d * sunScene[0];
  const py = y - d * sunScene[1];
  const pz = z - d * sunScene[2];
  return Math.hypot(px, py, pz) > 6378.137 * KM;
}

export function sunScene(ms: number): [number, number, number] {
  const s = sunDirectionEci(ms);
  return [s[0], s[2], -s[1]];
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (az: number) => COMPASS[Math.round(az / 22.5) % 16];

export interface Pass {
  rise: number; // ms
  set: number;
  peak: number;
  maxEl: number;
  riseAz: number;
  setAz: number;
  peakAz: number;
  /** Bright enough to see, sunlit, while the observer's sky is dark, at some point of the pass. */
  visible: boolean;
  /** Brightest predicted magnitude while sunlit in a dark sky (99 if never). */
  peakMag: number;
  /** When that happens. */
  peakMagAt: number;
}

/** SGP4 look angles at a time (exact, for passes and the info panel). */
export function lookAt(rec: SatRec, o: Observer, ms: number) {
  const st = stateAt(rec, ms);
  if (!st) return null;
  const p = st.position;
  const f = observerFrame(o, gmst(ms));
  const x = p.x * KM;
  const y = p.z * KM;
  const z = -p.y * KM;
  const sun = sunScene(ms);
  return { ...lookAngles(f, x, y, z), sunlit: sunlitScene(x, y, z, sun), sunEl: sunElevation(f, ms), phase: phaseAngle([x, y, z], f.p, sun), x, y, z };
}

/** Predicted magnitude for a look-angle result, or 99 when unlit or below the horizon. */
export function magnitudeOf(la: NonNullable<ReturnType<typeof lookAt>>, stdMag: number) {
  if (!la.sunlit || la.el <= 0) return 99;
  return apparentMagnitude(stdMag, la.range, la.phase, la.el);
}

/**
 * Upcoming passes above `minEl` within `hours`. Steps coarsely, then refines
 * rise and set by bisection. Returns 'always' / 'never' for objects that stay
 * above or below the horizon for the whole window (e.g. geostationary).
 */
export function findPasses(rec: SatRec, o: Observer, from: number, hours = 48, minEl = 0, periodMin = 95, stdMag = 6): Pass[] | 'always' | 'never' {
  const stepMs = Math.min(60e3, Math.max(10e3, periodMin * 60e3 / 300));
  const end = from + hours * 3600e3;
  const el = (t: number) => lookAt(rec, o, t)?.el ?? -90;
  const refine = (a: number, b: number, rising: boolean) => {
    for (let k = 0; k < 18; k++) {
      const m = (a + b) / 2;
      if (el(m) >= minEl === rising) b = m;
      else a = m;
    }
    return (a + b) / 2;
  };
  const passes: Pass[] = [];
  let prevT = from;
  let prevUp = el(from) >= minEl;
  const startUp = prevUp;
  let everUp = prevUp;
  let everDown = !prevUp;
  let riseT: number | null = prevUp ? from : null;
  for (let t = from + stepMs; t <= end && passes.length < 12; t += stepMs) {
    const up = el(t) >= minEl;
    everUp ||= up;
    everDown ||= !up;
    if (up && !prevUp) riseT = refine(prevT, t, true);
    if (!up && prevUp && riseT !== null) {
      const setT = refine(prevT, t, false);
      passes.push(describe(rec, o, riseT, setT, stdMag));
      riseT = null;
    }
    prevUp = up;
    prevT = t;
  }
  if (!everDown && startUp) return 'always';
  if (!everUp) return 'never';
  // Drop a pass already in progress at `from` only if it was cut off at the start.
  return passes;
}

function describe(rec: SatRec, o: Observer, rise: number, set: number, stdMag: number): Pass {
  let maxEl = -90;
  let peak = rise;
  let peakAz = 0;
  let peakMag = 99;
  let peakMagAt = rise;
  const n = 30;
  for (let i = 0; i <= n; i++) {
    const t = rise + ((set - rise) * i) / n;
    const la = lookAt(rec, o, t);
    if (!la) continue;
    if (la.el > maxEl) {
      maxEl = la.el;
      peak = t;
      peakAz = la.az;
    }
    if (la.sunlit && la.sunEl < -6 && la.el > 0) {
      const m = magnitudeOf(la, stdMag);
      if (m < peakMag) {
        peakMag = m;
        peakMagAt = t;
      }
    }
  }
  return {
    rise,
    set,
    peak,
    maxEl,
    peakAz,
    riseAz: lookAt(rec, o, rise)?.az ?? 0,
    setAz: lookAt(rec, o, set)?.az ?? 0,
    visible: peakMag <= NAKED_EYE_MAG,
    peakMag,
    peakMagAt,
  };
}

// ---------- persistence ----------
const KEY = 'oo.observer';
export function loadObserver(): Observer | null {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && Number.isFinite(o.lat) && Number.isFinite(o.lon)) return { alt: 0, source: 'manual', ...o };
  } catch {
    /* storage unavailable */
  }
  return null;
}
export function saveObserver(o: Observer | null) {
  try {
    if (o) localStorage.setItem(KEY, JSON.stringify(o));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
