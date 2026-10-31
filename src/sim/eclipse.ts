/**
 * Solar and lunar eclipses from a more precise Sun and Moon than the
 * renderer's: the Moon from the main terms of Meeus' lunar theory
 * (Astronomical Algorithms ch. 47, about 10″), the Sun from the equation of
 * centre plus the largest perturbations (a few arcseconds). That puts the
 * Moon's shadow on the ground to within roughly 10–30 km, fine for a map but
 * not for planning a trip to the edge of totality.
 *
 * Everything here is in the inertial equatorial frame of date (km), which is
 * what SGP4's TEME frame approximates; Earth-fixed coordinates come from GMST.
 */
import { gmst } from './astro';

const DEG = Math.PI / 180;
/** TT − UT, seconds (about 69 s for the late 2020s). */
const DELTA_T = 69.2;
export const R_EQ = 6378.137;
const FLAT = 1 / 298.257;
const ZSCALE = 1 / (1 - FLAT);
export const R_MOON = 1737.4;
export const R_SUN = 696000;
const AU = 149597870.7;

const centuries = (ms: number) => (ms / 86400000 + 2440587.5 + DELTA_T / 86400 - 2451545) / 36525;
const rev = (x: number) => ((x % 360) + 360) % 360;

// D, M, M′, F, Σl (1e-6 deg), Σr (1e-3 km)
const LR: number[][] = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149], [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210], [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056], [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897], [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0], [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];
// D, M, M′, F, Σb (1e-6 deg)
const B: number[][] = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324], [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475], [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
];

/** Geocentric ecliptic longitude, latitude (rad, mean equinox of date) and distance (km) of the Moon. */
export function moonEcliptic(ms: number) {
  const T = centuries(ms);
  const Lp = rev(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + (T * T * T) / 538841);
  const D = rev(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + (T * T * T) / 545868);
  const M = rev(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const Mp = rev(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + (T * T * T) / 69699);
  const F = rev(93.272095 + 483202.0175233 * T - 0.0036539 * T * T - (T * T * T) / 3526000);
  const A1 = rev(119.75 + 131.849 * T);
  const A2 = rev(53.09 + 479264.29 * T);
  const A3 = rev(313.45 + 481266.484 * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let sl = 0;
  let sr = 0;
  let sb = 0;
  for (const [d, m, mp, f, l, r] of LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) * DEG;
    const e = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sl += l * e * Math.sin(arg);
    sr += r * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of B) {
    const e = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sb += b * e * Math.sin((d * D + m * M + mp * Mp + f * F) * DEG);
  }
  sl += 3958 * Math.sin(A1 * DEG) + 1962 * Math.sin((Lp - F) * DEG) + 318 * Math.sin(A2 * DEG);
  sb += -2235 * Math.sin(Lp * DEG) + 382 * Math.sin(A3 * DEG) + 175 * Math.sin((A1 - F) * DEG) + 175 * Math.sin((A1 + F) * DEG) + 127 * Math.sin((Lp - Mp) * DEG) - 115 * Math.sin((Lp + Mp) * DEG);
  return { lon: (Lp + sl / 1e6) * DEG, lat: (sb / 1e6) * DEG, dist: 385000.56 + sr / 1000 };
}

/** Geocentric ecliptic longitude (rad, mean equinox of date, with aberration) and distance (km) of the Sun. */
export function sunEcliptic(ms: number) {
  const T = centuries(ms);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = rev(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const e = 0.016708634 - 0.000042037 * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M * DEG) + (0.019993 - 0.000101 * T) * Math.sin(2 * M * DEG) + 0.000289 * Math.sin(3 * M * DEG);
  // Perturbations by Venus, Jupiter and the Moon (Earth's wobble about the barycentre).
  const pert =
    0.00134 * Math.cos((153.23 + 22518.7541 * T) * DEG) +
    0.00154 * Math.cos((216.57 + 45037.5082 * T) * DEG) +
    0.002 * Math.cos((312.69 + 32964.3577 * T) * DEG) +
    0.00179 * Math.sin((350.74 + 445267.1142 * T) * DEG) +
    0.00178 * Math.sin((231.19 + 20.2 * T) * DEG);
  const nu = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(nu * DEG));
  const lon = L0 + C + pert - 0.00569;
  return { lon: rev(lon) * DEG, lat: 0, dist: R * AU };
}

