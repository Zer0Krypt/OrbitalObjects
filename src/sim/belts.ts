/**
 * The Van Allen radiation belts as a tilted, offset dipole: trapped
 * particles follow the field lines, so their density depends on McIlwain's
 * L (the field line's distance from the dipole centre at its equator, in
 * Earth radii) and how far from the magnetic equator the point is.
 * The inner belt (protons) peaks near L = 1.5, the outer (electrons) near
 * L = 4.5. The dipole's offset of ~500 km toward the western Pacific brings
 * the inner belt down to a few hundred km over the South Atlantic: the
 * South Atlantic Anomaly that low satellites fly through.
 */

const DEG = Math.PI / 180;
export const RE_KM = 6371;
/** Geomagnetic north pole (IGRF, mid-2020s). */
const POLE = { lat: 80.8, lon: -72.7 };
/** Eccentric-dipole centre offset (km, Earth-fixed). */
const OFFSET = { km: 520, lat: 22, lon: 142 };

const unit = (lat: number, lon: number): [number, number, number] => [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)];
/** Dipole axis and centre in Earth-fixed coordinates (x toward 0° lon, z north; km). */
export const DIPOLE_AXIS = unit(POLE.lat, POLE.lon);
export const DIPOLE_CENTRE = unit(OFFSET.lat, OFFSET.lon).map((v) => v * OFFSET.km) as [number, number, number];

/** L-shell, magnetic latitude (deg) and distance from the dipole centre (Earth radii) of an Earth-fixed point (km). */
export function lShell(x: number, y: number, z: number) {
  const rx = x - DIPOLE_CENTRE[0];
  const ry = y - DIPOLE_CENTRE[1];
  const rz = z - DIPOLE_CENTRE[2];
  const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const s = (rx * DIPOLE_AXIS[0] + ry * DIPOLE_AXIS[1] + rz * DIPOLE_AXIS[2]) / r;
  const c2 = Math.max(1e-6, 1 - s * s);
  return { L: r / RE_KM / c2, mlat: Math.asin(s) / DEG, r: r / RE_KM };
}

/**
 * Relative particle density of the inner and outer belts (0–1). Trapped
 * particles bounce between mirror points where the field gets strong, so
 * they only reach down to where it is weak enough: high up, or low over the
 * South Atlantic where the offset dipole's field is weakest.
 */
export function beltDensity(L: number, mlat: number, r: number) {
  const s = Math.sin(mlat * DEG);
  const B = Math.sqrt(1 + 3 * s * s) / (r * r * r); // field strength, in units of the equatorial surface field
  const t = Math.min(1, Math.max(0, (B - 0.7) / 0.25));
  const mirror = 1 - t * t * (3 - 2 * t);
  // The atmosphere soaks up the inner belt's lower edge, so it falls off faster below its peak.
  const inner = Math.exp(-(((L - 1.55) / (L < 1.55 ? 0.24 : 0.32)) ** 2)) * mirror;
  const outer = 0.75 * Math.exp(-(((L - 4.5) / 0.9) ** 2)) * mirror;
  return { inner, outer };
}

/** Share of an orbit (sampled positions, Earth-fixed km) spent inside each belt. */
export function beltExposure(points: [number, number, number][]) {
  let inner = 0;
  let outer = 0;
  for (const [x, y, z] of points) {
    const { L, mlat, r } = lShell(x, y, z);
    const d = beltDensity(L, mlat, r);
    if (d.inner > 0.15) inner++;
    if (d.outer > 0.2) outer++;
  }
  const n = Math.max(1, points.length);
  return { inner: inner / n, outer: outer / n };
}
