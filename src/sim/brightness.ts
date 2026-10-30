import type { SatObject } from '../data/catalog';

/**
 * Visual brightness of satellites.
 *
 * A "standard magnitude" is how bright an object would look 1000 km away and
 * half lit (phase angle 90°). Published values (Mike McCants' qs.mag, fed in by
 * the data pipeline) are used where available; otherwise one is estimated from
 * the radar cross-section, which is cruder.
 */

export interface MagnitudeData {
  source: string;
  /** NORAD -> standard magnitude. */
  mags: Map<number, number>;
}

/** A few well-known objects, in case the published list is unavailable. */
const KNOWN: Record<number, number> = {
  25544: -1.8, // ISS
  20580: 2.2, // Hubble
  48274: -0.5, // Tiangong
};

/** Rough standard magnitude from radar cross-section (m²) for a diffuse body, albedo ~0.17. */
const fromRcs = (rcs: number) => 8.1 - 2.5 * Math.log10(Math.max(rcs, 0.001));
const BY_TYPE: Record<SatObject['type'], number> = { P: 6.5, R: 5.0, D: 9.0, U: 8.0 };

export function standardMagnitude(o: SatObject, data: MagnitudeData | null): { mag: number; estimated: boolean } {
  const pub = data?.mags.get(o.norad) ?? KNOWN[o.norad];
  if (pub !== undefined) return { mag: pub, estimated: false };
  if (/^STARLINK/.test(o.name)) return { mag: 5.0, estimated: true };
  if (o.rcs !== null && o.rcs > 0) return { mag: fromRcs(o.rcs), estimated: true };
  return { mag: BY_TYPE[o.type], estimated: true };
}

/**
 * Apparent magnitude for range (km), phase angle (rad, Sun–object–observer)
 * and elevation (deg), using a diffuse-sphere phase law and 0.2 mag per
 * airmass of atmospheric extinction.
 */
export function apparentMagnitude(std: number, rangeKm: number, phase: number, elDeg: number) {
  const f = Math.sin(phase) + (Math.PI - phase) * Math.cos(phase);
  if (!(f > 1e-4)) return 99;
  const airmass = 1 / Math.sin((Math.max(elDeg, 3) * Math.PI) / 180);
  return std + 5 * Math.log10(rangeKm / 1000) - 2.5 * Math.log10(f) + 0.2 * airmass;
}

/** Phase angle (rad) at an object: angle between the directions to the Sun and to the observer. */
export function phaseAngle(obj: [number, number, number], observer: [number, number, number], sunDir: [number, number, number]) {
  const ox = observer[0] - obj[0];
  const oy = observer[1] - obj[1];
  const oz = observer[2] - obj[2];
  const l = Math.hypot(ox, oy, oz) || 1;
  const c = (ox * sunDir[0] + oy * sunDir[1] + oz * sunDir[2]) / l;
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** How dark the observer's sky is: sets the faintest magnitude counted as visible. */
export type SkyQuality = 'city' | 'suburb' | 'rural' | 'dark';
export const SKY_QUALITY: Record<SkyQuality, { label: string; mag: number; note: string }> = {
  city: { label: 'City', mag: 3.5, note: 'Bright city centre: only the brightest stars' },
  suburb: { label: 'Suburbs', mag: 4.5, note: 'Suburban sky: the main constellation stars' },
  rural: { label: 'Rural', mag: 5.3, note: 'Countryside: the Milky Way is visible' },
  dark: { label: 'Dark site', mag: 6.0, note: 'Far from any lights: thousands of stars' },
};
const SQ_KEY = 'oo:skyQuality';
function loadQuality(): SkyQuality {
  try {
    const v = localStorage.getItem(SQ_KEY) as SkyQuality | null;
    return v && v in SKY_QUALITY ? v : 'suburb';
  } catch {
    return 'suburb';
  }
}
export let skyQuality: SkyQuality = loadQuality();

/**
 * Faintest magnitude counted as "visible to the eye". A live binding: it
 * follows the sky-quality setting (a moving satellite is a little harder to
 * spot than a star of the same brightness, hence these limits).
 */
export let NAKED_EYE_MAG = SKY_QUALITY[skyQuality].mag;

export function setSkyQuality(q: SkyQuality) {
  skyQuality = q;
  NAKED_EYE_MAG = SKY_QUALITY[q].mag;
  try {
    localStorage.setItem(SQ_KEY, q);
  } catch {
    /* private mode */
  }
}

export const fmtMag = (m: number) => (m >= 50 ? '—' : `${m < 0 ? '−' : ''}${Math.abs(m).toFixed(1)}`);

export function describeMag(m: number) {
  if (m >= 50) return 'not lit';
  if (m < -1) return 'very bright';
  if (m < 1.5) return 'bright';
  if (m < 3) return 'easy to see';
  if (m < NAKED_EYE_MAG) return 'faint';
  if (m < 6) return 'dark skies only';
  return 'binoculars';
}

export async function loadMagnitudes(url: string): Promise<MagnitudeData | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = (await res.json()) as { source: string; mags: [number, number][] };
    return { source: d.source, mags: new Map(d.mags) };
  } catch {
    return null;
  }
}
