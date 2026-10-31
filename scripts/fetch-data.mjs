#!/usr/bin/env node
// Builds the site's data files in public/data/ from public sources:
//
//   catalog.json  objects in orbit now
//   history.json  objects that have re-entered (for the history replay)
//   reentry.json  predicted and recent re-entries
//   conjunctions.json  predicted close approaches (CelesTrak SOCRATES)
//   launches.json      upcoming launches (The Space Devs, Launch Library 2)
//   magnitudes.json    standard (intrinsic) visual magnitudes (Mike McCants' qs.mag)
//   manoeuvres.json    payloads whose orbit changed more than drag explains (last 14 days)
//   breakups.json      jumps in the debris catalogued from one launch (last 180 days)
//   status.json        when each source was last fetched, counts, backfill progress
//   spaceweather.json  solar flux, sunspots and Kp (NOAA SWPC)
//   deepspace.json     spacecraft at L1/L2 and around the Moon (JPL Horizons)
//   radio.json         amateur radio transmitters (SatNOGS DB)
//   aurora.json        aurora forecast (NOAA SWPC OVATION)
//   launchstats.json   launches per year, providers, rockets, booster reuse
//   classified.json    hobbyist-tracked classified satellites (opt-in on the site)
//   digest.json        what changed each day, and feed.xml (Atom)
//   deployments/       day-by-day element sets of recent multi-satellite launches
//   althistory/        perigee/apogee of every object at every snapshot, and daily
//                      histories of a few famous objects (Space-Track gp_history)
//
//   CelesTrak SupGP (always)              -> operator-supplied orbits for big fleets
//
//   CelesTrak GP groups (always)          -> orbital elements + group tags
//   CelesTrak SATCAT (always)             -> type, owner, launch/decay dates, RCS, status
//   Space-Track (optional, SPACETRACK_USER / SPACETRACK_PASS):
//       full GP catalog                   -> every tracked object incl. all debris
//       final element sets of re-entered objects (refreshed weekly)
//       decay predictions + TIP messages  -> upcoming re-entries
//       gp_history snapshots              -> orbits as they were: yearly, quarterly for the
//                                            last decade, and at each timeline event
//                                            (history/<key>.bin, backfilled a few per run)
//
// Raw responses are cached in .data-cache/ so a failed or rate-limited request
// falls back to the last good copy. As a last resort FALLBACK_CATALOG_URL (the
// currently deployed catalog) is used. With --strict the script exits non-zero
// rather than writing a catalog that is missing or suspiciously small.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS } from './groups.mjs';
import { buildSnapshot, loadEvents, snapshotPlan, writeSnapshot } from './snapshots.mjs';
import { parseQsMag, unzipText } from './magnitudes.mjs';
import { detectBreakups, detectManoeuvres, elementState, mergeManoeuvres } from './changes.mjs';
import { buildAurora, buildClassified, buildLaunchStats, buildRadio, writeDeployments, writeDigest } from './more.mjs';
import { buildDeepSpace, buildSpaceWeather, fetchSupGP, launchDetails, preferSupGP, withConjunctionHistory, writeAltHistory, writeDetailedHistory } from './extras.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.data-cache');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const STRICT = process.argv.includes('--strict');
// DATA_OFFLINE=1 skips the network and rebuilds from .data-cache/ only.
const OFFLINE = !!process.env.DATA_OFFLINE;
const MIN_OBJECTS = 2000;
const UA = 'OrbitalObjects/1.0 (+https://github.com/Zer0Krypt/OrbitalObjects)';
const CELESTRAK = 'https://celestrak.org';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[data]', ...a);

/** What happened to each source this run, for status.json. */
const SOURCES = new Map();
async function noteSource(key, fresh, ok) {
  let fetchedAt = fresh ? Date.now() : null;
  if (!fresh && ok) {
    try {
      fetchedAt = JSON.parse(await fs.readFile(path.join(CACHE, key + '.meta.json'), 'utf8')).fetchedAt;
    } catch {
      /* no meta */
    }
  }
  SOURCES.set(key, { key, ok, fresh, fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null });
}

/**
 * Fetch with a cached fallback. With `maxAgeMs`, a cached copy younger than
 * that is used without touching the network (for large, slow-changing data).
 */
async function cached(key, fetcher, validate, maxAgeMs = 0) {
  const file = path.join(CACHE, key);
  const meta = path.join(CACHE, key + '.meta.json');
  if (maxAgeMs) {
    try {
      const { fetchedAt } = JSON.parse(await fs.readFile(meta, 'utf8'));
      if (Date.now() - fetchedAt < maxAgeMs) {
        const body = await fs.readFile(file, 'utf8');
        log(`  ${key}: cached copy is ${((Date.now() - fetchedAt) / 86400e3).toFixed(1)} days old — reusing`);
        SOURCES.set(key, { key, ok: true, fresh: false, reused: true, fetchedAt: new Date(fetchedAt).toISOString() });
        return { body, fresh: false };
      }
    } catch {
      /* no usable cache */
    }
  }
  try {
    const body = await fetcher();
    if (!validate(body)) throw new Error('response failed validation');
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, body);
    await fs.writeFile(meta, JSON.stringify({ fetchedAt: Date.now() }));
    await noteSource(key, true, true);
    return { body, fresh: true };
  } catch (err) {
    try {
      const body = await fs.readFile(file, 'utf8');
      log(`  ! ${key}: ${err.message} — using cached copy`);
      await noteSource(key, false, true);
      SOURCES.get(key).error = err.message.slice(0, 160);
      return { body, fresh: false };
    } catch {
      log(`  ! ${key}: ${err.message} — no cached copy`);
      await noteSource(key, false, false);
      SOURCES.get(key).error = err.message.slice(0, 160);
      return null;
    }
  }
}

