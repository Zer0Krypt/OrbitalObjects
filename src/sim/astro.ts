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
