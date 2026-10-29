// Yearly orbital snapshots (see scripts/snapshots.mjs for the binary layout).

export interface Snapshot {
  year: number;
  /** 1 January 00:00 UTC of `year` — the epoch of every element below. */
  date: number;
  norad: Uint32Array;
  n: Float32Array; // rev/day
  e: Float32Array;
  i: Float32Array; // deg
  raan: Float32Array;
  argp: Float32Array;
  ma: Float32Array;
}

export function decodeSnapshot(year: number, buf: ArrayBuffer): Snapshot {
  const dv = new DataView(buf);
  const c = dv.getUint32(0, true);
  const norad = new Uint32Array(c);
  const n = new Float32Array(c);
  let o = 4;
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
  return { year, date: Date.UTC(year, 0, 1), norad, n, e, i, raan, argp, ma };
}

const cache = new Map<number, Promise<Snapshot | null>>();

export function loadSnapshot(year: number): Promise<Snapshot | null> {
  let p = cache.get(year);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/history/${year}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => decodeSnapshot(year, b))
      .catch(() => {
        cache.delete(year); // allow a retry later
        return null;
      });
    cache.set(year, p);
  }
  return p;
}
