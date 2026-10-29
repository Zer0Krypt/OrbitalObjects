// Orbital snapshots for the history replay.
//
// A snapshot holds, for every object with an element set near a date, the
// element set nearest that date. Three kinds:
//   year     1 January, 1959 until ten years ago
//   quarter  1 Jan / Apr / Jul / Oct for the last ten years
//   event    the viewing moment of each timeline event (src/data/events.json)
//
// Binary layout (little-endian), public/data/history/<key>.bin:
//   uint32 magic 'SNP2' (0x32504e53)   (v1 files start directly with the count)
//   uint32 count
//   uint32 norad[count]
//   float32 meanMotion[count]   rev/day
//   uint16 ecc[count]           e * 65535
//   uint16 incl[count]          deg / 180 * 65535
//   uint16 raan[count]          deg / 360 * 65535
//   uint16 argp[count]          deg / 360 * 65535
//   uint16 ma[count]            deg / 360 * 65535, at the element set's own epoch
//   int32 epochOffset[count]    seconds from the snapshot time to the element epoch
//   float32 bstar[count]        SGP4 drag term (1/earth radii)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SNAPSHOT_FIRST_YEAR = 1959;
export const QUARTERLY_YEARS = 10;
export const MAGIC = 0x32504e53;
const DAY = 86400e3;

const q16 = (v, max) => Math.max(0, Math.min(65535, Math.round((v / max) * 65535)));
const wrap = (deg) => ((deg % 360) + 360) % 360;

/** When an event is viewed (mirrors eventView() in src/data/events.ts). */
export function eventViewTime(e) {
  const t = Date.parse(e.at);
  if (e.kind === 'reentry') return t - DAY;
  if (e.pair) return t - 5 * 60e3;
  if (e.kind === 'debris') return t + 2 * 3600e3;
  return t + 2 * DAY;
}

const compact = (ms) => new Date(ms).toISOString().slice(0, 16).replace(/[-:]/g, '');

export async function loadEvents() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return JSON.parse(await fs.readFile(path.join(root, 'src', 'data', 'events.json'), 'utf8'));
}

/**
 * Every snapshot the site wants, in fetch-priority order (events first, then
 * the most recent quarters, then years). `windowDays` is how far either side
 * of the date element sets are searched.
 */
export function snapshotPlan(now, events) {
  const plan = [];
  const thisYear = new Date(now).getUTCFullYear();
  const settled = (t) => t + 21 * DAY < now; // elements after the date must exist
  for (const e of events) {
    const t = eventViewTime(e);
    if (settled(t)) plan.push({ key: `e${compact(t)}`, t, kind: 'event', windowDays: t < Date.UTC(1980, 0, 1) ? 15 : 3 });
  }
  const quarters = [];
  for (let y = thisYear - QUARTERLY_YEARS; y <= thisYear; y++)
    for (const m of [0, 3, 6, 9]) {
      const t = Date.UTC(y, m, 1);
      if (settled(t)) quarters.push({ key: `${y}-${String(m + 1).padStart(2, '0')}`, t, kind: 'quarter', windowDays: 2 });
    }
  plan.push(...quarters.reverse());
  for (let y = SNAPSHOT_FIRST_YEAR; y < thisYear - QUARTERLY_YEARS; y++) {
    const t = Date.UTC(y, 0, 1);
    plan.push({ key: String(y), t, kind: 'year', windowDays: y < 1980 ? 20 : y < 2005 ? 7 : 2 });
  }
  return plan;
}

/** snap = { v: 2, norad, n, e, i, raan, argp, ma, epochOff, bstar } (arrays) */
export function encodeSnapshot(snap) {
  const c = snap.norad.length;
  const buf = new ArrayBuffer(8 + c * (4 + 4 + 2 * 5 + 4 + 4));
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, c, true);
  let o = 8;
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
  for (let k = 0; k < c; k++, o += 4) dv.setInt32(o, snap.epochOff[k], true);
  for (let k = 0; k < c; k++, o += 4) dv.setFloat32(o, snap.bstar[k], true);
  return Buffer.from(buf);
}

/** Upgrade a v1 cached snapshot (mean anomaly advanced to the date, no drag term). */
export function upgradeV1(snap) {
  return { v: 2, ...snap, epochOff: snap.norad.map(() => 0), bstar: snap.norad.map(() => 0), sgp4: false };
}

export async function writeSnapshot(outDir, key, snap) {
  const dir = path.join(outDir, 'history');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${key}.bin`), encodeSnapshot(snap.v === 2 ? snap : upgradeV1(snap)));
}

const parseEpoch = (s) => Date.parse(String(s).replace(' ', 'T') + (/[zZ]$/.test(String(s)) ? '' : 'Z'));

/**
 * From many element sets near the date `D` (ms), keep the one closest to it
 * per object. rows: [{ NORAD_CAT_ID, EPOCH, MEAN_MOTION, ECCENTRICITY,
 * INCLINATION, RA_OF_ASC_NODE, ARG_OF_PERICENTER, MEAN_ANOMALY, BSTAR }]
 */
export function buildSnapshot(rows, D) {
  const best = new Map();
  for (const r of rows) {
    const id = Number(r.NORAD_CAT_ID);
    const t = parseEpoch(r.EPOCH);
    const n = Number(r.MEAN_MOTION);
    const e = Number(r.ECCENTRICITY);
    if (!id || !Number.isFinite(t) || !(n > 0) || !(e >= 0 && e < 0.99)) continue;
    const d = Math.abs(t - D);
    const prev = best.get(id);
    if (!prev || d < prev.d) best.set(id, { d, t, r, n, e });
  }
  const snap = { v: 2, sgp4: true, norad: [], n: [], e: [], i: [], raan: [], argp: [], ma: [], epochOff: [], bstar: [] };
  for (const [id, { t, r, n, e }] of [...best.entries()].sort((a, b) => a[0] - b[0])) {
    snap.norad.push(id);
    snap.n.push(Number(n.toFixed(8)));
    snap.e.push(e);
    snap.i.push(Number(r.INCLINATION));
    snap.raan.push(Number(r.RA_OF_ASC_NODE));
    snap.argp.push(Number(r.ARG_OF_PERICENTER));
    snap.ma.push(wrap(Number(r.MEAN_ANOMALY)));
    snap.epochOff.push(Math.round((t - D) / 1000));
    snap.bstar.push(Number(r.BSTAR) || 0);
  }
  return snap;
}
