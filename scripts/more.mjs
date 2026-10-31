// Still more data, fetched at build time alongside the catalogue:
//
//   radio.json         amateur radio transmitters per satellite (SatNOGS DB)
//   aurora.json        NOAA SWPC OVATION aurora forecast (a fallback: the site
//                      asks SWPC directly for the newest one)
//   launchstats.json   orbital launches per year by launch country (SATCAT),
//                      plus providers, rockets, failures and booster reuse
//                      for recent years (Launch Library 2, backfilled slowly)
//   classified.json    hobbyist-tracked classified satellites (Mike McCants'
//                      classfd.tle): unofficial, shown only when asked for
//   digest.json        what changed each day: new objects, re-entries,
//   feed.xml           manoeuvres and breakups (and an Atom feed of it)
//   deployments/       element sets of recent multi-satellite launches, day by
//                      day, for the deployment replay
//
// Each function takes the same `ctx` as scripts/extras.mjs.

import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipText } from './magnitudes.mjs';

const DAY = 86400e3;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const parseJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
const epochMs = (s) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? s : `${s}Z`);

async function readState(ctx, name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(ctx.CACHE, name), 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeState(ctx, name, data) {
  await fs.mkdir(ctx.CACHE, { recursive: true });
  await fs.writeFile(path.join(ctx.CACHE, name), JSON.stringify(data));
}

// ---------- radio (SatNOGS DB) ----------
const SATNOGS = 'https://db.satnogs.org/api/transmitters/?format=json';

/** Transmitters from SatNOGS DB: a plain array, or pages of { results, next }. */
export function parseTransmitters(pages) {
  const out = [];
  for (const p of pages) {
    const d = typeof p === 'string' ? parseJson(p) : p;
    if (Array.isArray(d)) out.push(...d);
    else if (Array.isArray(d?.results)) out.push(...d.results);
  }
  return out;
}

export function radioRows(transmitters, inCatalog) {
  const sats = {};
  let n = 0;
  for (const t of transmitters) {
    const id = Number(t.norad_cat_id ?? t.norad_follow_id);
    if (!id || (inCatalog && !inCatalog.has(id))) continue;
    // Dead or unverified transmitters only clutter the list.
    if (t.alive === false || (t.status && t.status !== 'active')) continue;
    const dl = Number(t.downlink_low) || null;
    const ul = Number(t.uplink_low) || null;
    if (!dl && !ul) continue;
    (sats[id] ??= []).push([
      String(t.description ?? '').trim().slice(0, 80) || 'Transmitter',
      dl,
      Number(t.downlink_high) || null,
      ul,
      Number(t.uplink_high) || null,
      String(t.mode ?? '').slice(0, 24),
      Number(t.baud) || null,
      String(t.service ?? '').slice(0, 24),
      String(t.type ?? '').slice(0, 16),
      t.invert ? 1 : 0,
    ]);
    n++;
  }
  // Downlinks first, lowest frequency first.
  for (const k of Object.keys(sats)) sats[k].sort((a, b) => (a[1] ? 0 : 1) - (b[1] ? 0 : 1) || (a[1] ?? a[3]) - (b[1] ?? b[3]));
  return { sats, transmitters: n };
}

export async function buildRadio(ctx, inCatalog, now = Date.now()) {
  const pages = [];
  let url = SATNOGS;
  for (let k = 0; url && k < 20; k++) {
    const r = await ctx.cached(`satnogs-transmitters-${k}.json`, () => ctx.get(url, {}, 2), (t) => !!parseJson(t), 2 * DAY);
    if (!r) break;
    pages.push(r.body);
    const d = parseJson(r.body);
    url = !Array.isArray(d) && typeof d?.next === 'string' ? d.next : null;
  }
  const { sats, transmitters } = radioRows(parseTransmitters(pages), inCatalog);
  ctx.log(`SatNOGS: ${transmitters} transmitters on ${Object.keys(sats).length} satellites`);
  return {
    version: 1,
    generated: new Date(now).toISOString(),
    source: 'SatNOGS DB (CC BY-SA 4.0)',
    available: transmitters > 0,
    fields: ['description', 'downlinkLow', 'downlinkHigh', 'uplinkLow', 'uplinkHigh', 'mode', 'baud', 'service', 'type', 'inverted'],
    sats,
  };
}

// ---------- aurora (NOAA SWPC OVATION) ----------
export const OVATION = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';

/** OVATION's [lon, lat, probability] triples as a 360 × 181 byte grid (lat −90..90 rows). */
export function ovationGrid(d) {
  const coords = d?.coordinates;
  if (!Array.isArray(coords) || coords.length < 1000) return null;
  const grid = new Uint8Array(360 * 181);
  for (const c of coords) {
    const lon = ((Math.round(Number(c[0])) % 360) + 360) % 360;
    const lat = Math.round(Number(c[1]));
    const v = Number(c[2]);
    if (!Number.isFinite(v) || lat < -90 || lat > 90) continue;
    grid[(lat + 90) * 360 + lon] = Math.max(0, Math.min(100, Math.round(v)));
  }
  return grid;
}

export async function buildAurora(ctx, now = Date.now()) {
  const r = await ctx.cached('swpc-ovation.json', () => ctx.get(OVATION, {}, 2), (t) => !!ovationGrid(parseJson(t)));
  const d = r && parseJson(r.body);
  const grid = d && ovationGrid(d);
  return {
    version: 1,
    generated: new Date(now).toISOString(),
    source: 'NOAA SWPC OVATION model',
    available: !!grid,
    observed: d?.['Observation Time'] ?? null,
    forecast: d?.['Forecast Time'] ?? null,
    w: 360,
    h: 181,
    data: grid ? Buffer.from(grid).toString('base64') : '',
  };
}

// ---------- launch statistics ----------
/** Where each SATCAT launch site is: the country that launched from it. */
export const SITE_COUNTRY = {
  AFETR: 'US', AFWTR: 'US', CAS: 'US', ERAS: 'US', KODAK: 'US', KWAJ: 'US', WLPIS: 'US', WRAS: 'US',
  DLS: 'RU', KYMSC: 'RU', OREN: 'RU', PLMSC: 'RU', SADOL: 'RU', SUBL: 'RU', SVOBO: 'RU', TYMSC: 'RU', VOSTO: 'RU',
  JSC: 'CN', TAISC: 'CN', WSC: 'CN', XSC: 'CN', YSLA: 'CN',
  FRGUI: 'EU', HGSTR: 'EU', SNMLP: 'EU',
  SRILR: 'IN',
  KSCUT: 'JP', TANSC: 'JP', TNSTA: 'JP',
  RLLB: 'NZ',
  SEMLS: 'IR', SMTS: 'IR',
  YUN: 'KP',
  NSC: 'KR', JJSLA: 'KR',
  YAVNE: 'IL',
  WOMRA: 'AU',
  SEAL: 'INTL',
};
export const COUNTRY_LABEL = { US: 'United States', RU: 'Russia / USSR', CN: 'China', EU: 'Europe', IN: 'India', JP: 'Japan', NZ: 'New Zealand', IR: 'Iran', KP: 'North Korea', KR: 'South Korea', IL: 'Israel', AU: 'Australia', INTL: 'Sea Launch', XX: 'Other' };

/** Successful orbital launches per year by launch country, from SATCAT designators. */
export function satcatLaunches(satcat) {
  const launches = new Map();
  for (const o of satcat.values()) {
    const m = /^(\d{4})-(\d{3})/.exec(String(o.OBJECT_ID ?? ''));
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    const prev = launches.get(key);
    // The lowest piece letter is the main payload: take its site.
    if (!prev || String(o.OBJECT_ID) < prev.id) launches.set(key, { id: String(o.OBJECT_ID), year: Number(m[1]), site: String(o.LAUNCH_SITE ?? '') });
  }
  const years = new Map();
  for (const l of launches.values()) {
    const c = SITE_COUNTRY[l.site] ?? 'XX';
    const y = years.get(l.year) ?? { total: 0, by: {} };
    y.total++;
    y.by[c] = (y.by[c] ?? 0) + 1;
    years.set(l.year, y);
  }
  return [...years.entries()].sort((a, b) => a[0] - b[0]).map(([y, v]) => [y, v.total, v.by]);
}

const LL2_PREV = 'https://ll.thespacedevs.com/2.3.0/launches/previous/';
const LL2_FROM = '2021-01-01';

/** One Launch Library launch, reduced to what the statistics need. */
export function ll2Launch(l) {
  const cfg = l?.rocket?.configuration ?? {};
  const fam = cfg.families?.[0]?.name ?? cfg.family ?? '';
  const stages = Array.isArray(l?.rocket?.launcher_stage) ? l.rocket.launcher_stage : [];
  const country = l?.pad?.country?.alpha_2_code ?? l?.pad?.location?.country?.alpha_2_code ?? l?.pad?.country_code ?? l?.pad?.location?.country_code ?? '';
  return [
    String(l.id ?? ''),
    String(l.net ?? ''),
    String(l.status?.abbrev ?? l.status?.name ?? ''),
    String(l.launch_service_provider?.name ?? l.lsp_name ?? ''),
    String(cfg.full_name ?? cfg.name ?? ''),
    String(fam),
    String(country).slice(0, 3),
    stages.filter((s) => s?.reused).length,
    stages.length,
    stages.filter((s) => s?.landing?.attempt).length,
    stages.filter((s) => s?.landing?.attempt && s?.landing?.success).length,
  ];
}

/** Fetch a couple of pages of past launches per run, keeping a growing store. */
async function ll2History(ctx, now) {
  const store = await readState(ctx, 'state-ll2-previous.json', { items: {}, backfill: 0, done: false });
  const page = async (key, query) => {
    const r = await ctx.cached(key, () => ctx.get(`${LL2_PREV}?${query}`, {}, 2), (t) => Array.isArray(parseJson(t)?.results));
    return r ? parseJson(r.body) : null;
  };
  // Newest first: picks up new launches and late status changes.
  const latest = await page('ll2-previous-latest.json', `limit=100&mode=detailed&ordering=-net`);
  for (const l of latest?.results ?? []) store.items[l.id] = ll2Launch(l);
  // Then work forward from 2021, one page per run.
  if (!store.done) {
    const back = await page(`ll2-previous-${store.backfill}.json`, `limit=100&mode=detailed&ordering=net&net__gte=${LL2_FROM}&offset=${store.backfill}`);
    if (back?.results?.length) {
      for (const l of back.results) store.items[l.id] = ll2Launch(l);
      store.backfill += back.results.length;
      if (!back.next) store.done = true;
    }
  }
  store.updated = now;
  await writeState(ctx, 'state-ll2-previous.json', store);
  return store;
}

export function ll2Stats(items) {
  const list = Object.values(items).filter((r) => r[1] && /^\d{4}/.test(r[1]));
  if (!list.length) return null;
  list.sort((a, b) => (a[1] < b[1] ? -1 : 1));
  const failed = (r) => /fail/i.test(r[2]);
  const byYear = new Map();
  const prov = new Map();
  const rock = new Map();
  const add = (m, k, r, extra) => {
    const v = m.get(k) ?? { n: 0, f: 0, ...extra };
    v.n++;
    if (failed(r)) v.f++;
    m.set(k, v);
  };
  for (const r of list) {
    const y = Number(r[1].slice(0, 4));
    const v = byYear.get(y) ?? { n: 0, f: 0, reused: 0, stages: 0, landings: 0, landed: 0 };
    v.n++;
    if (failed(r)) v.f++;
    v.reused += r[7];
    v.stages += r[8];
    v.landings += r[9];
    v.landed += r[10];
    byYear.set(y, v);
    if (r[3]) add(prov, r[3], r, { c: r[6] });
    if (r[4]) add(rock, r[4], r, { fam: r[5] });
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, n);
  return {
    from: list[0][1].slice(0, 10),
    to: list[list.length - 1][1].slice(0, 10),
    count: list.length,
    years: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([y, v]) => [y, v.n, v.f, v.reused, v.stages, v.landings, v.landed]),
    providers: top(prov, 16).map(([k, v]) => [k, v.n, v.f, v.c ?? '']),
    rockets: top(rock, 16).map(([k, v]) => [k, v.n, v.f, v.fam ?? '']),
  };
}

