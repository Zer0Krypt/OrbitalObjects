// More data for the site, fetched at build time alongside the catalogue:
//
//   supplemental elements   CelesTrak SupGP (operator-supplied) for big fleets
//   spaceweather.json       NOAA SWPC solar flux, sunspots and Kp index
//   deepspace.json          JPL Horizons positions of spacecraft beyond Earth orbit
//   conjunction history     each build's SOCRATES prediction, kept per encounter
//   althistory/             perigee and apogee of every object at every snapshot,
//                           plus daily detail for a few famous objects
//
// Each function takes `ctx`: { cached, get, log, CACHE, OUT_DIR, OFFLINE,
// spaceTrackQuery, hasSpaceTrack, parseCSV }.

import fs from 'node:fs/promises';
import path from 'node:path';

const DAY = 86400e3;
const MU = 398600.4418;
const RE = 6378.137;

// ---------- supplemental element sets ----------
/** CelesTrak SupGP files: orbits from the operators' own ephemerides. */
export const SUPGP_FILES = ['starlink', 'oneweb', 'planet', 'iridium', 'gps', 'glonass', 'ses', 'intelsat', 'telesat', 'orbcomm', 'kuiper', 'meteosat', 'iss'];

const isArrayJson = (t) => {
  try {
    return Array.isArray(JSON.parse(t));
  } catch {
    return false;
  }
};

/** norad -> OMM from SupGP, newest epoch per object. */
export async function fetchSupGP(ctx) {
  const out = new Map();
  let files = 0;
  for (const f of SUPGP_FILES) {
    const url = `https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=${f}&FORMAT=json`;
    const r = await ctx.cached(`supgp-${f}.json`, () => ctx.get(url, {}, 2), isArrayJson);
    if (!r) continue;
    files++;
    for (const o of JSON.parse(r.body)) {
      const id = Number(o.NORAD_CAT_ID);
      if (!id || !o.MEAN_MOTION || !o.EPOCH) continue;
      const prev = out.get(id);
      if (!prev || prev.EPOCH < o.EPOCH) out.set(id, o);
    }
  }
  ctx.log(`SupGP: ${out.size} operator-supplied element sets from ${files}/${SUPGP_FILES.length} files`);
  return out;
}

/**
 * Use the SupGP set where it is about as recent as the public one: it comes
 * from the operator's own tracking, so it is usually more accurate.
 */
export function preferSupGP(elements, sup) {
  const used = new Set();
  for (const [id, s] of sup) {
    const pub = elements.get(id);
    if (!pub) continue;
    const ds = Date.parse(s.EPOCH + 'Z');
    const dp = Date.parse(pub.EPOCH + 'Z');
    if (!Number.isFinite(ds) || ds < dp - 2 * DAY) continue;
    // Keep the public catalogue's naming and IDs; take the orbit.
    elements.set(id, { ...pub, ...pick(s), OBJECT_NAME: pub.OBJECT_NAME, OBJECT_ID: pub.OBJECT_ID });
    used.add(id);
  }
  return used;
}
const FIELDS = ['EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'];
const pick = (o) => Object.fromEntries(FIELDS.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '').map((k) => [k, o[k]]));

// ---------- space weather (NOAA SWPC) ----------
const SWPC = 'https://services.swpc.noaa.gov';

