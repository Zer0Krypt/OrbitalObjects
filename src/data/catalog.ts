import { ownerName } from './codes';

export type ObjectType = 'P' | 'R' | 'D' | 'U';
export type Regime = 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'XGEO';

export const TYPE_LABEL: Record<ObjectType, string> = {
  P: 'Payload',
  R: 'Rocket body',
  D: 'Debris',
  U: 'Unknown',
};

export const REGIME_LABEL: Record<Regime, string> = {
  LEO: 'Low Earth orbit',
  MEO: 'Medium Earth orbit',
  GEO: 'Geosynchronous',
  HEO: 'Highly elliptical',
  XGEO: 'Beyond GEO',
};

export interface Group {
  key: string;
  label: string;
  category: string;
}

export interface SatObject {
  idx: number;
  norad: number;
  name: string;
  cospar: string;
  epoch: string;
  epochMs: number;
  meanMotion: number; // rev/day
  ecc: number;
  incl: number; // deg
  raan: number;
  argp: number;
  ma: number;
  bstar: number;
  ndot: number;
  nddot: number;
  revs: number;
  elset: number;
  type: ObjectType;
  owner: string;
  launch: string;
  site: string;
  status: string;
  rcs: number | null;
  groups: number[];
  // derived
  sma: number; // km
  perigee: number; // km altitude
  apogee: number; // km altitude
  period: number; // minutes
  regime: Regime;
  launchYear: number | null;
  search: string;
  /** Re-entry date (YYYY-MM-DD) for objects no longer in orbit. */
  decay?: string;
  /** Orbit reconstructed from SATCAT summary values; orientation unknown. */
  approx?: boolean;
}

export interface Catalog {
  generated: string;
  source: string;
  sample: boolean;
  groups: Group[];
  objects: SatObject[];
  byNorad: Map<number, SatObject>;
}

export const MU = 398600.4418; // km^3/s^2
export const RE = 6378.137; // km, equatorial

export function classify(perigee: number, apogee: number, ecc: number, period: number, incl: number): Regime {
  if (ecc > 0.25 && apogee > 2000) return 'HEO';
  if (period > 1300 && period < 1600 && ecc < 0.1 && incl < 30) return 'GEO';
  if (apogee < 2000) return 'LEO';
  if (apogee < 35000) return 'MEO';
  if (perigee > 37000) return 'XGEO';
  return period > 1300 && period < 1600 ? 'GEO' : 'XGEO';
}

function parseEpoch(s: string) {
  // CelesTrak epochs are UTC without a zone designator.
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
}

export async function loadCatalog(url: string, onProgress?: (frac: number) => void): Promise<Catalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load catalog (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  let text: string;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(1, got / total));
    }
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) {
      buf.set(c, o);
      o += c.length;
    }
    text = new TextDecoder().decode(buf);
  } else {
    text = await res.text();
  }
  const raw = JSON.parse(text);
  const f: Record<string, number> = Object.fromEntries((raw.fields as string[]).map((k, i) => [k, i]));
  const groups: Group[] = raw.groups;
  const objects: SatObject[] = [];
  for (const r of raw.objects as unknown[][]) {
    const n = Number(r[f.meanMotion]);
    const ecc = Number(r[f.ecc]);
    if (!(n > 0) || !(ecc >= 0 && ecc < 1)) continue;
    const period = 1440 / n;
    const sma = Math.cbrt(MU * ((period * 60) / (2 * Math.PI)) ** 2);
    const perigee = sma * (1 - ecc) - RE;
    const apogee = sma * (1 + ecc) - RE;
    const incl = Number(r[f.incl]);
    const launch = String(r[f.launch] ?? '');
    const type = (r[f.type] as ObjectType) || 'U';
    const owner = String(r[f.owner] || 'UNK');
    const objGroups = (r[f.groups] as number[]) ?? [];
    const o: SatObject = {
      idx: objects.length,
      norad: Number(r[f.norad]),
      name: String(r[f.name]),
      cospar: String(r[f.cospar] ?? ''),
      epoch: String(r[f.epoch]),
      epochMs: parseEpoch(String(r[f.epoch])),
      meanMotion: n,
      ecc,
      incl,
      raan: Number(r[f.raan]),
      argp: Number(r[f.argp]),
      ma: Number(r[f.ma]),
      bstar: Number(r[f.bstar]) || 0,
      ndot: Number(r[f.ndot]) || 0,
      nddot: Number(r[f.nddot]) || 0,
      revs: Number(r[f.revs]) || 0,
      elset: Number(r[f.elset]) || 0,
      type,
      owner,
      launch,
      site: String(r[f.site] ?? ''),
      status: String(r[f.status] ?? ''),
      rcs: r[f.rcs] == null ? null : Number(r[f.rcs]),
      groups: objGroups,
      sma,
      perigee,
      apogee,
      period,
      regime: classify(perigee, apogee, ecc, period, incl),
      launchYear: launch ? Number(launch.slice(0, 4)) : null,
      search: '',
    };
    o.search = [
      o.name,
      o.norad,
      o.cospar,
      owner,
      ownerName(owner),
      ...objGroups.map((g) => groups[g]?.label ?? ''),
    ]
      .join(' ')
      .toLowerCase();
    objects.push(o);
  }
  return {
    generated: raw.generated,
    source: raw.source,
    sample: !!raw.sample,
    groups,
    objects,
    byNorad: new Map(objects.map((o) => [o.norad, o])),
  };
}