export async function buildLaunchStats(ctx, satcat, now = Date.now()) {
  const years = satcat.size ? satcatLaunches(satcat) : [];
  let recent = null;
  try {
    recent = ll2Stats((await ll2History(ctx, now)).items);
  } catch (err) {
    ctx.log(`  ! Launch Library history: ${err.message}`);
  }
  ctx.log(`Launch statistics: ${years.reduce((s, y) => s + y[1], 0)} launches from SATCAT; ${recent ? `${recent.count} recent from Launch Library` : 'no Launch Library history yet'}`);
  return {
    version: 1,
    generated: new Date(now).toISOString(),
    available: years.length > 0 || !!recent,
    countries: COUNTRY_LABEL,
    satcat: { source: 'CelesTrak SATCAT (launches that reached orbit)', years },
    recent: recent ? { source: 'The Space Devs — Launch Library 2', ...recent } : null,
  };
}

// ---------- hobbyist-tracked classified satellites ----------
const CLASSFD = ['https://www.prismnet.com/~mmccants/tles/classfd.zip', 'https://www.mmccants.org/tles/classfd.zip'];

const tleNum = (s) => {
  const t = s.trim();
  if (!t) return 0;
  // "-11606-4" -> -0.11606e-4 (assumed decimal point and exponent).
  const m = /^([+-]?)(\d+)([+-]\d)$/.exec(t);
  if (m) return Number(`${m[1]}0.${m[2]}e${m[3]}`);
  return Number(t);
};

