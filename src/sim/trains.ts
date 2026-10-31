import type { SatObject } from '../data/catalog';

/**
 * Starlink "trains": a batch released days ago is still bunched in a line,
 * bright and low before raising its orbit. Found by grouping recent launches
 * whose satellites are still close together along the same orbit.
 */
export interface Train {
  key: string;
  launch: string;
  objects: SatObject[];
  /** The one in the middle of the line. */
  centre: SatObject;
  /** Length of the line along the orbit (km). */
  lengthKm: number;
  altKm: number;
  ageDays: number;
}

const DAY = 86400e3;

/** Mean argument of latitude (deg) of an object at time t. */
export function argLat(o: SatObject, t: number) {
  const u = o.argp + o.ma + (360 * o.meanMotion * (t - o.epochMs)) / DAY;
  return ((u % 360) + 360) % 360;
}

export function findTrains(objects: SatObject[], starlinkGroup: number, now: number): Train[] {
  const by = new Map<string, SatObject[]>();
  for (const o of objects) {
    if (o.type !== 'P' || o.decay || !o.launch) continue;
    const age = (now - Date.parse(o.launch + 'T00:00:00Z')) / DAY;
    if (!(age >= 0 && age < 60)) continue;
    if (!(o.groups.includes(starlinkGroup) || /^STARLINK/i.test(o.name))) continue;
    if ((o.perigee + o.apogee) / 2 > 480) continue;
    const key = o.cospar.slice(0, 8);
    if (!/^\d{4}-\d{3}$/.test(key)) continue;
    (by.get(key) ?? by.set(key, []).get(key)!).push(o);
  }
  const out: Train[] = [];
  for (const [key, list] of by) {
    if (list.length < 8) continue;
    const us = list.map((o) => ({ o, u: argLat(o, now) })).sort((a, b) => a.u - b.u);
    // The line is the complement of the largest gap around the orbit.
    let gap = 0;
    let gi = 0;
    for (let k = 0; k < us.length; k++) {
      const g = (us[(k + 1) % us.length].u - us[k].u + 360) % 360 || (us.length === 1 ? 360 : 0);
      if (g > gap) {
        gap = g;
        gi = k;
      }
    }
    const spread = 360 - gap;
    if (spread > 40) continue;
    const ordered = [...us.slice(gi + 1), ...us.slice(0, gi + 1)].map((x) => x.o);
    const alt = list.reduce((s, o) => s + (o.perigee + o.apogee) / 2, 0) / list.length;
    out.push({
      key,
      launch: list[0].launch,
      objects: ordered,
      centre: ordered[Math.floor(ordered.length / 2)],
      lengthKm: (spread / 360) * 2 * Math.PI * (6371 + alt),
      altKm: alt,
      ageDays: (now - Date.parse(list[0].launch + 'T00:00:00Z')) / DAY,
    });
  }
  return out.sort((a, b) => a.ageDays - b.ageDays);
}