export interface HistoryData {
  objects: SatObject[];
  approx: number;
  sample: boolean;
  /** Snapshot manifest (parsed by data/snapshots.ts). */
  snapshots: unknown;
}

/**
 * Re-entered objects (history.json). They are appended to the catalogue so
 * filters, search and the info panel treat them like any other object, but
 * they are drawn by a separate Keplerian layer only in history mode.
 */
export async function loadHistory(url: string, cat: Catalog): Promise<HistoryData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`history ${res.status}`);
  const raw = await res.json();
  const f: Record<string, number> = Object.fromEntries((raw.fields as string[]).map((k, i) => [k, i]));
  const added: SatObject[] = [];
  let approx = 0;
  for (const r of raw.objects as unknown[][]) {
    const norad = Number(r[f.norad]);
    if (cat.byNorad.has(norad)) continue;
    const n = Number(r[f.meanMotion]);
    const ecc = Number(r[f.ecc]);
    if (!(n > 0) || !(ecc >= 0 && ecc < 1)) continue;
    const period = 1440 / n;
    const sma = Math.cbrt(MU * ((period * 60) / (2 * Math.PI)) ** 2);
    const perigee = sma * (1 - ecc) - RE;
    const apogee = sma * (1 + ecc) - RE;
    const incl = Number(r[f.incl]);
    const launch = String(r[f.launch] ?? '');
    const owner = String(r[f.owner] || 'UNK');
    const isApprox = !!r[f.approx];
    if (isApprox) approx++;
    const o: SatObject = {
      idx: cat.objects.length,
      norad,
      name: String(r[f.name]),
      cospar: String(r[f.cospar] ?? ''),
      epoch: String(r[f.epoch] ?? ''),
      epochMs: parseEpoch(String(r[f.epoch] ?? launch)),
      meanMotion: n,
      ecc,
      incl,
      raan: Number(r[f.raan]),
      argp: Number(r[f.argp]),
      ma: Number(r[f.ma]),
      bstar: 0,
      ndot: 0,
      nddot: 0,
      revs: 0,
      elset: 0,
      type: (r[f.type] as ObjectType) || 'U',
      owner,
      launch,
      site: String(r[f.site] ?? ''),
      status: 'D',
      rcs: r[f.rcs] == null ? null : Number(r[f.rcs]),
      groups: [],
      sma,
      perigee,
      apogee,
      period,
      regime: classify(perigee, apogee, ecc, period, incl),
      launchYear: launch ? Number(launch.slice(0, 4)) : null,
      search: '',
      decay: String(r[f.decay]),
      approx: isApprox,
    };
    o.search = [o.name, o.norad, o.cospar, owner, ownerName(owner), 're-entered decayed'].join(' ').toLowerCase();
    cat.objects.push(o);
    cat.byNorad.set(norad, o);
    added.push(o);
  }
  return { objects: added, approx, sample: !!raw.sample, snapshots: raw.snapshots ?? [] };
}

/** OMM object for satellite.js json2satrec. */
export function toOMM(o: SatObject) {
  return {
    OBJECT_NAME: o.name,
    OBJECT_ID: o.cospar,
    EPOCH: o.epoch,
    MEAN_MOTION: o.meanMotion,
    ECCENTRICITY: o.ecc,
    INCLINATION: o.incl,
    RA_OF_ASC_NODE: o.raan,
    ARG_OF_PERICENTER: o.argp,
    MEAN_ANOMALY: o.ma,
    EPHEMERIS_TYPE: 0 as const,
    CLASSIFICATION_TYPE: 'U' as const,
    NORAD_CAT_ID: o.norad,
    ELEMENT_SET_NO: o.elset,
    REV_AT_EPOCH: o.revs,
    BSTAR: o.bstar,
    MEAN_MOTION_DOT: o.ndot,
    MEAN_MOTION_DDOT: o.nddot,
  };
}