/** Three-line TLE text to element sets (name, line 1, line 2). */
export function parseTle(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const l1 = lines[i];
    const l2 = lines[i + 1];
    if (!/^1 [ \d]{5}/.test(l1) || !/^2 [ \d]{5}/.test(l2)) continue;
    const name = i > 0 && !/^[12] /.test(lines[i - 1]) ? lines[i - 1].replace(/^0 /, '').trim() : '';
    const yy = Number(l1.slice(18, 20));
    const doy = Number(l1.slice(20, 32));
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const epoch = Date.UTC(year, 0, 1) + (doy - 1) * DAY;
    const intl = l1.slice(9, 17).trim();
    const im = /^(\d\d)(\d{3})(\w*)$/.exec(intl);
    out.push({
      norad: Number(l1.slice(2, 7)),
      name: name.replace(/\s{2,}.*$/, '') || `OBJECT ${l1.slice(2, 7).trim()}`,
      cospar: im ? `${Number(im[1]) < 57 ? 20 : 19}${im[1]}-${im[2]}${im[3]}` : '',
      epoch: new Date(epoch).toISOString().replace('Z', ''),
      ndot: Number(l1.slice(33, 43)) || 0,
      nddot: tleNum(l1.slice(44, 52)),
      bstar: tleNum(l1.slice(53, 61)),
      elset: Number(l1.slice(64, 68)) || 0,
      incl: Number(l2.slice(8, 16)),
      raan: Number(l2.slice(17, 25)),
      ecc: Number(`0.${l2.slice(26, 33).trim()}`),
      argp: Number(l2.slice(34, 42)),
      ma: Number(l2.slice(43, 51)),
      n: Number(l2.slice(52, 63)),
      revs: Number(l2.slice(63, 68)) || 0,
    });
    i++;
  }
  return out.filter((e) => e.norad > 0 && e.n > 0 && Number.isFinite(e.incl));
}