async function get(url, init = {}, attempts = 3) {
  if (OFFLINE) throw new Error('offline');
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, ...(init.headers || {}) },
        signal: AbortSignal.timeout(init.timeoutMs ?? 90_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
      return text;
    } catch (err) {
      lastErr = err;
      // 403 from CelesTrak means "not updated since your last download"; retrying won't help.
      if (/HTTP (403|404)/.test(err.message)) break;
      await sleep(2000 * 2 ** i);
    }
  }
  throw lastErr;
}

const isJsonArray = (t) => {
  try {
    return Array.isArray(JSON.parse(t));
  } catch {
    return false;
  }
};

// ---------- CSV ----------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.length >= header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// ---------- sources ----------
async function fetchCelestrakGroups() {
  const gp = new Map(); // norad -> OMM
  const tags = new Map(); // norad -> Set(groupIndex)
  const keys = ['active', ...GROUPS.map((g) => g[0])];
  let fresh = 0;
  for (const key of keys) {
    const url = `${CELESTRAK}/NORAD/elements/gp.php?GROUP=${encodeURIComponent(key)}&FORMAT=json`;
    const r = await cached(`gp-${key}.json`, () => get(url), isJsonArray);
    if (!OFFLINE) await sleep(400);
    if (!r) continue;
    if (r.fresh) fresh++;
    const list = JSON.parse(r.body);
    const gi = GROUPS.findIndex((g) => g[0] === key);
    for (const o of list) {
      const id = Number(o.NORAD_CAT_ID);
      const prev = gp.get(id);
      if (!prev || prev.EPOCH < o.EPOCH) gp.set(id, o);
      if (gi >= 0) {
        if (!tags.has(id)) tags.set(id, new Set());
        tags.get(id).add(gi);
      }
    }
    log(`  ${key.padEnd(20)} ${String(list.length).padStart(6)}${r.fresh ? '' : '  (cached)'}`);
  }
  log(`CelesTrak: ${gp.size} unique objects from ${keys.length} groups (${fresh} fresh)`);
  return { gp, tags };
}

// ---------- Space-Track ----------
const ST = 'https://www.space-track.org';
let stCookie = null;

