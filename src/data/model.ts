import { AGE_BINS, ageBin } from '../sim/accuracy';
import type { Catalog, ObjectType, Regime, SatObject } from './catalog';
import { REGIME_LABEL, TYPE_LABEL } from './catalog';
import { OPS_STATUS, ownerName } from './codes';
import { FAMILIES, orbitFamily, type Family } from '../sim/families';

/** An object's orbit family (cached on the object). */
export const familyOf = (o: SatObject) => (o.family ??= orbitFamily(o)) as Family;

// ---------- colour ----------
// Categorical slots (dark-mode steps, validated for CVD separation).
export const SLOTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const NEUTRAL = '#7d8394';
export const STATUS_COLORS = { good: '#0ca30c', warn: '#fab219', bad: '#d03b3b', muted: '#5f6575' };
const SEQ = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];

export const TYPE_COLOR: Record<ObjectType, string> = { P: SLOTS[0], R: SLOTS[1], D: SLOTS[2], U: NEUTRAL };
export const REGIME_COLOR: Record<Regime, string> = { LEO: SLOTS[0], MEO: SLOTS[1], GEO: SLOTS[2], HEO: SLOTS[3], XGEO: SLOTS[4] };
// Fixed owner -> slot assignment (colour follows the entity, never its rank).
export const OWNER_COLOR: Record<string, string> = {
  US: SLOTS[0],
  PRC: SLOTS[1],
  CIS: SLOTS[2],
  UK: SLOTS[3],
  JPN: SLOTS[4],
  IND: SLOTS[5],
  ESA: SLOTS[6],
  FR: SLOTS[7],
};

export type ColorMode = 'type' | 'regime' | 'family' | 'owner' | 'status' | 'year' | 'age';
export const FAMILY_COLOR: Record<Family, string> = {
  sso: SLOTS[0],
  polar: SLOTS[6],
  leo: SLOTS[2],
  meo: SLOTS[3],
  gto: SLOTS[1],
  molniya: SLOTS[4],
  tundra: SLOTS[7],
  geo: SLOTS[5],
  other: NEUTRAL,
};

export const COLOR_MODES: { key: ColorMode; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'regime', label: 'Orbit' },
  { key: 'family', label: 'Family' },
  { key: 'owner', label: 'Owner' },
  { key: 'status', label: 'Status' },
  { key: 'year', label: 'Launch' },
  { key: 'age', label: 'Data age' },
];

/** Fresh (bright) to stale (dark) element sets. */
const AGE_COLORS = ['#cde2fb', '#86b6ef', '#3987e5', '#c98500', '#d95926'];

export const YEAR_MIN = 1957;
export const YEAR_MAX = new Date().getUTCFullYear();

export function yearColor(y: number | null) {
  if (!y) return NEUTRAL;
  const f = Math.min(1, Math.max(0, (y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)));
  return SEQ[Math.min(SEQ.length - 1, Math.floor(f * SEQ.length))];
}

export function statusTone(o: SatObject): keyof typeof STATUS_COLORS {
  if (o.type !== 'P') return 'muted';
  return OPS_STATUS[o.status]?.tone ?? 'muted';
}

export function colorFor(o: SatObject, mode: ColorMode): string {
  switch (mode) {
    case 'type':
      return TYPE_COLOR[o.type];
    case 'regime':
      return REGIME_COLOR[o.regime];
    case 'family':
      return FAMILY_COLOR[familyOf(o)];
    case 'owner':
      return OWNER_COLOR[o.owner] ?? NEUTRAL;
    case 'status':
      return STATUS_COLORS[statusTone(o)];
    case 'year':
      return yearColor(o.launchYear);
    case 'age':
      return AGE_COLORS[Math.max(0, ageBin(o))];
  }
}

export interface LegendItem {
  label: string;
  color: string;
  key?: string;
}

export function legendFor(mode: ColorMode): LegendItem[] {
  switch (mode) {
    case 'type':
      return (Object.keys(TYPE_LABEL) as ObjectType[]).map((k) => ({ key: k, label: TYPE_LABEL[k], color: TYPE_COLOR[k] }));
    case 'regime':
      return (Object.keys(REGIME_LABEL) as Regime[]).map((k) => ({ key: k, label: k === 'XGEO' ? 'Beyond GEO' : k, color: REGIME_COLOR[k] }));
    case 'family':
      return FAMILIES.map((f) => ({ key: f.key, label: f.label, color: FAMILY_COLOR[f.key] }));
    case 'owner':
      return [
        ...Object.entries(OWNER_COLOR).map(([k, c]) => ({ key: k, label: ownerName(k), color: c })),
        { label: 'Other', color: NEUTRAL },
      ];
    case 'status':
      return [
        { label: 'Operational', color: STATUS_COLORS.good },
        { label: 'Partial / standby', color: STATUS_COLORS.warn },
        { label: 'Non-op. / inert', color: STATUS_COLORS.muted },
      ];
    case 'age':
      return AGE_BINS.map((b, i) => ({ key: String(i), label: b.label, color: AGE_COLORS[i] }));
    case 'year':
      return [
        { label: String(YEAR_MIN), color: SEQ[0] },
        { label: '1980', color: yearColor(1980) },
        { label: '2000', color: yearColor(2000) },
        { label: '2015', color: yearColor(2015) },
        { label: String(YEAR_MAX), color: SEQ[SEQ.length - 1] },
      ];
  }
}