/** Rows from SWPC JSON: arrays with a header row, or objects. Returns objects. */
export function swpcRows(text) {
  const d = JSON.parse(text);
  if (!Array.isArray(d) || !d.length) return [];
  if (Array.isArray(d[0])) {
    const head = d[0].map(String);
    return d.slice(1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
  }
  return d;
}
const key = (row, ...res) => Object.keys(row).find((k) => res.some((re) => re.test(k)));
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const isoOf = (s) => {
  const t = Date.parse(String(s).trim().replace(' ', 'T').replace(/(\.\d+)?$/, '') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export async function buildSpaceWeather(ctx, now = Date.now()) {
  const fetchJson = (name, url, maxAge = 0) => ctx.cached(`swpc-${name}.json`, () => ctx.get(url, {}, 2), (t) => swpcRows(t).length > 0, maxAge);
  const [flux, cycle, pred, kp, kpf] = await Promise.all([
    fetchJson('f107', `${SWPC}/json/f107_cm_flux.json`),
    fetchJson('cycle', `${SWPC}/json/solar-cycle/observed-solar-cycle-indices.json`, 7 * DAY),
    fetchJson('predicted', `${SWPC}/json/solar-cycle/predicted-solar-cycle.json`, 7 * DAY),
    fetchJson('kp', `${SWPC}/products/noaa-planetary-k-index.json`),
    fetchJson('kp-forecast', `${SWPC}/products/noaa-planetary-k-index-forecast.json`),
  ]);
  const out = { version: 1, generated: new Date(now).toISOString(), source: 'NOAA Space Weather Prediction Center', available: false, f107: [], cycle: [], predicted: [], kp: [] };
  if (flux) {
    const rows = swpcRows(flux.body);
    const fk = rows[0] && key(rows[0], /^flux$/i, /flux/i);
    const tk = rows[0] && key(rows[0], /time/i);
    const byDay = new Map();
    for (const r of rows) {
      if (r.frequency !== undefined && Number(r.frequency) !== 2800) continue;
      const t = isoOf(r[tk]);
      const v = num(r[fk]);
      if (t && v > 30 && v < 600) byDay.set(t.slice(0, 10), Math.round(v * 10) / 10);
    }
    out.f107 = [...byDay.entries()].sort().slice(-120);
  }
  if (cycle) {
    const rows = swpcRows(cycle.body);
    for (const r of rows) {
      const m = String(r['time-tag'] ?? r.time_tag ?? '');
      if (!/^\d{4}-\d{2}$/.test(m) || m < '1996') continue;
      out.cycle.push([m, round1(num(r.ssn)), round1(num(r['f10.7']))]);
    }
  }
  if (pred) {
    for (const r of swpcRows(pred.body)) {
      const m = String(r['time-tag'] ?? r.time_tag ?? '');
      if (!/^\d{4}-\d{2}$/.test(m)) continue;
      out.predicted.push([m, round1(num(r.predicted_ssn)), round1(num(r['predicted_f10.7']))]);
    }
    out.predicted = out.predicted.slice(0, 36);
  }
  const kpRows = (body, forecastFile) => {
    const rows = swpcRows(body);
    if (!rows.length) return [];
    const tk = key(rows[0], /time/i);
    const kk = key(rows[0], /^kp$/i, /^kp_index$/i, /kp/i);
    const ok = key(rows[0], /observed/i);
    return rows
      .map((r) => [isoOf(r[tk]), round1(num(r[kk])), forecastFile ? String(r[ok] ?? '') !== 'predicted' : true])
      .filter((x) => x[0] && Number.isFinite(x[1]));
  };
  // The forecast file repeats recent observed values; the observed file wins.
  const kpAll = new Map();
  if (kpf) for (const x of kpRows(kpf.body, true)) kpAll.set(x[0], x);
  if (kp) for (const x of kpRows(kp.body, false)) kpAll.set(x[0], x);
  out.kp = [...kpAll.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).filter((x) => Date.parse(x[0]) > now - 8 * DAY);
  out.available = out.f107.length > 0 || out.kp.length > 0;
  return out;
}
const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// ---------- beyond Earth orbit (JPL Horizons) ----------
/** Spacecraft far from Earth: Horizons ID, where they are, and a Wikipedia title. */
export const DEEP_SPACE = [
  { id: '-170', name: 'James Webb Space Telescope', short: 'JWST', where: 'L2', wiki: 'James_Webb_Space_Telescope' },
  { id: '-680', name: 'Euclid', short: 'Euclid', where: 'L2', wiki: 'Euclid_(spacecraft)' },
  { id: '-21', name: 'SOHO', short: 'SOHO', where: 'L1', wiki: 'Solar_and_Heliospheric_Observatory' },
  { id: '-92', name: 'ACE', short: 'ACE', where: 'L1', wiki: 'Advanced_Composition_Explorer' },
  { id: '-78', name: 'DSCOVR', short: 'DSCOVR', where: 'L1', wiki: 'Deep_Space_Climate_Observatory' },
  { id: '-8', name: 'Wind', short: 'Wind', where: 'L1', wiki: 'Wind_(spacecraft)' },
  { id: '-85', name: 'Lunar Reconnaissance Orbiter', short: 'LRO', where: 'Moon', wiki: 'Lunar_Reconnaissance_Orbiter' },
  { id: '-155', name: 'Danuri (KPLO)', short: 'Danuri', where: 'Moon', wiki: 'Danuri' },
  { id: '-152', name: 'Chandrayaan-2 orbiter', short: 'Chandrayaan-2', where: 'Moon', wiki: 'Chandrayaan-2' },
  { id: '-1176', name: 'CAPSTONE', short: 'CAPSTONE', where: 'Moon', wiki: 'CAPSTONE' },
];

/** Positions (km, geocentric, equatorial J2000) between $$SOE and $$EOE in a CSV vector table. */
export function parseHorizons(text) {
  const a = text.indexOf('$$SOE');
  const b = text.indexOf('$$EOE');
  if (a < 0 || b < a) return [];
  const pts = [];
  for (const line of text.slice(a + 5, b).split('\n')) {
    const f = line.split(',').map((x) => x.trim());
    if (f.length < 5) continue;
    const jd = Number(f[0]);
    const x = Number(f[2]);
    const y = Number(f[3]);
    const z = Number(f[4]);
    if (![jd, x, y, z].every(Number.isFinite)) continue;
    // TDB -> UTC is ~69 s; close enough at this scale.
    pts.push([Math.round((jd - 2440587.5) * DAY - 69e3), x, y, z]);
  }
  return pts;
}

function horizonsUrl(id, start, stop, step) {
  const q = (v) => `'${v}'`;
  const p = new URLSearchParams({
    format: 'json',
    COMMAND: q(id),
    OBJ_DATA: q('NO'),
    MAKE_EPHEM: q('YES'),
    EPHEM_TYPE: q('VECTORS'),
    CENTER: q('500@399'),
    START_TIME: q(start),
    STOP_TIME: q(stop),
    STEP_SIZE: q(step),
    VEC_TABLE: q('1'),
    REF_PLANE: q('FRAME'),
    REF_SYSTEM: q('ICRF'),
    OUT_UNITS: q('KM-S'),
    CSV_FORMAT: q('YES'),
    VEC_LABELS: q('NO'),
  });
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${p}`;
}
const ymd = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

export async function buildDeepSpace(ctx, now = Date.now()) {
  const craft = [];
  for (const c of DEEP_SPACE) {
    // Lunar orbiters move fast: 10-minute steps for a few days. Libration-point
    // missions: 6-hour steps for a month, plus a daily path for half a year.
    const lunar = c.where === 'Moon';
    const fetchVec = async (tag, start, stop, step) => {
      const r = await ctx.cached(
        `horizons-${c.id}-${tag}.json`,
        async () => {
          await new Promise((res) => setTimeout(res, 600)); // be gentle with Horizons
          return ctx.get(horizonsUrl(c.id, ymd(start), ymd(stop), step), {}, 2);
        },
        (t) => {
          try {
            return parseHorizons(JSON.parse(t).result ?? '').length > 2;
          } catch {
            return false;
          }
        },
        6 * 3600e3,
      );
      return r ? parseHorizons(JSON.parse(r.body).result) : null;
    };
    const day0 = Math.floor(now / DAY) * DAY;
    const pos = lunar ? await fetchVec('now', day0 - DAY, day0 + 3 * DAY, '10 m') : await fetchVec('now', day0 - 2 * DAY, day0 + 30 * DAY, '6 h');
    if (!pos?.length) {
      ctx.log(`  ! Horizons ${c.short}: no data`);
      continue;
    }
    const pathPts = lunar ? null : await fetchVec('path', day0 - 90 * DAY, day0 + 90 * DAY, '1 d');
    craft.push({
      ...c,
      t0: pos[0][0],
      step: pos.length > 1 ? pos[1][0] - pos[0][0] : 0,
      pos: pos.flatMap((p) => [Math.round(p[1]), Math.round(p[2]), Math.round(p[3])]),
      path: pathPts ? { t0: pathPts[0][0], step: pathPts[1][0] - pathPts[0][0], pos: pathPts.flatMap((p) => [Math.round(p[1] / 10) * 10, Math.round(p[2] / 10) * 10, Math.round(p[3] / 10) * 10]) } : null,
    });
  }
  ctx.log(`Horizons: ${craft.length}/${DEEP_SPACE.length} spacecraft beyond Earth orbit`);
  return { version: 1, generated: new Date(now).toISOString(), source: 'JPL Horizons', available: craft.length > 0, craft };
}

// ---------- close-approach history ----------
/**
 * Attach to each close approach the predictions earlier builds made for the
 * same encounter (same pair, TCA within 30 minutes), oldest first.
 */
export async function withConjunctionHistory(ctx, conj, now = Date.now()) {
  const file = path.join(ctx.CACHE, 'state-conjunction-history.json');
  let hist = [];
  try {
    hist = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    /* first run */
  }
  const keyOf = (c) => `${Math.min(c.a.norad, c.b.norad)}-${Math.max(c.a.norad, c.b.norad)}`;
  for (const c of conj.items) {
    const t = Date.parse(c.tca);
    let e = hist.find((h) => h.pair === keyOf(c) && Math.abs(h.tca - t) < 30 * 60e3);
    if (!e) {
      e = { pair: keyOf(c), tca: t, preds: [] };
      hist.push(e);
    }
    e.tca = t;
    const last = e.preds[e.preds.length - 1];
    // One prediction per build; skip unchanged repeats.
    if (!last || last.rangeKm !== c.rangeKm || last.tca !== c.tca) e.preds.push({ t: new Date(now).toISOString(), tca: c.tca, rangeKm: c.rangeKm, prob: c.prob ?? null });
    c.history = e.preds.slice(-40);
  }
  // Keep encounters for a while after TCA (the geometry view can still open them).
  hist = hist.filter((h) => h.tca > now - 3 * DAY);
  await fs.mkdir(ctx.CACHE, { recursive: true });
  await fs.writeFile(file, JSON.stringify(hist));
  return conj;
}

// ---------- altitude history ----------
export const ALT_SHARDS = 64;
const altKm = (n, e) => {
  const a = Math.cbrt(MU / ((n * 2 * Math.PI) / 86400) ** 2);
  return [a * (1 - e) - RE, a * (1 + e) - RE];
};
const u16 = (km) => Math.max(0, Math.min(65535, Math.round(km)));

/**
 * Per-object perigee/apogee at each snapshot time, sharded by NORAD % 64:
 *   "ALT1", uint32 count, then per object: uint32 norad, uint16 n,
 *   n × (uint16 snapshotIndex, uint16 perigee km, uint16 apogee km).
 * `snaps` is [{ t, snap }] in time order (snap as in snapshots.mjs).
 */
export async function writeAltHistory(outDir, snaps) {
  const dir = path.join(outDir, 'althistory');
  await fs.mkdir(dir, { recursive: true });
  const series = new Map();
  snaps.forEach(({ snap }, si) => {
    for (let k = 0; k < snap.norad.length; k++) {
      const [p, a] = altKm(snap.n[k], snap.e[k]);
      if (!Number.isFinite(p)) continue;
      const id = snap.norad[k];
      if (!series.has(id)) series.set(id, []);
      series.get(id).push(si, u16(p), u16(a));
    }
  });
  const shards = Array.from({ length: ALT_SHARDS }, () => []);
  for (const [id, s] of series) shards[id % ALT_SHARDS].push([id, s]);
  let bytes = 0;
  for (let i = 0; i < ALT_SHARDS; i++) {
    const list = shards[i];
    const size = 8 + list.reduce((m, [, s]) => m + 6 + s.length * 2, 0);
    const buf = Buffer.alloc(size);
    buf.writeUInt32LE(0x31544c41, 0); // "ALT1"
    buf.writeUInt32LE(list.length, 4);
    let o = 8;
    for (const [id, s] of list) {
      buf.writeUInt32LE(id, o);
      buf.writeUInt16LE(s.length / 3, o + 4);
      o += 6;
      for (const v of s) {
        buf.writeUInt16LE(v, o);
        o += 2;
      }
    }
    await fs.writeFile(path.join(dir, `${String(i).padStart(2, '0')}.bin`), buf);
    bytes += size;
  }
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ version: 1, shards: ALT_SHARDS, times: snaps.map((s) => s.t), objects: series.size }));
  return { objects: series.size, bytes };
}

/** Famous objects that get a daily altitude history from Space-Track gp_history. */
export const DETAILED = [25544, 48274, 20580, 43013, 27424, 25994, 39084, 49260, 44713, 41765];

/** Daily perigee/apogee for one object from gp_history (refreshed monthly, appended). */
export async function writeDetailedHistory(ctx, outDir) {
  const dir = path.join(outDir, 'althistory', 'detail');
  await fs.mkdir(dir, { recursive: true });
  const written = [];
  for (const id of DETAILED) {
    const r = ctx.hasSpaceTrack()
      ? await ctx.cached(
          `gp-history-${id}.csv`,
          () => ctx.spaceTrackQuery(`class/gp_history/NORAD_CAT_ID/${id}/orderby/EPOCH%20asc/predicates/EPOCH,MEAN_MOTION,ECCENTRICITY/format/csv`, 300_000),
          (t) => /EPOCH/.test(t.slice(0, 200)),
          30 * DAY,
        )
      : null;
    if (!r) continue;
    const byDay = new Map();
    for (const row of ctx.parseCSV(r.body)) {
      const day = String(row.EPOCH).slice(0, 10);
      const n = Number(row.MEAN_MOTION);
      const e = Number(row.ECCENTRICITY);
      if (!/^\d{4}-\d\d-\d\d$/.test(day) || !(n > 0)) continue;
      byDay.set(day, altKm(n, e));
    }
    const points = [...byDay.entries()].sort().map(([d, [p, a]]) => [d, Math.round(p * 10) / 10, Math.round(a * 10) / 10]);
    if (points.length < 2) continue;
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify({ norad: id, source: 'Space-Track gp_history (daily)', points }));
    written.push(id);
  }
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(written));
  if (written.length) ctx.log(`Detailed altitude histories: ${written.length}`);
  return written;
}

// ---------- launch details (Launch Library 2, detailed mode) ----------
/** "PT2M29S", "-PT1H5M" -> seconds. */
export function isoDuration(s) {
  const m = String(s ?? '').match(/^(-)?P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/);
  if (!m) return null;
  const v = (Number(m[2] || 0) * 24 + Number(m[3] || 0)) * 3600 + Number(m[4] || 0) * 60 + Number(m[5] || 0);
  return m[1] ? -v : v;
}

/** Published flight events and first-stage landing for one LL2 launch, when listed. */
export function launchDetails(l) {
  const timeline = (Array.isArray(l.timeline) ? l.timeline : [])
    .map((e) => ({ abbrev: String(e.type?.abbrev ?? '').trim(), name: String(e.type?.description ?? e.type?.abbrev ?? '').trim(), t: isoDuration(e.relative_time) }))
    .filter((e) => e.abbrev && e.t !== null && e.t >= 0 && e.t < 6 * 3600)
    .sort((a, b) => a.t - b.t);
  let landing = null;
  for (const st of l.rocket?.launcher_stage ?? []) {
    const ld = st.landing;
    const loc = ld?.landing_location ?? ld?.location;
    const lat = Number(loc?.latitude ?? loc?.location?.latitude);
    const lon = Number(loc?.longitude ?? loc?.location?.longitude);
    if (!ld || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    landing = {
      name: String(loc?.name ?? ''),
      abbrev: String(loc?.abbrev ?? ''),
      lat,
      lon,
      downrangeKm: Number.isFinite(Number(ld.downrange_distance)) ? Number(ld.downrange_distance) : null,
      type: String(ld.type?.abbrev ?? ld.type?.name ?? ''),
    };
    break;
  }
  return { timeline, landing };
}
