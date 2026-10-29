// Close approaches (CelesTrak SOCRATES) and upcoming launches (Launch Library 2),
// both fetched at build time into public/data.

export interface Conjunction {
  a: { norad: number; name: string };
  b: { norad: number; name: string };
  tca: string;
  tcaMs: number;
  rangeKm: number;
  speedKms: number | null;
  prob: number | null;
}

export interface ConjunctionData {
  generated: string;
  available: boolean;
  sample: boolean;
  items: Conjunction[];
}

export interface Launch {
  id: string;
  name: string;
  net: string;
  netMs: number;
  windowStart: string | null;
  windowEnd: string | null;
  status: string | null;
  statusName: string | null;
  provider: string | null;
  rocket: string | null;
  mission: string | null;
  missionType: string | null;
  description: string | null;
  orbit: string | null;
  pad: string | null;
  location: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  image: string | null;
  webcast: boolean;
}

export interface LaunchData {
  generated: string;
  available: boolean;
  sample: boolean;
  upcoming: Launch[];
}

async function getJson(url: string) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function loadConjunctions(url: string): Promise<ConjunctionData | null> {
  const raw = await getJson(url);
  if (!raw) return null;
  return {
    generated: raw.generated,
    available: !!raw.available,
    sample: !!raw.sample,
    items: (raw.items ?? []).map((c: Conjunction) => ({ ...c, tcaMs: Date.parse(c.tca) })).filter((c: Conjunction) => Number.isFinite(c.tcaMs)),
  };
}

export async function loadLaunches(url: string): Promise<LaunchData | null> {
  const raw = await getJson(url);
  if (!raw) return null;
  return {
    generated: raw.generated,
    available: !!raw.available,
    sample: !!raw.sample,
    upcoming: (raw.upcoming ?? []).map((l: Launch) => ({ ...l, netMs: Date.parse(l.net) })).filter((l: Launch) => Number.isFinite(l.netMs)),
  };
}

/** "1 in 4,800" style collision probability. */
export function fmtProbability(p: number | null) {
  if (p === null || !(p > 0)) return '—';
  if (p >= 0.01) return `${(p * 100).toFixed(1)}%`;
  const n = Math.round(1 / p);
  return `1 in ${n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n.toLocaleString('en-US')}`;
}