// ---------- filters ----------
export type StatusFilter = 'all' | 'active' | 'inactive';
/** Sky filter relative to the observer: off, above the horizon, or naked-eye visible. */
export type SkyFilter = 'off' | 'above' | 'visible';

export interface Filters {
  query: string;
  types: Set<ObjectType>;
  regimes: Set<Regime>;
  /** Orbit families (empty = all). */
  families: Set<Family>;
  owners: Set<string>; // empty = all
  groups: Set<number>; // empty = all
  status: StatusFilter;
  yearMin: number;
  yearMax: number;
  altMin: number; // perigee km
  altMax: number; // apogee km
  sky: SkyFilter;
  minEl: number; // deg
  /** Restrict to a hand-picked set of NORAD IDs (e.g. the re-entry watch list). */
  ids: Set<number> | null;
  idsLabel: string;
}

export const ALT_MIN = 100;
export const ALT_MAX = 400000;

export function defaultFilters(): Filters {
  return {
    query: '',
    types: new Set(['P', 'R', 'D', 'U']),
    regimes: new Set(['LEO', 'MEO', 'GEO', 'HEO', 'XGEO']),
    families: new Set(),
    owners: new Set(),
    groups: new Set(),
    status: 'all',
    yearMin: YEAR_MIN,
    yearMax: YEAR_MAX,
    altMin: ALT_MIN,
    altMax: ALT_MAX,
    sky: 'off',
    minEl: 10,
    ids: null,
    idsLabel: '',
  };
}

export function isDefault(f: Filters) {
  const d = defaultFilters();
  return (
    !f.query.trim() &&
    f.types.size === 4 &&
    f.regimes.size === 5 &&
    !f.families.size &&
    !f.owners.size &&
    !f.groups.size &&
    f.status === 'all' &&
    f.yearMin === d.yearMin &&
    f.yearMax === d.yearMax &&
    f.altMin === d.altMin &&
    f.altMax === d.altMax &&
    f.sky === 'off' &&
    !f.ids
  );
}

const isActive = (o: SatObject) => o.type === 'P' && ['+', 'P', 'B', 'S', 'X'].includes(o.status);

export function tokenize(q: string) {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Does o pass every filter except the excluded facet (used for facet counts)?
 * `skyOk` is the per-object result of the (time-dependent) sky filter.
 */
export function passes(o: SatObject, f: Filters, tokens: string[], except?: keyof Filters, skyOk?: Uint8Array | null) {
  if (except !== 'sky' && f.sky !== 'off' && skyOk && !skyOk[o.idx]) return false;
  if (except !== 'ids' && f.ids && !f.ids.has(o.norad)) return false;
  if (except !== 'types' && !f.types.has(o.type)) return false;
  if (except !== 'regimes' && !f.regimes.has(o.regime)) return false;
  if (except !== 'families' && f.families.size && !f.families.has(familyOf(o))) return false;
  if (except !== 'owners' && f.owners.size && !f.owners.has(o.owner)) return false;
  if (except !== 'groups' && f.groups.size && !o.groups.some((g) => f.groups.has(g))) return false;
  if (except !== 'status' && f.status !== 'all' && (f.status === 'active') !== isActive(o)) return false;
  if (except !== 'yearMin') {
    const y = o.launchYear;
    if ((f.yearMin > YEAR_MIN || f.yearMax < YEAR_MAX) && (y == null || y < f.yearMin || y > f.yearMax)) return false;
  }
  if (except !== 'altMin') {
    if (o.apogee < f.altMin || o.perigee > f.altMax) return false;
  }
  if (except !== 'query') for (const t of tokens) if (!o.search.includes(t)) return false;
  return true;
}

export function extendSearch(cat: Catalog) {
  extendSearchFor(cat.objects);
}

export function extendSearchFor(objects: SatObject[]) {
  for (const o of objects) {
    o.search += ' ' + [TYPE_LABEL[o.type], o.regime, OPS_STATUS[o.status]?.label ?? ''].join(' ').toLowerCase();
  }
}

/** Rank search hits: exact NORAD / name prefix first. */
export function rankHits(objs: SatObject[], tokens: string[]) {
  if (!tokens.length) return objs;
  const q = tokens.join(' ');
  const score = (o: SatObject) => {
    const n = o.name.toLowerCase();
    if (String(o.norad) === q || o.cospar.toLowerCase() === q) return 0;
    if (n === q) return 1;
    if (n.startsWith(q)) return 2;
    if (n.includes(q)) return 3;
    return 4;
  };
  return objs
    .map((o) => [score(o), o] as const)
    .sort((a, b) => a[0] - b[0] || (a[1].type === 'P' ? 0 : 1) - (b[1].type === 'P' ? 0 : 1) || a[1].name.localeCompare(b[1].name))
    .map((x) => x[1]);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  // sRGB -> linear for the shader (renderer outputs sRGB).
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}
