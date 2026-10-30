// Perigee and apogee of every object at every history snapshot (sharded by
// NORAD % 64), plus daily detail for a few famous objects.

export interface AltPoint {
  t: number;
  perigee: number;
  apogee: number;
}

const base = () => `${import.meta.env.BASE_URL}data/althistory/`;
let index: Promise<{ shards: number; times: number[] } | null> | null = null;
const shards = new Map<number, Promise<Map<number, [number, number, number][]> | null>>();
let detailIndex: Promise<number[]> | null = null;

const json = async <T>(url: string): Promise<T | null> => {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
};

function loadShard(i: number) {
  if (!shards.has(i))
    shards.set(
      i,
      fetch(`${base()}${String(i).padStart(2, '0')}.bin`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((buf) => {
          if (!buf) return null;
          const dv = new DataView(buf);
          if (dv.getUint32(0, true) !== 0x31544c41) return null;
          const n = dv.getUint32(4, true);
          const out = new Map<number, [number, number, number][]>();
          let o = 8;
          for (let k = 0; k < n; k++) {
            const id = dv.getUint32(o, true);
            const c = dv.getUint16(o + 4, true);
            o += 6;
            const pts: [number, number, number][] = [];
            for (let j = 0; j < c; j++, o += 6) pts.push([dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true)]);
            out.set(id, pts);
          }
          return out;
        })
        .catch(() => null),
    );
  return shards.get(i)!;
}

/** Altitude history for one object, and where it came from; null if none is published. */
export async function altitudeHistory(norad: number): Promise<{ points: AltPoint[]; daily: boolean } | null> {
  detailIndex ??= json<number[]>(`${base()}detail/index.json`).then((d) => d ?? []);
  if ((await detailIndex).includes(norad)) {
    const d = await json<{ points: [string, number, number][] }>(`${base()}detail/${norad}.json`);
    if (d?.points?.length) return { daily: true, points: d.points.map(([day, p, a]) => ({ t: Date.parse(day + 'T12:00:00Z'), perigee: p, apogee: a })) };
  }
  index ??= json(`${base()}index.json`);
  const idx = await index;
  if (!idx) return null;
  const shard = await loadShard(norad % idx.shards);
  const s = shard?.get(norad);
  if (!s?.length) return null;
  // 65535 marks "beyond the scale" (far beyond GEO): drop those points.
  return { daily: false, points: s.filter(([, , a]) => a < 65535).map(([i, p, a]) => ({ t: idx.times[i], perigee: p, apogee: a })) };
}
