// Orbital snapshots (see scripts/snapshots.mjs for kinds and binary layout).

export interface SnapshotInfo {
  key: string;
  /** Snapshot time (ms). */
  t: number;
  kind: 'year' | 'quarter' | 'event';
  /** Carries original element sets (epoch, drag) good enough for SGP4. */
  sgp4: boolean;
}

export interface Snapshot extends SnapshotInfo {
  norad: Uint32Array;
  n: Float32Array; // rev/day
  e: Float32Array;
  i: Float32Array; // deg
  raan: Float32Array;
  argp: Float32Array;
  /** Mean anomaly (deg) at each element set's own epoch. */
  ma: Float32Array;
  /** Element epochs (ms). */
  epoch: Float64Array;
  bstar: Float32Array;
}

const MAGIC = 0x32504e53;

/** Manifest entries from history.json (older builds listed bare years). */
export function parseManifest(raw: unknown): SnapshotInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): SnapshotInfo | null =>
      typeof r === 'number'
        ? { key: String(r), t: Date.UTC(r, 0, 1), kind: 'year', sgp4: false }
        : r && typeof r === 'object' && 'key' in r
          ? { key: String(r.key), t: Number(r.t), kind: r.kind ?? 'year', sgp4: !!r.sgp4 }
          : null,
    )
    .filter((x): x is SnapshotInfo => !!x && Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
}

export function decodeSnapshot(info: SnapshotInfo, buf: ArrayBuffer): Snapshot {
  const dv = new DataView(buf);
  const v2 = dv.getUint32(0, true) === MAGIC;
  let o = v2 ? 4 : 0;
  const c = dv.getUint32(o, true);
  o += 4;
  const norad = new Uint32Array(c);
  const n = new Float32Array(c);
  for (let k = 0; k < c; k++, o += 4) norad[k] = dv.getUint32(o, true);
  for (let k = 0; k < c; k++, o += 4) n[k] = dv.getFloat32(o, true);
  const u16 = (max: number) => {
    const a = new Float32Array(c);
    for (let k = 0; k < c; k++, o += 2) a[k] = (dv.getUint16(o, true) / 65535) * max;
    return a;
  };
  const e = u16(1);
  const i = u16(180);
  const raan = u16(360);
  const argp = u16(360);
  const ma = u16(360);
  const epoch = new Float64Array(c).fill(info.t);
  const bstar = new Float32Array(c);
  if (v2) {
    for (let k = 0; k < c; k++, o += 4) epoch[k] = info.t + dv.getInt32(o, true) * 1000;
    for (let k = 0; k < c; k++, o += 4) bstar[k] = dv.getFloat32(o, true);
  }
  return { ...info, sgp4: info.sgp4 && v2, norad, n, e, i, raan, argp, ma, epoch, bstar };
}

const cache = new Map<string, Promise<Snapshot | null>>();

export function loadSnapshot(info: SnapshotInfo): Promise<Snapshot | null> {
  let p = cache.get(info.key);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/history/${info.key}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => decodeSnapshot(info, b))
      .catch(() => {
        cache.delete(info.key); // allow a retry later
        return null;
      });
    cache.set(info.key, p);
  }
  return p;
}

/**
 * The snapshot to use at time t: the latest one at or before t, unless the
 * next one is much closer; none when t is nearer "now" (today's elements win)
 * or far from any snapshot.
 */
export function pickSnapshot(list: SnapshotInfo[], t: number, now: number): SnapshotInfo | null {
  let before: SnapshotInfo | null = null;
  let after: SnapshotInfo | null = null;
  for (const s of list) {
    if (s.kind === 'event') continue;
    if (s.t <= t) before = s;
    else {
      after = s;
      break;
    }
  }
  if (!after && before && now - t < t - before.t) return null;
  const dB = before ? t - before.t : Infinity;
  const dA = after ? after.t - t : Infinity;
  const best = dA * 3 < dB ? after : before;
  const d = best === after ? dA : dB;
  // Within ~1.3 snapshot spacings (≈ 16 months for yearly, 4 for quarterly).
  if (!best || d > (best.kind === 'quarter' ? 125 : 480) * 86400e3) return null;
  return best;
}

/** An event snapshot covering t closely enough for true positions (± days). */
export function pickEventSnapshot(list: SnapshotInfo[], t: number): SnapshotInfo | null {
  let best: SnapshotInfo | null = null;
  for (const s of list) if (s.kind === 'event' && s.sgp4 && Math.abs(s.t - t) < 3 * 86400e3 && (!best || Math.abs(s.t - t) < Math.abs(best.t - t))) best = s;
  return best;
}