const obliquity = (ms: number) => (23.439291 - 0.0130042 * centuries(ms)) * DEG;

function eclToEq(lon: number, lat: number, dist: number, eps: number): [number, number, number] {
  const x = dist * Math.cos(lat) * Math.cos(lon);
  const y = dist * Math.cos(lat) * Math.sin(lon);
  const z = dist * Math.sin(lat);
  return [x, y * Math.cos(eps) - z * Math.sin(eps), y * Math.sin(eps) + z * Math.cos(eps)];
}

export type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec) => Math.sqrt(dot(a, a));
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec) => scale(a, 1 / len(a));
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a: Vec, b: Vec) => Math.atan2(len(cross(a, b)), dot(a, b));

/** Sun and Moon, geocentric, inertial equatorial frame of date (km). */
export function sunMoon(ms: number) {
  const eps = obliquity(ms);
  const s = sunEcliptic(ms);
  const m = moonEcliptic(ms);
  return { sun: eclToEq(s.lon, s.lat, s.dist, eps), moon: eclToEq(m.lon, m.lat, m.dist, eps) };
}

/** Fraction of the Sun's disc hidden by the Moon, seen from a point (km), and the eclipse magnitude. */
export function obscurationAt(p: Vec, sun: Vec, moon: Vec) {
  const ts = sub(sun, p);
  const tm = sub(moon, p);
  const rs = Math.asin(R_SUN / len(ts));
  const rm = Math.asin(R_MOON / len(tm));
  const d = angle(ts, tm);
  const mag = (rs + rm - d) / (2 * rs);
  return { fraction: discOverlap(rs, rm, d), magnitude: Math.max(0, mag), ratio: rm / rs, sep: d, rs, rm };
}

/** Area of the Sun's disc (radius r1) covered by the Moon's (r2) at separation d, as a fraction. */
export function discOverlap(r1: number, r2: number, d: number) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return r2 >= r1 ? 1 : (r2 * r2) / (r1 * r1);
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return (a + b - c) / (Math.PI * r1 * r1);
}

/** The Moon's shadow: axis through the Moon away from the Sun, and the cone angles. */
export function shadow(ms: number) {
  const { sun, moon } = sunMoon(ms);
  const sm = sub(moon, sun);
  const dist = len(sm);
  const axis = scale(sm, 1 / dist);
  // tan of the penumbral (f1) and umbral (f2) cone half-angles.
  const tf1 = Math.tan(Math.asin((R_SUN + R_MOON) / dist));
  const tf2 = Math.tan(Math.asin((R_SUN - R_MOON) / dist));
  return { sun, moon, axis, tf1, tf2 };
}
export type Shadow = ReturnType<typeof shadow>;

/** Earth flattened to a sphere of radius R_EQ by stretching z. */
const toSphere = (p: Vec): Vec => [p[0], p[1], p[2] * ZSCALE];
const fromSphere = (p: Vec): Vec => [p[0], p[1], p[2] / ZSCALE];

/** Where a line (point, direction) first meets the Earth's surface, or null. */
function hitEarth(p0: Vec, dir: Vec): Vec | null {
  const p = toSphere(p0);
  const d = norm(toSphere(dir));
  const b = dot(p, d);
  const c = dot(p, p) - R_EQ * R_EQ;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return fromSphere([p[0] + t * d[0], p[1] + t * d[1], p[2] + t * d[2]]);
}

