// Yearly orbital snapshots for the history replay.
//
// A snapshot holds, for every object with an element set near 1 January of a
// year, its mean elements with the mean anomaly advanced to that date. They
// are written as compact little-endian binaries, public/data/history/<year>.bin:
//
//   uint32 count
//   uint32 norad[count]
//   float32 meanMotion[count]   rev/day
//   uint16 ecc[count]           e * 65535
//   uint16 incl[count]          deg / 180 * 65535
//   uint16 raan[count]          deg / 360 * 65535
//   uint16 argp[count]          deg / 360 * 65535
//   uint16 ma[count]            deg / 360 * 65535 (at 1 January 00:00 UTC)

import fs from 'node:fs/promises';
import path from 'node:path';

export const SNAPSHOT_FIRST_YEAR = 1959;

const q16 = (v, max) => Math.max(0, Math.min(65535, Math.round((v / max) * 65535)));
const wrap = (deg) => ((deg % 360) + 360) % 360;

/** snap = { norad: [], n: [], e: [], i: [], raan: [], argp: [], ma: [] } */
export function encodeSnapshot(snap) {
  const c = snap.norad.length;
  const buf = new ArrayBuffer(4 + c * 4 + c * 4 + c * 2 * 5);
  const dv = new DataView(buf);
  dv.setUint32(0, c, true);
  let o = 4;
  for (let k = 0; k < c; k++, o += 4) dv.setUint32(o, snap.norad[k], true);
  for (let k = 0; k < c; k++, o += 4) dv.setFloat32(o, snap.n[k], true);
  const u16 = (arr, max, w) => {
    for (let k = 0; k < c; k++, o += 2) dv.setUint16(o, q16(w ? wrap(arr[k]) : arr[k], max), true);
  };
  u16(snap.e, 1, false);
  u16(snap.i, 180, false);
  u16(snap.raan, 360, true);
  u16(snap.argp, 360, true);
  u16(snap.ma, 360, true);
  return Buffer.from(buf);
}

export async function writeSnapshot(outDir, year, snap) {
  const dir = path.join(outDir, 'history');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${year}.bin`), encodeSnapshot(snap));
}

/**
 * From many element sets (any epochs near 1 January), keep the one closest to
 * that date per object and advance its mean anomaly to the date.
 * rows: [{ NORAD_CAT_ID, EPOCH, MEAN_MOTION, ECCENTRICITY, INCLINATION, RA_OF_ASC_NODE, ARG_OF_PERICENTER, MEAN_ANOMALY }]
 */
export function buildSnapshot(rows, year) {
  const D = Date.UTC(year, 0, 1);
  const best = new Map();
  for (const r of rows) {
    const id = Number(r.NORAD_CAT_ID);
    const t = Date.parse(String(r.EPOCH).replace(' ', 'T') + (/[zZ]$/.test(String(r.EPOCH)) ? '' : 'Z'));
    const n = Number(r.MEAN_MOTION);
    const e = Number(r.ECCENTRICITY);
    if (!id || !Number.isFinite(t) || !(n > 0) || !(e >= 0 && e < 0.99)) continue;
    const d = Math.abs(t - D);
    const prev = best.get(id);
    if (!prev || d < prev.d) best.set(id, { d, t, r, n, e });
  }
  const snap = { norad: [], n: [], e: [], i: [], raan: [], argp: [], ma: [] };
  for (const [id, { t, r, n, e }] of [...best.entries()].sort((a, b) => a[0] - b[0])) {
    snap.norad.push(id);
    snap.n.push(Number(n.toFixed(8)));
    snap.e.push(e);
    snap.i.push(Number(r.INCLINATION));
    snap.raan.push(Number(r.RA_OF_ASC_NODE));
    snap.argp.push(Number(r.ARG_OF_PERICENTER));
    // Mean anomaly advanced (two-body) from the element epoch to 1 January.
    snap.ma.push(wrap(Number(r.MEAN_ANOMALY) + 360 * n * ((D - t) / 86400e3)));
  }
  return snap;
}
