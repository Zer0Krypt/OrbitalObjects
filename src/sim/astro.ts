import { gstime } from 'satellite.js';
import * as THREE from 'three';

export const EARTH_RADIUS_KM = 6371.0;
/** Scene units are Earth radii. */
export const KM = 1 / EARTH_RADIUS_KM;
const DEG = Math.PI / 180;

export const toJd = (ms: number) => ms / 86400000 + 2440587.5;

/** Greenwich mean sidereal time (rad). */
export const gmst = (ms: number) => gstime(new Date(ms));

/**
 * Scene frame: Y is the celestial north pole, X the vernal equinox, so the
 * inertial (TEME/ECI) vector (x, y, z) maps to (x, z, -y).
 */
export function eciToScene(x: number, y: number, z: number, out = new THREE.Vector3()) {
  return out.set(x * KM, z * KM, -y * KM);
}

/** Unit vector toward the Sun in the inertial frame (low-precision, ~0.01°). */
export function sunDirectionEci(ms: number): [number, number, number] {
  const n = toJd(ms) - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return [Math.cos(lambda), Math.cos(eps) * Math.sin(lambda), Math.sin(eps) * Math.sin(lambda)];
}

/** ECI km -> geodetic lat/lon (deg) and altitude (km), WGS-84. */
export function eciToGeodetic(x: number, y: number, z: number, gmstRad: number) {
  const a = 6378.137;
  const f = 1 / 298.26;
  const e2 = 2 * f - f * f;
  const R = Math.sqrt(x * x + y * y);
  let lon = Math.atan2(y, x) - gmstRad;
  lon = ((((lon + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  let lat = Math.atan2(z, R);
  let C = 1;
  for (let k = 0; k < 20; k++) {
    C = 1 / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z + a * C * e2 * Math.sin(lat), R);
  }
  const alt = R / Math.cos(lat) - a * C;
  return { lat: lat / DEG, lon: lon / DEG, alt };
}

/** Is an ECI point inside Earth's cylindrical shadow? Good enough for a lit/eclipse badge. */
export function inEclipse(x: number, y: number, z: number, sun: [number, number, number]) {
  const d = x * sun[0] + y * sun[1] + z * sun[2];
  if (d > 0) return false;
  const px = x - d * sun[0];
  const py = y - d * sun[1];
  const pz = z - d * sun[2];
  return Math.sqrt(px * px + py * py + pz * pz) < 6378.137;
}

/** Lat/lon (deg) on a sphere of radius r in the Earth-fixed scene frame (before GMST rotation). */
export function latLonToScene(lat: number, lon: number, r = 1, out = new THREE.Vector3()) {
  const la = lat * DEG;
  const lo = lon * DEG;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

const MOON_TERMS = (T: number) => {
  const s = (a: number, b: number) => Math.sin((a + b * T) * DEG);
  const c = (a: number, b: number) => Math.cos((a + b * T) * DEG);
  const lon =
    218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) + 0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03);
  const lat = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
  const par = 0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74);
  return { lon: lon * DEG, lat: lat * DEG, par: par * DEG };
};

export const MOON_RADIUS_KM = 1737.4;

/**
 * Geocentric Moon position (inertial frame, km). Low-precision series from
 * the Astronomical Almanac: about 0.3° in direction and 0.2 Earth radii in distance.
 */
export function moonPositionEci(ms: number): [number, number, number] {
  const T = (toJd(ms) - 2451545.0) / 36525;
  const { lon, lat, par } = MOON_TERMS(T);
  const r = 6378.14 / Math.sin(par);
  const eps = (23.439 - 0.013 * T) * DEG;
  const xe = r * Math.cos(lat) * Math.cos(lon);
  const ye = r * Math.cos(lat) * Math.sin(lon);
  const ze = r * Math.sin(lat);
  return [xe, ye * Math.cos(eps) - ze * Math.sin(eps), ye * Math.sin(eps) + ze * Math.cos(eps)];
}

/** Moon phase: illuminated fraction (0..1), and whether it's waxing. */
export function moonPhase(ms: number) {
  const m = moonPositionEci(ms);
  const s = sunDirectionEci(ms);
  const r = Math.hypot(m[0], m[1], m[2]);
  // Elongation from the Sun; the phase angle is nearly its supplement.
  const cosE = (m[0] * s[0] + m[1] * s[1] + m[2] * s[2]) / r;
  const illum = (1 - cosE) / 2;
  const later = moonPositionEci(ms + 3600e3);
  const cosE2 = (later[0] * s[0] + later[1] * s[1] + later[2] * s[2]) / Math.hypot(later[0], later[1], later[2]);
  const waxing = cosE2 < cosE;
  const name =
    illum < 0.03 ? 'New moon' : illum > 0.97 ? 'Full moon' : illum < 0.47 ? (waxing ? 'Waxing crescent' : 'Waning crescent') : illum <= 0.53 ? (waxing ? 'First quarter' : 'Last quarter') : waxing ? 'Waxing gibbous' : 'Waning gibbous';
  return { illum, waxing, name, distanceKm: r };
}

/** Right ascension / declination (deg) to a unit vector in the scene frame. */
export function raDecToScene(raDeg: number, decDeg: number, r = 1, out = new THREE.Vector3()) {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  return eciToScene(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d), out).multiplyScalar(r / KM);
}