/** Inertial km -> geodetic latitude / longitude (deg). */
export function toLatLon(p: Vec, ms: number) {
  const e2 = 2 * FLAT - FLAT * FLAT;
  const r = Math.hypot(p[0], p[1]);
  const lat = Math.atan2(p[2], r * (1 - e2));
  let lon = Math.atan2(p[1], p[0]) - gmst(ms);
  lon = ((((lon + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return { lat: lat / DEG, lon: lon / DEG };
}

/** Geodetic lat/lon/height (deg, km) -> inertial km. */
export function fromLatLon(lat: number, lon: number, altKm: number, ms: number): Vec {
  const e2 = 2 * FLAT - FLAT * FLAT;
  const la = lat * DEG;
  const lo = lon * DEG + gmst(ms);
  const N = R_EQ / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  return [(N + altKm) * Math.cos(la) * Math.cos(lo), (N + altKm) * Math.cos(la) * Math.sin(lo), (N * (1 - e2) + altKm) * Math.sin(la)];
}

/** Distance of the shadow axis from Earth's centre, in (stretched) Earth radii: Besselian γ. */
function gamma(sh: Shadow) {
  const m = toSphere(sh.moon);
  const a = norm(toSphere(sh.axis));
  const along = dot(m, a);
  return len(sub(m, scale(a, along))) / R_EQ;
}

function goldenMin(f: (t: number) => number, a: number, b: number, tol = 1000) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > tol) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/** Sun–Moon elongation in ecliptic longitude, wrapped to −180..180° (0 at new moon). */
function elongation(ms: number) {
  const d = (moonEcliptic(ms).lon - sunEcliptic(ms).lon) / DEG;
  return ((((d + 180) % 360) + 360) % 360) - 180;
}
const SYNODIC = 29.530588861 * 86400e3;

/** Times of new moon (phase 0) or full moon (phase 180) between two dates. */
export function lunations(from: number, to: number, phase: 0 | 180) {
  const out: number[] = [];
  // Reference new moon 2000-01-06 18:14 UTC.
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  let k = Math.floor((from - ref) / SYNODIC) - 1;
  for (;;) {
    let t = ref + (k + phase / 360) * SYNODIC;
    if (t > to + SYNODIC) break;
    // Newton steps on the elongation (the Moon gains ~12.19°/day).
    for (let i = 0; i < 6; i++) {
      let e = elongation(t) - phase;
      e = ((((e + 180) % 360) + 360) % 360) - 180;
      t -= (e / 12.1907) * 86400e3;
    }
    if (t >= from && t <= to) out.push(t);
    k++;
  }
  return out;
}

export type SolarKind = 'total' | 'annular' | 'hybrid' | 'partial';
export interface SolarEclipse {
  kind: 'solar';
  type: SolarKind;
  /** Greatest eclipse (ms). */
  max: number;
  gamma: number;
  /** Largest magnitude anywhere (at greatest eclipse). */
  magnitude: number;
  /** Where greatest eclipse happens. */
  at: { lat: number; lon: number };
  /** Rough start and end of the partial phases anywhere on Earth. */
  start: number;
  end: number;
}

export type LunarKind = 'total' | 'partial' | 'penumbral';
export interface LunarEclipse {
  kind: 'lunar';
  type: LunarKind;
  max: number;
  /** Umbral magnitude (negative for penumbral-only eclipses). */
  magnitude: number;
  penMagnitude: number;
  /** Where the Moon is overhead at greatest eclipse. */
  at: { lat: number; lon: number };
}
export type Eclipse = SolarEclipse | LunarEclipse;

/** Penumbral radius of the Moon's shadow (km) at a point `s` km beyond the Moon along the axis; umbra (negative = antumbra). */
export const penumbraR = (sh: Shadow, s: number) => R_MOON + s * sh.tf1;
export const umbraR = (sh: Shadow, s: number) => R_MOON - s * sh.tf2;

function solarAt(newMoon: number): SolarEclipse | null {
  const tMax = goldenMin((t) => gamma(shadow(t)), newMoon - 8 * 3600e3, newMoon + 8 * 3600e3, 2000);
  const sh = shadow(tMax);
  const g = gamma(sh);
  const sAxis = -dot(sh.moon, sh.axis); // distance from Moon to the closest point to Earth's centre
  const pen = penumbraR(sh, sAxis) / R_EQ;
  if (g > 1 + pen) return null;
  const hit = hitEarth(sh.moon, sh.axis);
  // Point of greatest eclipse: the axis's ground point, else the point on Earth nearest the axis.
  const pt = hit ?? scale(norm(sub(sh.moon, scale(sh.axis, dot(sh.moon, sh.axis)))), R_EQ);
  let type: SolarKind = 'partial';
  let magnitude: number;
  if (hit || g < 1 + Math.abs(umbraR(sh, sAxis)) / R_EQ) {
    // Central: total where the umbra reaches the ground, annular where only the antumbra does.
    const kinds = new Set<string>();
    for (let dt = -3 * 3600e3; dt <= 3 * 3600e3; dt += 10 * 60e3) {
      const s2 = shadow(tMax + dt);
      const h2 = hitEarth(s2.moon, s2.axis);
      if (!h2) continue;
      kinds.add(umbraR(s2, dot(sub(h2, s2.moon), s2.axis)) > 0 ? 'T' : 'A');
    }
    if (!kinds.size) kinds.add(umbraR(sh, sAxis) > 0 ? 'T' : 'A');
    type = kinds.size > 1 ? 'hybrid' : kinds.has('T') ? 'total' : 'annular';
    // For a central eclipse the magnitude is the ratio of the Moon's and Sun's apparent diameters.
    magnitude = obscurationAt(pt, sh.sun, sh.moon).ratio;
  } else magnitude = obscurationAt(pt, sh.sun, sh.moon).magnitude;
  // Partial phases: while the penumbra touches the Earth.
  const touching = (t: number) => {
    const s2 = shadow(t);
    return gamma(s2) < 1 + penumbraR(s2, -dot(s2.moon, s2.axis)) / R_EQ;
  };
  let start = tMax;
  while (touching(start - 10 * 60e3) && tMax - start < 5 * 3600e3) start -= 10 * 60e3;
  let end = tMax;
  while (touching(end + 10 * 60e3) && end - tMax < 5 * 3600e3) end += 10 * 60e3;
  // γ is positive when the axis passes north of Earth's centre.
  const m = toSphere(sh.moon);
  const a = norm(toSphere(sh.axis));
  const closest = sub(m, scale(a, dot(m, a)));
  return { kind: 'solar', type, max: tMax, gamma: g * (closest[2] >= 0 ? 1 : -1), magnitude, at: toLatLon(pt, tMax), start, end };
}

/** Earth's shadow on the Moon (Danjon's 1.02 enlargement for the atmosphere). */
function lunarGeometry(ms: number) {
  const { sun, moon } = sunMoon(ms);
  const anti = scale(sun, -1);
  const theta = angle(anti, moon);
  const piM = Math.asin(R_EQ / len(moon));
  const piS = Math.asin(R_EQ / len(sun));
  const sS = Math.asin(R_SUN / len(sun));
  const sM = Math.asin(R_MOON / len(moon));
  const umbra = 1.02 * (0.99834 * piM - sS + piS);
  const pen = 1.02 * (0.99834 * piM + sS + piS);
  return { theta, umbra, pen, sM, moon };
}

function lunarAt(fullMoon: number): LunarEclipse | null {
  const tMax = goldenMin((t) => lunarGeometry(t).theta, fullMoon - 8 * 3600e3, fullMoon + 8 * 3600e3, 2000);
  const g = lunarGeometry(tMax);
  if (g.theta > g.pen + g.sM) return null;
  const magnitude = (g.umbra + g.sM - g.theta) / (2 * g.sM);
  const penMagnitude = (g.pen + g.sM - g.theta) / (2 * g.sM);
  const type: LunarKind = g.theta < g.umbra - g.sM ? 'total' : g.theta < g.umbra + g.sM ? 'partial' : 'penumbral';
  return { kind: 'lunar', type, max: tMax, magnitude, penMagnitude, at: toLatLon(g.moon, tMax) };
}

/** Every solar and lunar eclipse between two dates, in time order. */
export function findEclipses(from: number, to: number): Eclipse[] {
  const out: Eclipse[] = [];
  for (const t of lunations(from - 86400e3, to, 0)) {
    // Only near a node can the shadow reach Earth: |β| of the Moon under ~1.6°.
    if (Math.abs(moonEcliptic(t).lat) > 1.7 * DEG) continue;
    const e = solarAt(t);
    if (e && e.max >= from - 6 * 3600e3 && e.max <= to) out.push(e);
  }
  for (const t of lunations(from - 86400e3, to, 180)) {
    if (Math.abs(moonEcliptic(t).lat) > 1.7 * DEG) continue;
    const e = lunarAt(t);
    if (e && e.max >= from - 6 * 3600e3 && e.max <= to) out.push(e);
  }
  return out.sort((a, b) => a.max - b.max);
}

export interface EclipsePath {
  /** Central line (lat, lon, time) for central eclipses. */
  central: [number, number, number][];
  /** Northern and southern limits of totality / annularity. */
  limits: [number, number][][];
  /** Northern and southern limits of the partial eclipse. */
  partial: [number, number][][];
}

/** The ground path of a solar eclipse, sampled every minute. */
export function solarPath(e: SolarEclipse): EclipsePath {
  const central: [number, number, number][] = [];
  const north: [number, number][] = [];
  const south: [number, number][] = [];
  const pn: [number, number][] = [];
  const ps: [number, number][] = [];
  const step = 60e3;
  for (let t = e.start; t <= e.end; t += step) {
    const sh = shadow(t);
    const ahead = shadow(t + step);
    // Perpendicular to the shadow's motion, in the plane across the axis.
    const mv = sub(ahead.moon, sh.moon);
    const across = norm(cross(sh.axis, mv));
    const hit = hitEarth(sh.moon, sh.axis);
    const sGround = hit ? dot(sub(hit, sh.moon), sh.axis) : -dot(sh.moon, sh.axis) - R_EQ;
    if (hit) {
      const ll = toLatLon(hit, t);
      central.push([ll.lat, ll.lon, t]);
    }
    const ru = Math.abs(umbraR(sh, sGround));
    const rp = penumbraR(sh, sGround);
    for (const [r, arrN, arrS] of [
      [ru, north, south],
      [rp, pn, ps],
    ] as [number, [number, number][], [number, number][]][]) {
      for (const [sign, arr] of [
        [1, arrN],
        [-1, arrS],
      ] as [number, [number, number][]][]) {
        const p = hitEarth([sh.moon[0] + across[0] * r * sign, sh.moon[1] + across[1] * r * sign, sh.moon[2] + across[2] * r * sign], sh.axis);
        if (p) {
          const ll = toLatLon(p, t);
          arr.push([ll.lat, ll.lon]);
        } else if (arr.length && (arr[arr.length - 1] as unknown) !== null) arr.push([NaN, NaN]);
      }
    }
  }
  const clean = (a: [number, number][]) => a.filter((p, i) => !(Number.isNaN(p[0]) && (i === 0 || Number.isNaN(a[i - 1][0]))));
  return { central, limits: central.length ? [clean(north), clean(south)] : [], partial: [clean(pn), clean(ps)] };
}

export interface LocalCircumstances {
  /** Largest fraction of the Sun's disc covered, and when. */
  obscuration: number;
  magnitude: number;
  max: number;
  /** First and last contact (partial phase) while the Sun is up. */
  start: number | null;
  end: number | null;
  /** Totality or annularity: start and end. */
  centralStart: number | null;
  centralEnd: number | null;
  /** Sun's elevation at maximum (deg). */
  sunEl: number;
}

/** How a solar eclipse looks from one place (null when it isn't seen there). */
export function localSolar(e: SolarEclipse, lat: number, lon: number, altKm = 0): LocalCircumstances | null {
  let best = { f: 0, m: 0, t: e.max, el: -90 };
  let start: number | null = null;
  let end: number | null = null;
  let cs: number | null = null;
  let ce: number | null = null;
  for (let t = e.start - 30 * 60e3; t <= e.end + 30 * 60e3; t += 20e3) {
    const { sun, moon } = sunMoon(t);
    const p = fromLatLon(lat, lon, altKm, t);
    const up = norm(fromLatLon(lat, lon, 1, t).map((v, i) => v - p[i]) as Vec);
    const el = Math.asin(dot(norm(sub(sun, p)), up)) / DEG;
    if (el < -0.8) continue;
    const o = obscurationAt(p, sun, moon);
    if (o.fraction > 0) {
      start ??= t;
      end = t;
      if (o.sep < Math.abs(o.rm - o.rs)) {
        cs ??= t;
        ce = t;
      }
    }
    if (o.fraction > best.f) best = { f: o.fraction, m: o.magnitude, t, el };
  }
  if (best.f <= 0) return null;
  return { obscuration: best.f, magnitude: best.m, max: best.t, start, end, centralStart: cs, centralEnd: ce, sunEl: best.el };
}

/** Is the Moon above the horizon from a place at a time (for lunar eclipses)? */
export function moonElevation(lat: number, lon: number, ms: number) {
  const { moon } = sunMoon(ms);
  const p = fromLatLon(lat, lon, 0, ms);
  const up = norm(fromLatLon(lat, lon, 1, ms).map((v, i) => v - p[i]) as Vec);
  return Math.asin(dot(norm(sub(moon, p)), up)) / DEG;
}

/** Inside the Moon's shadow? 0 outside, 1 in the penumbra, 2 in the umbra or antumbra. */
export function shadowZone(sh: Shadow, p: Vec) {
  const rel = sub(p, sh.moon);
  const s = dot(rel, sh.axis);
  if (s <= 0) return 0;
  const rho = len(sub(rel, scale(sh.axis, s)));
  if (rho > penumbraR(sh, s)) return 0;
  return rho < Math.abs(umbraR(sh, s)) ? 2 : 1;
}