const classifiedOwner = (name) => (/^(USA|NROL|NOSS|LACROSSE|MISTY|KH|SDS|TRUMPET|MENTOR|ORION|ONYX|TOPAZ|PAN|X-37)/i.test(name) ? 'US' : /^(COSMOS|KOSMOS|PERSONA|BARS|LOTOS|KONDOR)/i.test(name) ? 'CIS' : /^(YAOGAN|SHIYAN|TJS|TONGXIN|SJ-|SHIJIAN)/i.test(name) ? 'PRC' : /^OFEQ/i.test(name) ? 'ISRA' : 'UNK');

export function classifiedRows(els, inCatalog) {
  return els
    .filter((e) => !inCatalog?.has(e.norad))
    .map((e) => [e.norad, e.name, e.cospar, e.epoch, e.n, e.ecc, e.incl, e.raan, e.argp, e.ma, e.bstar, e.ndot, e.nddot, e.revs, e.elset, 'P', classifiedOwner(e.name), '', '', '?', null, [], 0]);
}

export async function buildClassified(ctx, inCatalog, now = Date.now()) {
  let els = [];
  for (const url of CLASSFD) {
    const r = await ctx.cached(
      'classfd.tle',
      async () => {
        if (process.env.DATA_OFFLINE) throw new Error('offline');
        const res = await fetch(url, { headers: { 'User-Agent': 'OrbitalObjects/1.0' }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.readUInt32LE(0) === 0x04034b50 ? unzipText(buf, /classfd\.tle$/i) : buf.toString('latin1');
      },
      (t) => parseTle(t).length > 20,
      DAY,
    );
    if (r) {
      els = parseTle(r.body);
      break;
    }
  }
  const rows = classifiedRows(els, inCatalog);
  ctx.log(`Classified (hobbyist): ${rows.length} element sets not in the public catalogue`);
  return {
    version: 1,
    generated: new Date(now).toISOString(),
    source: "Mike McCants' classfd.tle: orbits worked out by hobbyist observers",
    available: rows.length > 0,
    fields: ['norad', 'name', 'cospar', 'epoch', 'meanMotion', 'ecc', 'incl', 'raan', 'argp', 'ma', 'bstar', 'ndot', 'nddot', 'revs', 'elset', 'type', 'owner', 'launch', 'site', 'status', 'rcs', 'groups', 'sup'],
    objects: rows,
  };
}

// ---------- daily digest + Atom feed ----------
const DIGEST_DAYS = 30;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Fold this run's changes into the per-day digest.
 * `prevEls` is the previous run's element state (null on the first run or
 * when the catalogue source switched, so nothing looks new).
 */
export function updateDigest(state, { rows, prevEls, decayed, reentries, manoeuvres, breakups, now }) {
  const days = state?.days ?? {};
  const day = (iso) => (days[iso] ??= { added: [], reentered: [], manoeuvres: [], breakups: [] });
  if (prevEls) {
    const today = day(isoDay(now));
    const seen = new Set(today.added.map((a) => a[0]));
    for (const r of rows) if (!prevEls[r[0]] && !seen.has(r[0])) today.added.push([r[0], r[1], r[2], r[15], r[16]]);
  }
  for (const d of decayed ?? []) {
    const iso = /^\d{4}-\d\d-\d\d$/.test(d.decay) ? d.decay : isoDay(now);
    const list = day(iso).reentered;
    if (!list.some((x) => x[0] === d.norad)) list.push([d.norad, d.name, d.cospar, d.type, d.owner]);
  }
  for (const r of reentries ?? []) {
    if (!r.decay || Date.parse(r.decay) < now - DIGEST_DAYS * DAY) continue;
    const list = day(r.decay.slice(0, 10)).reentered;
    if (!list.some((x) => x[0] === r.norad)) list.push([r.norad, r.name, r.cospar ?? '', r.type ?? '', r.owner ?? '']);
  }
  for (const m of manoeuvres ?? []) {
    const list = day(String(m.t).slice(0, 10)).manoeuvres;
    if (!list.some((x) => x[0] === m.norad && x[2] === m.t)) list.push([m.norad, m.name, m.t, m.kind, m.daKm, m.diDeg]);
  }
  for (const b of breakups ?? []) {
    const list = day(String(b.first).slice(0, 10)).breakups;
    const prev = list.find((x) => x[0] === b.cospar);
    if (prev) prev[2] = b.added;
    else list.push([b.cospar, b.parent?.name ?? b.cospar, b.added]);
  }
  const cutoff = isoDay(now - DIGEST_DAYS * DAY);
  for (const k of Object.keys(days)) if (k < cutoff) delete days[k];
  return { days };
}

/** New objects grouped by launch, largest first. */
export function launchesIn(added) {
  const by = new Map();
  for (const a of added) {
    const key = /^\d{4}-\d{3}/.exec(String(a[2]))?.[0];
    if (!key) continue;
    const v = by.get(key) ?? { key, n: 0, payloads: 0, names: [] };
    v.n++;
    if (a[3] === 'P') v.payloads++;
    if (v.names.length < 3) v.names.push(a[1]);
    by.set(key, v);
  }
  return [...by.values()].sort((a, b) => b.n - a.n);
}

export function digestSummary(d) {
  const parts = [];
  const launches = launchesIn(d.added).filter((l) => l.payloads > 0);
  if (d.added.length) parts.push(`${d.added.length} new object${d.added.length === 1 ? '' : 's'} catalogued${launches.length ? ` from ${launches.length} launch${launches.length === 1 ? '' : 'es'}` : ''}`);
  if (d.reentered.length) parts.push(`${d.reentered.length} re-entr${d.reentered.length === 1 ? 'y' : 'ies'}`);
  if (d.manoeuvres.length) parts.push(`${d.manoeuvres.length} manoeuvre${d.manoeuvres.length === 1 ? '' : 's'}`);
  if (d.breakups.length) parts.push(`${d.breakups.length} possible breakup${d.breakups.length === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'A quiet day: nothing new was catalogued and nothing came down.';
}

export function atomFeed(digest, siteUrl) {
  const site = siteUrl.replace(/\/+$/, '');
  const entries = digest.days.slice(0, 14).map((d) => {
    const launches = launchesIn(d.added).filter((l) => l.payloads > 0);
    const li = (s) => `<li>${xml(s)}</li>`;
    const html = [
      `<p>${xml(digestSummary(d))}.</p>`,
      launches.length ? `<h3>New launches</h3><ul>${launches.slice(0, 10).map((l) => li(`${l.key}: ${l.n} objects (${l.names.join(', ')}${l.n > l.names.length ? ', …' : ''})`)).join('')}</ul>` : '',
      d.reentered.length ? `<h3>Re-entries</h3><ul>${d.reentered.slice(0, 20).map((r) => li(`${r[1]} (NORAD ${r[0]})`)).join('')}</ul>` : '',
      d.manoeuvres.length ? `<h3>Manoeuvres</h3><ul>${d.manoeuvres.slice(0, 20).map((m) => li(`${m[1]}: ${m[3] === 'plane' ? 'plane change' : m[3] === 'raise' ? `raised ${Math.abs(m[4]).toFixed(1)} km` : `lowered ${Math.abs(m[4]).toFixed(1)} km`}`)).join('')}</ul>` : '',
      d.breakups.length ? `<h3>Possible breakups</h3><ul>${d.breakups.map((b) => li(`${b[1]} (${b[0]}): ${b[2]} new pieces`)).join('')}</ul>` : '',
    ].join('');
    const updated = d.day === isoDay(Date.parse(digest.generated)) ? digest.generated : `${d.day}T23:59:59Z`;
    return [
      '  <entry>',
      `    <id>${xml(`${site}/#digest=${d.day}`)}</id>`,
      `    <title>${xml(`${d.day}: ${digestSummary(d)}`)}</title>`,
      `    <updated>${updated}</updated>`,
      `    <link rel="alternate" type="text/html" href="${xml(`${site}/#digest=${d.day}`)}"/>`,
      `    <content type="html">${xml(html)}</content>`,
      '  </entry>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '  <title>Orbital Objects: daily digest</title>',
    '  <subtitle>New objects, re-entries, manoeuvres and breakups, from each day’s catalogue updates.</subtitle>',
    `  <id>${xml(`${site}/data/feed.xml`)}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${xml(`${site}/data/feed.xml`)}"/>`,
    `  <link rel="alternate" type="text/html" href="${xml(`${site}/`)}"/>`,
    `  <updated>${digest.generated}</updated>`,
    '  <author><name>Orbital Objects</name></author>',
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}

export function digestJson(state, now, extra = {}) {
  const days = Object.entries(state.days)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, d]) => ({ day, ...d, added: d.added.slice(0, 400), addedCount: d.added.length }));
  return { version: 1, generated: new Date(now).toISOString(), available: days.length > 0, ...extra, days };
}

