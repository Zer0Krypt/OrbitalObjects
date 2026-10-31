import type { SatObject } from '../data/catalog';

/** Orbit families: the classic orbit types satellites are put in, by purpose. */
export type Family = 'sso' | 'polar' | 'leo' | 'meo' | 'gto' | 'molniya' | 'tundra' | 'geo' | 'other';

export const FAMILIES: { key: Family; label: string; note: string }[] = [
  { key: 'sso', label: 'Sun-synchronous', note: 'Tilted just past polar so the orbit turns with the seasons: it crosses each place at the same local time. Earth-imaging and weather satellites.' },
  { key: 'polar', label: 'Polar', note: 'Near-polar low orbits that are not sun-synchronous: they see the whole Earth as it turns beneath them.' },
  { key: 'leo', label: 'Other low orbit', note: 'Low Earth orbits at other tilts: the space stations, most of Starlink, and most debris.' },
  { key: 'meo', label: 'Medium orbit', note: 'Round orbits between low orbit and geostationary: the navigation satellites (GPS, Galileo, GLONASS, BeiDou) and O3b.' },
  { key: 'gto', label: 'Geostationary transfer', note: 'Long ellipses from low orbit up to geostationary height, used to reach GEO. Mostly spent rocket stages left behind.' },
  { key: 'molniya', label: 'Molniya', note: 'Twelve-hour ellipses tilted 63.4°, hanging high over the far north for hours: Russian communications and early warning.' },
  { key: 'tundra', label: 'Tundra', note: 'Like Molniya but one day long: hangs over one region for most of each day (Sirius radio, QZSS, Russian early warning).' },
  { key: 'geo', label: 'Geosynchronous', note: 'One orbit a day, 35,786 km up: over the equator it stays put above one spot. TV, weather and communications.' },
  { key: 'other', label: 'Other', note: 'Other elliptical orbits, and orbits beyond geostationary.' },
];
export const FAMILY_LABEL = Object.fromEntries(FAMILIES.map((f) => [f.key, f.label])) as Record<Family, string>;

/** Inclination (deg) a circular orbit needs at semi-major axis `a` km to be sun-synchronous. */
export function ssoInclination(a: number) {
  const c = -((a / 12352) ** 3.5);
  return c < -1 ? NaN : (Math.acos(c) * 180) / Math.PI;
}

export function orbitFamily(o: SatObject): Family {
  const { period: P, ecc: e, incl: i, perigee, apogee } = o;
  if (P > 680 && P < 760 && e > 0.5 && Math.abs(i - 63.4) < 5) return 'molniya';
  // Tundra and quasi-zenith orbits (QZSS flies at 41°).
  if (P > 1380 && P < 1500 && e > 0.05 && e < 0.5 && i > 30 && i < 75) return 'tundra';
  if (o.regime === 'GEO') return 'geo';
  if (perigee < 2000 && apogee > 25000 && apogee < 50000 && e > 0.5) return 'gto';
  if (apogee < 2000) {
    if (e < 0.05) {
      const s = ssoInclination(o.sma);
      if (Number.isFinite(s) && Math.abs(i - s) < 1.5) return 'sso';
    }
    return i > 80 && i < 100 ? 'polar' : 'leo';
  }
  if (o.regime === 'MEO' && e < 0.2) return 'meo';
  return 'other';
}
