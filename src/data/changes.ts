// Manoeuvres and breakups, detected at build time by comparing each
// catalogue with the previous one (scripts/changes.mjs).

export interface Manoeuvre {
  norad: number;
  name: string;
  /** Epoch of the element set that showed the change. */
  t: string;
  tMs: number;
  prev: string;
  daKm: number;
  diDeg: number;
  dvMs: number;
  kind: 'raise' | 'lower' | 'plane';
}

export interface ManoeuvreData {
  generated: string;
  available: boolean;
  sample: boolean;
  items: Manoeuvre[];
  /** Latest manoeuvre per object. */
  byNorad: Map<number, Manoeuvre>;
}

export interface Breakup {
  cospar: string;
  parent: { norad: number; name: string; type: string; owner: string } | null;
  before: number;
  added: number;
  total: number;
  first: string;
  firstMs: number;
  last: string;
}

export interface BreakupData {
  generated: string;
  available: boolean;
  sample: boolean;
  items: Breakup[];
}

async function getJson(url: string) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function loadManoeuvres(url: string): Promise<ManoeuvreData | null> {
  const raw = await getJson(url);
  if (!raw) return null;
  const items: Manoeuvre[] = (raw.items ?? []).map((m: Manoeuvre) => ({ ...m, tMs: Date.parse(m.t) })).filter((m: Manoeuvre) => Number.isFinite(m.tMs));
  items.sort((a, b) => b.tMs - a.tMs);
  const byNorad = new Map<number, Manoeuvre>();
  for (const m of items) if (!byNorad.has(m.norad)) byNorad.set(m.norad, m);
  return { generated: raw.generated, available: !!raw.available, sample: !!raw.sample, items, byNorad };
}

export async function loadBreakups(url: string): Promise<BreakupData | null> {
  const raw = await getJson(url);
  if (!raw) return null;
  return {
    generated: raw.generated,
    available: !!raw.available,
    sample: !!raw.sample,
    items: (raw.items ?? []).map((b: Breakup) => ({ ...b, firstMs: Date.parse(b.first) })).filter((b: Breakup) => Number.isFinite(b.firstMs)),
  };
}

export const MANOEUVRE_LABEL: Record<Manoeuvre['kind'], string> = { raise: 'Raised orbit', lower: 'Lowered orbit', plane: 'Plane change' };

/** "Raised orbit 3.2 km · ≈1.8 m/s" */
export function describeManoeuvre(m: Manoeuvre) {
  const size = m.kind === 'plane' ? `${Math.abs(m.diDeg).toFixed(m.diDeg < 0.1 ? 3 : 2)}°` : `${Math.abs(m.daKm).toFixed(Math.abs(m.daKm) < 10 ? 1 : 0)} km`;
  return `${MANOEUVRE_LABEL[m.kind]} ${size} · ≈${m.dvMs < 10 ? m.dvMs.toFixed(1) : Math.round(m.dvMs)} m/s`;
}