export async function writeDigest(ctx, outDir, args, siteUrl) {
  const state = updateDigest(await readState(ctx, 'state-digest.json', null), args);
  await writeState(ctx, 'state-digest.json', state);
  const digest = digestJson(state, args.now);
  await fs.writeFile(path.join(outDir, 'digest.json'), JSON.stringify(digest));
  await fs.writeFile(path.join(outDir, 'feed.xml'), atomFeed(digest, siteUrl));
  return digest;
}

// ---------- deployments ----------
const DEPLOY_DAYS = 120;
const MIN_OBJECTS = 4;
const MAX_LAUNCHES = 8;
const ROUND = (v, d) => Number(Number(v).toFixed(d));
export const elsRow = (t, n, e, i, raan, argp, ma, bstar) => [t, ROUND(n, 8), ROUND(e, 7), ROUND(i, 4), ROUND(raan, 4), ROUND(argp, 4), ROUND(ma, 4), Number(Number(bstar).toPrecision(5))];

/** Recent launches with several objects: key YYYY-NNN -> objects. */
export function recentLaunches(rows, now) {
  const by = new Map();
  for (const r of rows) {
    const key = /^\d{4}-\d{3}/.exec(String(r[2]))?.[0];
    const launch = Date.parse(`${r[17]}T00:00:00Z`);
    if (!key || !(now - launch < DEPLOY_DAYS * DAY)) continue;
    const v = by.get(key) ?? { key, launch: r[17], objects: [] };
    v.objects.push(r);
    by.set(key, v);
  }
  return [...by.values()]
    .filter((l) => l.objects.filter((r) => r[15] === 'P').length >= MIN_OBJECTS)
    .sort((a, b) => (a.launch < b.launch ? 1 : -1))
    .slice(0, MAX_LAUNCHES);
}