/** Log in once per run; returns false when credentials are missing or rejected. */
async function spaceTrackLogin() {
  const user = process.env.SPACETRACK_USER;
  const pass = process.env.SPACETRACK_PASS;
  if (!user || !pass || OFFLINE) return false;
  if (stCookie) return true;
  try {
    const login = await fetch(`${ST}/ajaxauth/login`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ identity: user, password: pass }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await login.text();
    if (!login.ok || /failed/i.test(text)) throw new Error(`login HTTP ${login.status} ${text.slice(0, 80)}`);
    stCookie = (login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')])
      .filter(Boolean)
      .map((c) => c.split(';')[0])
      .join('; ');
    return true;
  } catch (err) {
    log(`Space-Track: ${err.message}`);
    return false;
  }
}

async function spaceTrackQuery(query, timeoutMs) {
  if (!(await spaceTrackLogin())) throw new Error('not logged in');
  const text = await get(`${ST}/basicspacedata/query/${query}`, { headers: { Cookie: stCookie }, timeoutMs }, 2);
  await sleep(2500); // stay well inside Space-Track's rate limits
  return text;
}

const hasSpaceTrack = () => !!process.env.SPACETRACK_USER && !!process.env.SPACETRACK_PASS && !OFFLINE;

async function fetchSpaceTrack() {
  if (!hasSpaceTrack()) {
    log('Space-Track: SPACETRACK_USER/SPACETRACK_PASS not set — skipping full catalog');
    return null;
  }
  const r = await cached(
    'spacetrack-gp.json',
    () => spaceTrackQuery('class/gp/decay_date/null-val/epoch/%3Enow-30/orderby/norad_cat_id/format/json'),
    isJsonArray,
  );
  if (!r) return null;
  const list = JSON.parse(r.body);
  log(`Space-Track: ${list.length} objects${r.fresh ? '' : ' (cached)'}`);
  return new Map(list.map((o) => [Number(o.NORAD_CAT_ID), o]));
}

/** Final element sets of every re-entered object. Large and slow-changing: refreshed weekly. */
async function fetchDecayedElements() {
  if (!hasSpaceTrack()) return new Map();
  const r = await cached(
    'spacetrack-decayed.json',
    () => spaceTrackQuery('class/gp/decay_date/%3C%3Enull-val/orderby/norad_cat_id/format/json'),
    isJsonArray,
    7 * 86400e3,
  );
  if (!r) return new Map();
  const list = JSON.parse(r.body);
  log(`Space-Track: ${list.length} final element sets of re-entered objects`);
  return new Map(list.map((o) => [Number(o.NORAD_CAT_ID), o]));
}

/** Re-entry predictions (decay class) and Tracking & Impact Prediction messages. */
async function fetchReentryPredictions() {
  if (!hasSpaceTrack()) return null;
  const decay = await cached(
    'spacetrack-decay-predictions.json',
    () => spaceTrackQuery('class/decay/decay_epoch/%3Enow-1/msg_type/Prediction/orderby/decay_epoch%20asc/format/json'),
    isJsonArray,
  );
  const tip = await cached(
    'spacetrack-tip.json',
    () => spaceTrackQuery('class/tip/decay_epoch/%3Enow-1/orderby/decay_epoch%20asc/format/json'),
    isJsonArray,
  );
  if (!decay && !tip) return null;
  return { decay: decay ? JSON.parse(decay.body) : [], tip: tip ? JSON.parse(tip.body) : [] };
}

async function fetchSatcat() {
  const r = await cached(
    'satcat.csv',
    () => get(`${CELESTRAK}/pub/satcat.csv`),
    (t) => t.startsWith('OBJECT_NAME') && t.length > 1e6,
  );
  if (!r) return new Map();
  const rows = parseCSV(r.body);
  log(`SATCAT: ${rows.length} records${r.fresh ? '' : ' (cached)'}`);
  return new Map(rows.map((o) => [Number(o.NORAD_CAT_ID), o]));
}

// ---------- merge ----------
const TYPE = { PAY: 'P', PAYLOAD: 'P', 'R/B': 'R', 'ROCKET BODY': 'R', DEB: 'D', DEBRIS: 'D', UNK: 'U', UNKNOWN: 'U', TBA: 'U' };

function inferType(name) {
  if (/\bDEB\b|\bCOOLANT\b|\bSHROUD\b|\bFAIRING\b|\bPLATFORM\b/.test(name)) return 'D';
  if (/\bR\/B\b|\bAKM\b|\bPKM\b|\bROCKET\b/.test(name)) return 'R';
  return 'U';
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

function buildRow(o, sc, st, groups) {
  const name = String(o.OBJECT_NAME ?? sc?.OBJECT_NAME ?? 'UNKNOWN').trim();
  const type = TYPE[(sc?.OBJECT_TYPE || st?.OBJECT_TYPE || '').toUpperCase()] ?? inferType(name);
  let rcs = num(sc?.RCS);
  if (rcs === null && st?.RCS_SIZE) rcs = { SMALL: 0.05, MEDIUM: 0.5, LARGE: 2 }[st.RCS_SIZE] ?? null;
  return [
    Number(o.NORAD_CAT_ID),
    name,
    String(o.OBJECT_ID ?? sc?.OBJECT_ID ?? ''),
    String(o.EPOCH),
    num(o.MEAN_MOTION),
    num(o.ECCENTRICITY),
    num(o.INCLINATION),
    num(o.RA_OF_ASC_NODE),
    num(o.ARG_OF_PERICENTER),
    num(o.MEAN_ANOMALY),
    num(o.BSTAR),
    num(o.MEAN_MOTION_DOT),
    num(o.MEAN_MOTION_DDOT),
    num(o.REV_AT_EPOCH) ?? 0,
    num(o.ELEMENT_SET_NO) ?? 0,
    type,
    sc?.OWNER || st?.COUNTRY_CODE || 'UNK',
    sc?.LAUNCH_DATE || st?.LAUNCH_DATE || '',
    sc?.LAUNCH_SITE || st?.SITE || '',
    sc?.OPS_STATUS_CODE || '',
    rcs,
    groups ? [...groups].sort((a, b) => a - b) : [],
  ];
}

// ---------- snapshots (gp_history) ----------
// New snapshots fetched per run, in priority order (events, recent quarters,
// then years). Snapshots never change once taken, so the cache keeps them for
// good and later runs only add what's missing (or upgrade old v1 copies).
const SNAPSHOT_BUDGET = Number(process.env.HISTORY_SNAPSHOT_BUDGET || 16);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

let SNAPSHOT_STATUS = null;

async function fetchSnapshot(item) {
  const w = item.windowDays * 86400e3;
  const q =
    `class/gp_history/EPOCH/${isoDay(item.t - w)}--${isoDay(item.t + w + 86400e3)}` +
    '/predicates/NORAD_CAT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,BSTAR/format/csv';
  const csv = await spaceTrackQuery(q, 600_000);
  if (csv.trim() && !/NORAD_CAT_ID/.test(csv.slice(0, 400))) throw new Error('unexpected response');
  return buildSnapshot(csv.trim() ? parseCSV(csv) : [], item.t);
}

async function readCached(key) {
  for (const k of [key, key.endsWith('-01') ? key.slice(0, 4) : null].filter(Boolean)) {
    try {
      return JSON.parse(await fs.readFile(path.join(CACHE, `snapshot-${k}.json`), 'utf8'));
    } catch {
      /* not cached */
    }
  }
  return null;
}

/** Returns the manifest of snapshots written to history/<key>.bin. */
async function buildSnapshots() {
  const plan = snapshotPlan(Date.now(), await loadEvents());
  const cached = new Map();
  for (const item of plan) cached.set(item.key, await readCached(item.key));
  // Missing ones first, then upgrades of v1 copies (no SGP4 fields).
  const todo = [...plan.filter((i) => !cached.get(i.key)), ...plan.filter((i) => cached.get(i.key) && cached.get(i.key).v !== 2)];
  let fetched = 0;
  for (const item of todo) {
    if (!hasSpaceTrack() || fetched >= SNAPSHOT_BUDGET) break;
    fetched++;
    try {
      const snap = await fetchSnapshot(item);
      await fs.mkdir(CACHE, { recursive: true });
      await fs.writeFile(path.join(CACHE, `snapshot-${item.key}.json`), JSON.stringify(snap));
      cached.set(item.key, snap);
      log(`  snapshot ${item.key} (${item.kind}): ${snap.norad.length} objects`);
    } catch (err) {
      log(`  ! snapshot ${item.key}: ${err.message} — will retry next run`);
    }
  }
  const manifest = [];
  for (const item of plan) {
    const snap = cached.get(item.key);
    if (!snap?.norad?.length) continue;
    await writeSnapshot(OUT_DIR, item.key, snap);
    manifest.push({ key: item.key, t: item.t, kind: item.kind, sgp4: snap.v === 2 && snap.sgp4 !== false });
  }
  manifest.sort((a, b) => a.t - b.t);
  const alt = await writeAltHistory(OUT_DIR, manifest.map((m) => ({ t: m.t, snap: cached.get(m.key) })));
  log(`Altitude history: ${alt.objects} objects over ${manifest.length} snapshots (${(alt.bytes / 1e6).toFixed(1)} MB in 64 shards)`);
  const missing = plan.length - manifest.length;
  SNAPSHOT_STATUS = { planned: plan.length, available: manifest.length, sgp4: manifest.filter((m) => m.sgp4).length, fetchedThisRun: fetched, budget: SNAPSHOT_BUDGET, spaceTrack: hasSpaceTrack() };
  log(`Snapshots: ${manifest.length}/${plan.length} available, ${manifest.filter((m) => m.sgp4).length} with SGP4 detail${missing ? ` (${missing} still to fetch${hasSpaceTrack() ? '' : '; needs Space-Track'})` : ''}`);
  return manifest;
}

// ---------- history (re-entered objects) ----------
const RE_KM = 6378.137;
const round = (v, d) => (v === null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

/** Deterministic pseudo-random angle from a NORAD ID (used only when no elements exist). */
function hashAngle(n, salt) {
  let x = (n * 2654435761 + salt * 40503) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822507) >>> 0;
  x ^= x >>> 13;
  return ((x >>> 0) / 4294967296) * 360;
}

function buildHistory(satcat, decayedEls) {
  const rows = [];
  let approx = 0;
  for (const [id, sc] of satcat) {
    if (!sc.DECAY_DATE || !sc.LAUNCH_DATE) continue;
    if (sc.ORBIT_CENTER && sc.ORBIT_CENTER !== 'EA') continue; // lunar / heliocentric
    if (sc.DECAY_DATE < sc.LAUNCH_DATE) continue;
    const el = decayedEls.get(id);
    let n, e, i, raan, argp, ma, epoch, isApprox;
    if (el && Number(el.MEAN_MOTION) > 0) {
      n = Number(el.MEAN_MOTION);
      e = Number(el.ECCENTRICITY);
      i = Number(el.INCLINATION);
      raan = Number(el.RA_OF_ASC_NODE);
      argp = Number(el.ARG_OF_PERICENTER);
      ma = Number(el.MEAN_ANOMALY);
      epoch = String(el.EPOCH);
      isApprox = 0;
    } else {
      // No published elements: reconstruct the orbit's size, shape and tilt from
      // SATCAT; its orientation and phase are unknown, so they are arbitrary.
      const period = Number(sc.PERIOD);
      const apo = Number(sc.APOGEE);
      const per = Number(sc.PERIGEE);
      if (!(period > 0) || !Number.isFinite(apo) || !Number.isFinite(per)) continue;
      const a = (apo + per) / 2 + RE_KM;
      n = 1440 / period;
      e = Math.max(0, (apo - per) / (2 * a));
      i = Number(sc.INCLINATION) || 0;
      raan = hashAngle(id, 1);
      argp = hashAngle(id, 2);
      ma = hashAngle(id, 3);
      epoch = `${sc.LAUNCH_DATE}T00:00:00`;
      isApprox = 1;
      approx++;
    }
    if (!(e >= 0 && e < 0.99)) continue;
    rows.push([
      id,
      String(sc.OBJECT_NAME || 'UNKNOWN').trim(),
      String(sc.OBJECT_ID || ''),
      epoch,
      round(n, 8),
      round(e, 7),
      round(i, 4),
      round(raan, 4),
      round(argp, 4),
      round(ma, 4),
      TYPE[(sc.OBJECT_TYPE || '').toUpperCase()] ?? inferType(String(sc.OBJECT_NAME || '')),
      sc.OWNER || 'UNK',
      sc.LAUNCH_DATE,
      sc.DECAY_DATE,
      sc.LAUNCH_SITE || '',
      num(sc.RCS),
      isApprox,
    ]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return {
    rows,
    approx,
    data: {
      version: 1,
      generated: new Date().toISOString(),
      fields: ['norad', 'name', 'cospar', 'epoch', 'meanMotion', 'ecc', 'incl', 'raan', 'argp', 'ma', 'type', 'owner', 'launch', 'decay', 'site', 'rcs', 'approx'],
      objects: rows,
    },
  };
}

// ---------- re-entries ----------
const parseUtc = (s) => (s ? Date.parse(String(s).trim().replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z')) : NaN);
const pick = (o, ...keys) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};

function buildReentries(satcat, predictions) {
  const now = Date.now();
  const upcoming = new Map();
  if (predictions) {
    for (const d of predictions.decay) {
      const id = Number(pick(d, 'NORAD_CAT_ID', 'OBJECT_NUMBER'));
      const t = parseUtc(pick(d, 'DECAY_EPOCH'));
      if (!id || !Number.isFinite(t) || t < now - 86400e3) continue;
      const msg = parseUtc(pick(d, 'MSG_EPOCH')) || 0;
      const prev = upcoming.get(id);
      if (prev && prev.msgEpoch >= msg) continue;
      upcoming.set(id, {
        norad: id,
        name: String(pick(d, 'OBJECT_NAME', 'SATNAME') ?? satcat.get(id)?.OBJECT_NAME ?? 'UNKNOWN').trim(),
        cospar: String(pick(d, 'INTLDES', 'OBJECT_ID') ?? satcat.get(id)?.OBJECT_ID ?? ''),
        decay: new Date(t).toISOString(),
        msgEpoch: msg,
        windowMin: null,
        source: 'prediction',
        tip: null,
      });
    }
    // TIP messages are the final, most precise predictions; they override.
    for (const m of predictions.tip) {
      const id = Number(pick(m, 'NORAD_CAT_ID', 'OBJECT_NUMBER'));
      const t = parseUtc(pick(m, 'DECAY_EPOCH'));
      if (!id || !Number.isFinite(t) || t < now - 86400e3) continue;
      const msg = parseUtc(pick(m, 'MSG_EPOCH', 'INSERT_EPOCH')) || 0;
      const prev = upcoming.get(id);
      if (prev?.source === 'tip' && prev.msgEpoch >= msg) continue;
      const sc = satcat.get(id);
      upcoming.set(id, {
        norad: id,
        name: String(prev?.name ?? sc?.OBJECT_NAME ?? 'UNKNOWN').trim(),
        cospar: String(prev?.cospar ?? sc?.OBJECT_ID ?? ''),
        decay: new Date(t).toISOString(),
        msgEpoch: msg,
        windowMin: num(pick(m, 'WINDOW')),
        source: 'tip',
        tip: {
          lat: num(pick(m, 'LAT')),
          lon: num(pick(m, 'LON')),
          direction: pick(m, 'DIRECTION') ?? null,
          highInterest: /^(Y|YES|TRUE|1)$/i.test(String(pick(m, 'HIGH_INTEREST') ?? '')),
        },
      });
    }
  }
  const recent = [];
  for (const [id, sc] of satcat) {
    if (!sc.DECAY_DATE) continue;
    const t = Date.parse(sc.DECAY_DATE + 'T00:00:00Z');
    if (now - t > 30 * 86400e3 || t > now) continue;
    recent.push({ norad: id, name: String(sc.OBJECT_NAME || '').trim(), cospar: sc.OBJECT_ID || '', decay: sc.DECAY_DATE, type: TYPE[(sc.OBJECT_TYPE || '').toUpperCase()] ?? 'U', owner: sc.OWNER || 'UNK', rcs: num(sc.RCS) });
  }
  recent.sort((a, b) => (a.decay < b.decay ? 1 : -1));
  return {
    version: 1,
    generated: new Date(now).toISOString(),
    predictions: !!predictions,
    upcoming: [...upcoming.values()].sort((a, b) => (a.decay < b.decay ? -1 : 1)).map(({ msgEpoch, ...u }) => u),
    recent,
  };
}

// ---------- close approaches (CelesTrak SOCRATES) ----------
const SOCRATES = [`${CELESTRAK}/SOCRATES/sort-minRange.csv`, `${CELESTRAK}/SOCRATES/sort-maxProb.csv`];

/** Find a column by trying header patterns in order. */
function column(header, ...patterns) {
  for (const re of patterns) {
    const k = header.find((h) => re.test(h));
    if (k) return k;
  }
  return null;
}

async function buildConjunctions() {
  const now = Date.now();
  const pairs = new Map();
  let ok = 0;
  for (const url of SOCRATES) {
    const name = url.split('/').pop();
    const r = await cached(`socrates-${name}`, () => get(url), (t) => /NORAD/i.test(t.slice(0, 300)));
    if (!r) continue;
    ok++;
    const rows = parseCSV(r.body);
    if (!rows.length) continue;
    const H = Object.keys(rows[0]);
    const c = {
      id1: column(H, /NORAD.*_?1$/i, /CAT.*1/i),
      n1: column(H, /NAME.*_?1$/i),
      id2: column(H, /NORAD.*_?2$/i, /CAT.*2/i),
      n2: column(H, /NAME.*_?2$/i),
      tca: column(H, /^TCA$/i, /TCA(?!.*(RANGE|SPEED|VEL))/i),
      range: column(H, /TCA_RANGE/i, /RANGE/i),
      speed: column(H, /SPEED/i, /VEL/i),
      prob: column(H, /MAX_PROB/i, /PROB/i),
    };
    if (!c.id1 || !c.id2 || !c.tca || !c.range) {
      log(`  ! ${name}: unrecognised columns ${H.join(',')}`);
      continue;
    }
    for (const row of rows) {
      const a = Number(row[c.id1]);
      const b = Number(row[c.id2]);
      const t = parseUtc(row[c.tca]);
      const range = Number(row[c.range]);
      if (!a || !b || !Number.isFinite(t) || !Number.isFinite(range)) continue;
      if (t < now - 3600e3 || t > now + 8 * 86400e3) continue;
      const key = `${Math.min(a, b)}-${Math.max(a, b)}-${Math.round(t / 60e3)}`;
      if (pairs.has(key)) continue;
      pairs.set(key, {
        a: { norad: a, name: String(row[c.n1] ?? '').trim() },
        b: { norad: b, name: String(row[c.n2] ?? '').trim() },
        tca: new Date(t).toISOString(),
        rangeKm: range,
        speedKms: c.speed ? num(row[c.speed]) : null,
        prob: c.prob ? num(row[c.prob]) : null,
      });
    }
  }
  const items = [...pairs.values()].sort((x, y) => x.rangeKm - y.rangeKm).slice(0, 80);
  return { version: 1, generated: new Date(now).toISOString(), source: 'CelesTrak SOCRATES', available: ok > 0, items };
}

// ---------- upcoming launches (Launch Library 2) ----------
const LL2 = ['https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=30&mode=detailed', 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=30&mode=normal'];

async function buildLaunches() {
  let list = null;
  for (const url of LL2) {
    const r = await cached(`ll2-upcoming-${url.includes('2.3.0') ? '23' : '22'}.json`, () => get(url, {}, 2), (t) => {
      try {
        return Array.isArray(JSON.parse(t).results);
      } catch {
        return false;
      }
    });
    if (r) {
      list = JSON.parse(r.body).results;
      break;
    }
  }
  const str = (v) => (v === undefined || v === null || v === '' ? null : String(v));
  const upcoming = (list ?? [])
    .map((l) => ({
      id: str(l.id),
      name: str(l.name),
      net: str(l.net),
      windowStart: str(l.window_start),
      windowEnd: str(l.window_end),
      status: str(l.status?.abbrev ?? l.status?.name),
      statusName: str(l.status?.name),
      provider: str(l.launch_service_provider?.name),
      rocket: str(l.rocket?.configuration?.full_name ?? l.rocket?.configuration?.name),
      mission: str(l.mission?.name),
      missionType: str(l.mission?.type),
      description: str(l.mission?.description),
      orbit: str(l.mission?.orbit?.abbrev ?? l.mission?.orbit?.name),
      pad: str(l.pad?.name),
      location: str(l.pad?.location?.name),
      country: str(l.pad?.country?.alpha_2_code ?? l.pad?.location?.country_code ?? l.pad?.country_code),
      lat: num(l.pad?.latitude),
      lon: num(l.pad?.longitude),
      image: str(typeof l.image === 'object' ? (l.image?.thumbnail_url ?? l.image?.image_url) : l.image),
      webcast: !!l.webcast_live,
      vidUrl: str((l.vid_urls ?? l.vidURLs)?.[0]?.url),
      // Published flight events (MECO, SECO…) and the first-stage landing site, when listed.
      ...launchDetails(l),
      infoUrl: str((l.info_urls ?? l.infoURLs)?.[0]?.url),
    }))
    .filter((l) => l.net && Number.isFinite(Date.parse(l.net)));
  return { version: 1, generated: new Date().toISOString(), source: 'The Space Devs — Launch Library 2', available: !!list, upcoming };
}

// ---------- standard magnitudes (McCants qs.mag) ----------
// Brightness of each object at 1000 km range and 50% illumination, from
// visual observations or estimated from size. Changes rarely: refreshed monthly.
const QSMAG = [
  'https://www.mmccants.org/programs/qsmag.zip',
  'https://www.prismnet.com/~mmccants/programs/qsmag.zip',
];

async function buildMagnitudes() {
  let mags = null;
  for (const url of QSMAG) {
    const r = await cached(
      'qs.mag.txt',
      async () => {
        if (OFFLINE) throw new Error('offline');
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.readUInt32LE(0) === 0x04034b50 ? unzipText(buf, /qs\.mag$/i) : buf.toString('latin1');
      },
      (t) => parseQsMag(t).length > 500,
      30 * 86400e3,
    );
    if (r) {
      mags = parseQsMag(r.body);
      break;
    }
  }
  return { version: 1, generated: new Date().toISOString(), source: mags ? "Mike McCants' qs.mag" : 'none', available: !!mags, mags: mags ?? [] };
}

async function fallbackCatalog() {
  const url = process.env.FALLBACK_CATALOG_URL;
  if (!url) return null;
  try {
    const text = await get(url, {}, 2);
    const data = JSON.parse(text);
    if (data?.objects?.length) {
      log(`Fallback: reusing deployed catalog (${data.objects.length} objects, ${data.generated})`);
      return data;
    }
  } catch (err) {
    log(`Fallback: ${err.message}`);
  }
  return null;
}

/** Helpers handed to scripts/extras.mjs. */
const ctx = {
  cached: (...a) => cached(...a),
  get: (...a) => get(...a),
  log,
  get CACHE() {
    return CACHE;
  },
  get OUT_DIR() {
    return OUT_DIR;
  },
  spaceTrackQuery: (...a) => spaceTrackQuery(...a),
  hasSpaceTrack: () => hasSpaceTrack(),
  parseCSV: (t) => parseCSV(t),
};

async function main() {
  const started = Date.now();
  const { gp, tags } = await fetchCelestrakGroups();
  const st = await fetchSpaceTrack();
  const satcat = await fetchSatcat();

  const elements = new Map(gp);
  if (st) for (const [id, o] of st) if (!elements.has(id) || elements.get(id).EPOCH < o.EPOCH) elements.set(id, o);
  const supUsed = preferSupGP(elements, await fetchSupGP(ctx));

  const rows = [];
  for (const [id, o] of elements) {
    if (!o.MEAN_MOTION || !o.EPOCH) continue;
    const sc = satcat.get(id);
    if (sc?.DECAY_DATE) continue; // re-entered since this element set
    rows.push([...buildRow(o, sc, st?.get(id), tags.get(id)), supUsed.has(id) ? 1 : 0]);
  }
  rows.sort((a, b) => a[0] - b[0]);

  let catalog = {
    version: 1,
    generated: new Date().toISOString(),
    source: st ? 'Space-Track.org + CelesTrak' : 'CelesTrak',
    sample: false,
    groups: GROUPS.map(([key, label, category]) => ({ key, label, category })),
    fields: [
      'norad', 'name', 'cospar', 'epoch', 'meanMotion', 'ecc', 'incl', 'raan', 'argp', 'ma',
      'bstar', 'ndot', 'nddot', 'revs', 'elset', 'type', 'owner', 'launch', 'site', 'status', 'rcs', 'groups', 'sup',
    ],
    objects: rows,
  };

  if (rows.length < MIN_OBJECTS) {
    log(`Only ${rows.length} objects assembled (minimum ${MIN_OBJECTS}).`);
    const fb = await fallbackCatalog();
    if (fb) catalog = fb;
    else if (STRICT) {
      console.error('[data] No usable catalog — aborting (strict mode).');
      process.exit(1);
    } else {
      console.error('[data] No usable catalog. Run `npm run data:sample` for offline development.');
      process.exit(1);
    }
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'catalog.json'), JSON.stringify(catalog));
  const counts = catalog.objects.reduce((m, r) => ((m[r[15]] = (m[r[15]] || 0) + 1), m), {});
  log(`Wrote ${catalog.objects.length} objects ${JSON.stringify(counts)}`);

  // History and re-entries are best-effort: they never block a deploy.
  if (satcat.size) {
    const history = buildHistory(satcat, await fetchDecayedElements());
    history.data.snapshots = await buildSnapshots();
    await fs.writeFile(path.join(OUT_DIR, 'history.json'), JSON.stringify(history.data));
    log(`Wrote history: ${history.rows.length} re-entered objects (${history.approx} with reconstructed orbits)`);
  } else log('No SATCAT — skipping history.json');

  const reentry = buildReentries(satcat, await fetchReentryPredictions());
  await fs.writeFile(path.join(OUT_DIR, 'reentry.json'), JSON.stringify(reentry));
  log(`Wrote re-entries: ${reentry.upcoming.length} predicted, ${reentry.recent.length} in the last 30 days${reentry.predictions ? '' : ' (no Space-Track predictions)'}`);
  const conj = await withConjunctionHistory(ctx, await buildConjunctions());
  await fs.writeFile(path.join(OUT_DIR, 'conjunctions.json'), JSON.stringify(conj));
  log(`Wrote close approaches: ${conj.items.length}${conj.available ? '' : ' (SOCRATES unavailable)'}`);
  const launches = await buildLaunches();
  await fs.writeFile(path.join(OUT_DIR, 'launches.json'), JSON.stringify(launches));
  log(`Wrote launches: ${launches.upcoming.length} upcoming${launches.available ? '' : ' (Launch Library unavailable)'}`);
  const mags = await buildMagnitudes();
  await fs.writeFile(path.join(OUT_DIR, 'magnitudes.json'), JSON.stringify(mags));
  log(`Wrote standard magnitudes: ${mags.mags.length}${mags.available ? '' : ' (qs.mag unavailable; the site estimates brightness from size)'}`);
  const sw = await buildSpaceWeather(ctx);
  await fs.writeFile(path.join(OUT_DIR, 'spaceweather.json'), JSON.stringify(sw));
  log(`Wrote space weather: ${sw.f107.length} days of F10.7, ${sw.kp.length} Kp values${sw.available ? '' : ' (SWPC unavailable)'}`);
  const deep = await buildDeepSpace(ctx);
  await fs.writeFile(path.join(OUT_DIR, 'deepspace.json'), JSON.stringify(deep));
  await writeDetailedHistory(ctx, OUT_DIR);

  const changes = await buildChanges(catalog);
  await fs.writeFile(path.join(OUT_DIR, 'manoeuvres.json'), JSON.stringify(changes.manoeuvres));
  await fs.writeFile(path.join(OUT_DIR, 'breakups.json'), JSON.stringify(changes.breakups));
  log(`Wrote manoeuvres: ${changes.manoeuvres.items.length} in 14 days (${changes.newManoeuvres} new); breakups: ${changes.breakups.items.length}${changes.baseline ? ' (first run: baseline only)' : ''}`);

  // Daily digest, deployments, radio, aurora, launch statistics, classified
  // orbits: all best-effort, so a failure in one never blocks a deploy.
  const safe = async (name, fn, fallback) => {
    try {
      return await fn();
    } catch (err) {
      log(`  ! ${name}: ${err.message}`);
      return fallback;
    }
  };
  const inCatalog = new Set(catalog.objects.map((r) => r[0]));
  const digest = await safe('digest', async () => {
    const decayed = changes.prevEls
      ? Object.keys(changes.prevEls)
          .map(Number)
          .filter((id) => !inCatalog.has(id) && satcat.get(id)?.DECAY_DATE)
          .map((id) => {
            const sc = satcat.get(id);
            return { norad: id, name: sc.OBJECT_NAME, cospar: sc.OBJECT_ID, decay: String(sc.DECAY_DATE).slice(0, 10), type: TYPE[String(sc.OBJECT_TYPE).toUpperCase()] ?? 'U', owner: sc.OWNER };
          })
      : [];
    const siteUrl = process.env.SITE_URL || (process.env.FALLBACK_CATALOG_URL || '').replace(/\/data\/catalog\.json$/, '') || 'https://zer0krypt.github.io/OrbitalObjects';
    const d = await writeDigest(
      ctx,
      OUT_DIR,
      { rows: catalog.objects, prevEls: changes.prevEls, decayed, reentries: reentry.recent, manoeuvres: changes.found, breakups: changes.breakups.items, now: Date.now() },
      siteUrl,
    );
    log(`Wrote digest: ${d.days.length} days, ${d.days[0]?.addedCount ?? 0} new objects today`);
    return d;
  }, { days: [] });
  const deployments = await safe('deployments', () => writeDeployments(ctx, OUT_DIR, catalog.objects), []);
  log(`Wrote deployments: ${deployments.length} recent multi-satellite launches`);
  const radio = await safe('radio', () => buildRadio(ctx, inCatalog), { sats: {}, available: false });
  await fs.writeFile(path.join(OUT_DIR, 'radio.json'), JSON.stringify(radio));
  const aurora = await safe('aurora', () => buildAurora(ctx), { available: false, forecast: null });
  await fs.writeFile(path.join(OUT_DIR, 'aurora.json'), JSON.stringify(aurora));
  log(`Wrote aurora forecast${aurora.available ? ` for ${aurora.forecast}` : ' (OVATION unavailable)'}`);
  const launchStats = await safe('launch statistics', () => buildLaunchStats(ctx, satcat), { available: false, satcat: { years: [] }, recent: null });
  await fs.writeFile(path.join(OUT_DIR, 'launchstats.json'), JSON.stringify(launchStats));
  const classified = await safe('classified', () => buildClassified(ctx, inCatalog), { available: false, objects: [] });
  await fs.writeFile(path.join(OUT_DIR, 'classified.json'), JSON.stringify(classified));

  const status = {
    version: 1,
    generated: new Date().toISOString(),
    durationS: Math.round((Date.now() - started) / 1000),
    sample: false,
    catalog: {
      generated: catalog.generated,
      source: catalog.source,
      objects: catalog.objects.length,
      byType: counts,
      fromSpaceTrack: st ? catalog.objects.filter((r) => st.has(r[0]) && !gp.has(r[0])).length : 0,
      fromCelestrak: catalog.objects.filter((r) => gp.has(r[0])).length,
      oldestEpoch: catalog.objects.reduce((m, r) => (r[3] < m ? r[3] : m), '9999'),
    },
    files: {
      reentry: { upcoming: reentry.upcoming.length, recent: reentry.recent.length, predictions: !!reentry.predictions },
      conjunctions: { items: conj.items.length, available: conj.available },
      launches: { upcoming: launches.upcoming.length, available: launches.available },
      magnitudes: { items: mags.mags.length, available: mags.available },
      manoeuvres: { items: changes.manoeuvres.items.length },
      breakups: { items: changes.breakups.items.length },
      supgp: { objects: catalog.objects.filter((r) => r[22] === 1).length },
      spaceweather: { available: sw.available, kp: sw.kp.length },
      deepspace: { craft: deep.craft.length, available: deep.available },
      radio: { satellites: Object.keys(radio.sats).length, available: radio.available },
      aurora: { available: aurora.available, forecast: aurora.forecast },
      launchstats: { years: launchStats.satcat.years.length, recent: launchStats.recent?.count ?? 0 },
      classified: { objects: classified.objects.length, available: classified.available },
      digest: { days: digest.days.length },
      deployments: { launches: deployments.length },
    },
    snapshots: SNAPSHOT_STATUS,
    spaceTrack: hasSpaceTrack(),
    sources: [...SOURCES.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
  await fs.writeFile(path.join(OUT_DIR, 'status.json'), JSON.stringify(status));
  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/** Manoeuvres and breakups, by comparing with the previous run's catalogue. */
async function buildChanges(catalog) {
  const statePath = path.join(CACHE, 'state-changes.json');
  let prev = null;
  try {
    prev = JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch {
    /* first run */
  }
  const now = Date.now();
  const rows = catalog.objects;
  // A switch between Space-Track and CelesTrak-only changes which debris is
  // listed; comparing across it would look like breakups everywhere.
  const comparable = prev && prev.source === catalog.source && Math.abs(prev.total - rows.length) < rows.length * 0.05;
  const found = comparable ? detectManoeuvres(prev.els, rows, now) : [];
  const manoeuvreLog = mergeManoeuvres(prev?.manoeuvres, found, now);
  const br = detectBreakups(comparable ? prev.counts : null, rows, prev?.breakups, now);
  const state = { t: now, source: catalog.source, total: rows.length, els: elementState(rows), counts: br.counts, manoeuvres: manoeuvreLog, breakups: br.events };
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state));
  const generated = new Date(now).toISOString();
  return {
    baseline: !prev,
    prevEls: comparable ? prev.els : null,
    found,
    newManoeuvres: found.length,
    manoeuvres: { version: 1, generated, available: !!prev, items: manoeuvreLog },
    breakups: { version: 1, generated, available: !!prev, items: br.events },
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
