// Loaders for the build-time files from scripts/more.mjs: radio transmitters,
// the aurora forecast, launch statistics, the daily digest and deployments.

const getJson = async <T>(url: string): Promise<T | null> => {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
};
const dataUrl = (f: string) => `${import.meta.env.BASE_URL}data/${f}`;

// ---------- radio ----------
export interface Transmitter {
  description: string;
  downlink: number | null;
  downlinkHigh: number | null;
  uplink: number | null;
  uplinkHigh: number | null;
  mode: string;
  baud: number | null;
  service: string;
  type: string;
  inverted: boolean;
}
export interface RadioData {
  source: string;
  sample: boolean;
  sats: Map<number, Transmitter[]>;
}
let radioP: Promise<RadioData | null> | null = null;
export function loadRadio(): Promise<RadioData | null> {
  return (radioP ??= getJson<{ source: string; sample?: boolean; available: boolean; sats: Record<string, unknown[][]> }>(dataUrl('radio.json')).then((d) => {
    if (!d?.available) return null;
    const sats = new Map<number, Transmitter[]>();
    for (const [k, list] of Object.entries(d.sats))
      sats.set(
        Number(k),
        list.map((r) => ({
          description: String(r[0]),
          downlink: (r[1] as number) ?? null,
          downlinkHigh: (r[2] as number) ?? null,
          uplink: (r[3] as number) ?? null,
          uplinkHigh: (r[4] as number) ?? null,
          mode: String(r[5] ?? ''),
          baud: (r[6] as number) ?? null,
          service: String(r[7] ?? ''),
          type: String(r[8] ?? ''),
          inverted: !!r[9],
        })),
      );
    return { source: d.source, sample: !!d.sample, sats };
  }));
}

export const fmtMHz = (hz: number, d = 3) => `${(hz / 1e6).toFixed(d)} MHz`;

// ---------- aurora ----------
export interface AuroraGrid {
  /** Probability 0–100, rows of 360 longitudes (0..359 E) from latitude −90 to 90. */
  data: Uint8Array;
  forecast: string | null;
  observed: string | null;
  live: boolean;
  sample: boolean;
}
const OVATION = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';

/** The newest OVATION forecast straight from NOAA, else the copy made at build time. */
export async function loadAurora(): Promise<AuroraGrid | null> {
  try {
    const r = await fetch(OVATION, { signal: AbortSignal.timeout(12000) });
    if (r.ok) {
      const d = await r.json();
      const coords = d?.coordinates as number[][] | undefined;
      if (Array.isArray(coords) && coords.length > 1000) {
        const data = new Uint8Array(360 * 181);
        for (const c of coords) {
          const lon = ((Math.round(c[0]) % 360) + 360) % 360;
          const lat = Math.round(c[1]);
          if (lat >= -90 && lat <= 90) data[(lat + 90) * 360 + lon] = Math.max(0, Math.min(100, Math.round(c[2])));
        }
        return { data, forecast: d['Forecast Time'] ?? null, observed: d['Observation Time'] ?? null, live: true, sample: false };
      }
    }
  } catch {
    /* offline, or NOAA unreachable: fall back */
  }
  const d = await getJson<{ available: boolean; sample?: boolean; data: string; forecast: string | null; observed: string | null }>(dataUrl('aurora.json'));
  if (!d?.available || !d.data) return null;
  const bin = atob(d.data);
  const data = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return { data, forecast: d.forecast, observed: d.observed, live: false, sample: !!d.sample };
}

/** Forecast probability (%) at a point. */
export function auroraAt(g: AuroraGrid, lat: number, lon: number) {
  const la = Math.max(-90, Math.min(90, Math.round(lat)));
  const lo = ((Math.round(lon) % 360) + 360) % 360;
  return g.data[(la + 90) * 360 + lo];
}

/**
 * Chance of seeing the aurora from a place: overhead, or low toward the pole
 * from up to ~1,000 km away (the "view line": a bright display is visible
 * about 10° of latitude equatorward of the oval).
 */
export function auroraView(g: AuroraGrid, lat: number, lon: number) {
  const overhead = auroraAt(g, lat, lon);
  const pole = lat >= 0 ? 1 : -1;
  let horizon = 0;
  for (let d = 1; d <= 10; d++) {
    const v = auroraAt(g, lat + pole * d, lon);
    // Farther away means lower in the sky and fainter.
    horizon = Math.max(horizon, v * (1 - d / 12));
  }
  return { overhead, horizon: Math.round(horizon), direction: pole > 0 ? 'north' : 'south' };
}

// ---------- launch statistics ----------
export interface LaunchStats {
  generated: string;
  sample: boolean;
  countries: Record<string, string>;
  satcat: { source: string; years: [number, number, Record<string, number>][] };
  /** [year, launches, failures, reused stages, stages, landing attempts, landings] */
  recent: {
    source: string;
    from: string;
    to: string;
    count: number;
    years: [number, number, number, number, number, number, number][];
    providers: [string, number, number, string][];
    rockets: [string, number, number, string][];
  } | null;
}
export const loadLaunchStats = () => getJson<LaunchStats & { available: boolean }>(dataUrl('launchstats.json')).then((d) => (d?.available ? d : null));

// ---------- digest ----------
/** [norad, name, cospar, type, owner] */
export type DigestObject = [number, string, string, string, string];
export interface DigestDay {
  day: string;
  added: DigestObject[];
  addedCount: number;
  reentered: DigestObject[];
  /** [norad, name, time, kind, daKm, diDeg] */
  manoeuvres: [number, string, string, string, number, number][];
  /** [cospar, parent name, new pieces] */
  breakups: [string, string, number][];
}
export interface Digest {
  generated: string;
  sample?: boolean;
  days: DigestDay[];
}
export const loadDigest = () => getJson<Digest & { available: boolean }>(dataUrl('digest.json')).then((d) => (d?.available ? d : null));

/** New objects grouped by launch, largest first. */
export function launchesIn(added: DigestObject[]) {
  const by = new Map<string, { key: string; n: number; payloads: number; names: string[]; ids: number[] }>();
  for (const a of added) {
    const key = /^\d{4}-\d{3}/.exec(a[2])?.[0];
    if (!key) continue;
    const v = by.get(key) ?? { key, n: 0, payloads: 0, names: [], ids: [] };
    v.n++;
    v.ids.push(a[0]);
    if (a[3] === 'P') v.payloads++;
    if (v.names.length < 3) v.names.push(a[1]);
    by.set(key, v);
  }
  return [...by.values()].sort((a, b) => b.n - a.n);
}

// ---------- deployments ----------
export interface DeploymentInfo {
  key: string;
  name: string;
  launch: string;
  objects: number;
  from: string;
  to: string;
  history: boolean;
}
/** Element sets: [t ms, n rev/day, e, i, raan, argp, ma, bstar] */
export type DeployEls = [number, number, number, number, number, number, number, number];
export const loadDeploymentIndex = () => getJson<{ launches: DeploymentInfo[] }>(dataUrl('deployments/index.json')).then((d) => d?.launches ?? []);
export const loadDeployment = (key: string) =>
  getJson<{ key: string; name: string; launch: string; history: boolean; objects: { norad: number; name: string; type: string; els: DeployEls[] }[] }>(dataUrl(`deployments/${key}.json`));