export function launchName(objects) {
  const pays = objects.filter((r) => r[15] === 'P').map((r) => String(r[1]));
  const stem = (s) => s.replace(/[\s-]*\d+[A-Z]?$/, '').replace(/\s*\(.*\)$/, '').trim();
  const counts = new Map();
  for (const p of pays) counts.set(stem(p), (counts.get(stem(p)) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['Launch', 0];
  const title = top.charAt(0) + top.slice(1).toLowerCase();
  return n === pays.length ? `${title} (${pays.length} satellites)` : `${title} and others (${pays.length} satellites)`;
}

/** Add this run's element sets (only new epochs) to the deployment store. */
export function accumulateDeployments(store, rows, now) {
  const launches = recentLaunches(rows, now);
  const next = { launches: {} };
  for (const l of launches) {
    const prev = store?.launches?.[l.key] ?? { objects: {} };
    const objs = {};
    for (const r of l.objects) {
      const t = epochMs(r[3]);
      if (!Number.isFinite(t)) continue;
      const o = prev.objects[r[0]] ?? { name: r[1], type: r[15], els: [] };
      o.name = r[1];
      const last = o.els[o.els.length - 1];
      // About two element sets a day is plenty for a replay.
      if (!last || t - last[0] > 10 * 3600e3) o.els.push(elsRow(t, r[4], r[5], r[6], r[7], r[8], r[9], r[10]));
      objs[r[0]] = o;
    }
    next.launches[l.key] = { key: l.key, launch: l.launch, name: launchName(l.objects), objects: objs, history: prev.history ?? false };
  }
  return next;
}

/** With Space-Track: the full element history of a launch since lift-off. */
async function launchHistory(ctx, l, now) {
  const q = `class/gp_history/OBJECT_ID/~~${l.key}/EPOCH/>${l.launch}/orderby/EPOCH asc/format/json`;
  const r = await ctx.cached(`deploy-${l.key}.json`, () => ctx.spaceTrackQuery(q, 300_000), (t) => Array.isArray(parseJson(t)), DAY);
  const rows = r ? parseJson(r.body) : null;
  if (!rows?.length) return false;
  const objs = {};
  for (const g of rows) {
    const id = Number(g.NORAD_CAT_ID);
    const t = epochMs(g.EPOCH);
    if (!id || !Number.isFinite(t) || t > now) continue;
    const o = (objs[id] ??= { name: String(g.OBJECT_NAME ?? l.objects[id]?.name ?? id), type: l.objects[id]?.type ?? 'P', els: [] });
    const last = o.els[o.els.length - 1];
    if (!last || t - last[0] > 10 * 3600e3) o.els.push(elsRow(t, g.MEAN_MOTION, g.ECCENTRICITY, g.INCLINATION, g.RA_OF_ASC_NODE, g.ARG_OF_PERICENTER, g.MEAN_ANOMALY, g.BSTAR ?? 0));
  }
  l.objects = { ...l.objects, ...objs };
  return true;
}

export async function writeDeployments(ctx, outDir, rows, now = Date.now()) {
  const store = accumulateDeployments(await readState(ctx, 'state-deploy.json', null), rows, now);
  if (ctx.hasSpaceTrack()) {
    let budget = 2;
    for (const l of Object.values(store.launches)) {
      if (l.history || budget <= 0) continue;
      budget--;
      try {
        l.history = await launchHistory(ctx, l, now);
      } catch (err) {
        ctx.log(`  ! deployment history ${l.key}: ${err.message}`);
      }
    }
  }
  await writeState(ctx, 'state-deploy.json', store);
  return writeDeploymentFiles(outDir, store, now);
}

export async function writeDeploymentFiles(outDir, store, now) {
  const dir = path.join(outDir, 'deployments');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const index = [];
  for (const l of Object.values(store.launches)) {
    const objects = Object.entries(l.objects)
      .map(([norad, o]) => ({ norad: Number(norad), name: o.name, type: o.type, els: o.els }))
      .filter((o) => o.els.length)
      .sort((a, b) => a.norad - b.norad);
    if (!objects.length) continue;
    const t = objects.flatMap((o) => o.els.map((e) => e[0]));
    const from = Math.min(...t);
    const to = Math.max(...t);
    await fs.writeFile(path.join(dir, `${l.key}.json`), JSON.stringify({ version: 1, key: l.key, name: l.name, launch: l.launch, history: !!l.history, fields: ['t', 'n', 'e', 'i', 'raan', 'argp', 'ma', 'bstar'], objects }));
    index.push({ key: l.key, name: l.name, launch: l.launch, objects: objects.length, from: new Date(from).toISOString(), to: new Date(to).toISOString(), history: !!l.history });
  }
  index.sort((a, b) => (a.launch < b.launch ? 1 : -1));
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify({ version: 1, generated: new Date(now).toISOString(), launches: index }));
  return index;
}
