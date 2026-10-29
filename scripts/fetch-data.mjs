#!/usr/bin/env node
// Builds public/data/catalog.json from public orbital element sources.
//
//   CelesTrak GP groups (always)          -> orbital elements + group tags
//   CelesTrak SATCAT (always)             -> object type, owner, launch, RCS, status
//   Space-Track full GP catalog (optional) -> every tracked object incl. all debris
//       enabled when SPACETRACK_USER and SPACETRACK_PASS are set
//
// Raw responses are cached in .data-cache/ so a failed or rate-limited request
// falls back to the last good copy. As a last resort FALLBACK_CATALOG_URL (the
// currently deployed catalog) is used. With --strict the script exits non-zero
// rather than writing a catalog that is missing or suspiciously small.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS } from './groups.mjs';

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

async function cached(key, fetcher, validate) {
  const file = path.join(CACHE, key);
  try {
    const body = await fetcher();
    if (!validate(body)) throw new Error('response failed validation');
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, body);
    return { body, fresh: true };
  } catch (err) {
    try {
      const body = await fs.readFile(file, 'utf8');
      log(`  ! ${key}: ${err.message} — using cached copy`);
      return { body, fresh: false };
    } catch {
      log(`  ! ${key}: ${err.message} — no cached copy`);
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
        signal: AbortSignal.timeout(90_000),
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

async function fetchSpaceTrack() {
  const user = process.env.SPACETRACK_USER;
  const pass = process.env.SPACETRACK_PASS;
  if (!user || !pass || OFFLINE) {
    log('Space-Track: SPACETRACK_USER/SPACETRACK_PASS not set — skipping full catalog');
    return null;
  }
  const r = await cached(
    'spacetrack-gp.json',
    async () => {
      const login = await fetch('https://www.space-track.org/ajaxauth/login', {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ identity: user, password: pass }),
      });
      if (!login.ok) throw new Error(`login HTTP ${login.status}`);
      const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')])
        .filter(Boolean)
        .map((c) => c.split(';')[0])
        .join('; ');
      const q =
        'https://www.space-track.org/basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-30/orderby/norad_cat_id/format/json';
      return get(q, { headers: { Cookie: cookie } }, 2);
    },
    isJsonArray,
  );
  if (!r) return null;
  const list = JSON.parse(r.body);
  log(`Space-Track: ${list.length} objects${r.fresh ? '' : ' (cached)'}`);
  return new Map(list.map((o) => [Number(o.NORAD_CAT_ID), o]));
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

async function main() {
  const started = Date.now();
  const { gp, tags } = await fetchCelestrakGroups();
  const st = await fetchSpaceTrack();
  const satcat = await fetchSatcat();

  const elements = new Map(gp);
  if (st) for (const [id, o] of st) if (!elements.has(id) || elements.get(id).EPOCH < o.EPOCH) elements.set(id, o);

  const rows = [];
  for (const [id, o] of elements) {
    if (!o.MEAN_MOTION || !o.EPOCH) continue;
    const sc = satcat.get(id);
    if (sc?.DECAY_DATE) continue; // re-entered since this element set
    rows.push(buildRow(o, sc, st?.get(id), tags.get(id)));
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
      'bstar', 'ndot', 'nddot', 'revs', 'elset', 'type', 'owner', 'launch', 'site', 'status', 'rcs', 'groups',
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
  log(`Wrote ${catalog.objects.length} objects ${JSON.stringify(counts)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
