import type { SatObject } from '../data/catalog';

/**
 * Rough orbital lifetime from drag, for disposal compliance: an exponential
 * atmosphere (Vallado's table, moderate solar activity) and the object's
 * ballistic coefficient from its B* (or a typical one when B* is unusable).
 * Good to a factor of two or so: solar activity alone changes lifetimes that much.
 */

// base altitude (km), density (kg/m³), scale height (km)
const ATM: [number, number, number][] = [
  [100, 5.297e-7, 5.877], [110, 9.661e-8, 7.263], [120, 2.438e-8, 9.473], [130, 8.484e-9, 12.636], [140, 3.845e-9, 16.149],
  [150, 2.07e-9, 22.523], [180, 5.464e-10, 29.74], [200, 2.789e-10, 37.105], [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628],
  [350, 9.518e-12, 53.298], [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822], [600, 1.454e-13, 71.835],
  [700, 3.614e-14, 88.667], [800, 1.17e-14, 124.64], [900, 5.245e-15, 181.05], [1000, 3.019e-15, 268],
];
export function density(h: number) {
  let k = ATM.length - 1;
  while (k > 0 && ATM[k][0] > h) k--;
  const [h0, r0, H] = ATM[k];
  return r0 * Math.exp(-(h - h0) / H);
}

const MU = 3.986004418e14;
const RE = 6378137;
const YEAR = 365.25 * 86400;
const MAX_ALT = 2000;
/** Years for a circular orbit at each whole km of altitude to decay to 120 km, for B = 1 m²/kg. */
let table: Float64Array | null = null;
function lifetimeTable() {
  if (table) return table;
  const t = new Float64Array(MAX_ALT + 1);
  let acc = 0;
  for (let h = 121; h <= MAX_ALT; h++) {
    const a = RE + (h - 0.5) * 1000;
    const rate = density(h - 0.5) * Math.sqrt(MU * a); // m/s of semi-major axis per unit B
    acc += 1000 / rate / YEAR;
    t[h] = acc;
  }
  return (table = t);
}

/** Ballistic coefficient Cd·A/m (m²/kg): from B*, or typical for the object type. */
export function ballistic(o: SatObject) {
  const b = 12.741621 * o.bstar;
  const typical = o.type === 'D' ? 0.05 : o.type === 'R' ? 0.006 : 0.012;
  // B* soaks up modelling errors; trust it only within a plausible range.
  return b > 0.0005 && b < 1 ? b : typical;
}

/** Remaining years in orbit (Infinity above ~2,000 km, where drag is negligible). */
export function lifetimeYears(o: SatObject) {
  // Elliptical orbits lose most energy near perigee.
  const h = o.perigee + 0.18 * Math.max(0, o.apogee - o.perigee);
  if (o.perigee > 1800 || h >= MAX_ALT) return Infinity;
  if (h <= 121) return 0;
  const t = lifetimeTable();
  const k = Math.floor(h);
  const v = t[k] + (t[Math.min(MAX_ALT, k + 1)] - t[k]) * (h - k);
  return v / ballistic(o);
}

export const GEO_KM = 35786;
/** Retired in the graveyard region, comfortably above the geostationary belt. */
export const inGraveyard = (o: SatObject) => o.perigee > GEO_KM + 200;
