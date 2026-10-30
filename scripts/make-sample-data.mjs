#!/usr/bin/env node
// Generates a SYNTHETIC catalog for offline development (no network needed).
// Orbits follow realistic shells/constellations but are not real element sets;
// the app shows a prominent banner whenever this file is loaded. Production
// builds always use scripts/fetch-data.mjs.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS } from './groups.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'catalog.json');

let seed = 1337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const range = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const MU = 398600.4418;
const RE = 6378.137;
const nFromAlt = (perigee, apogee = perigee) => {
  const a = RE + (perigee + apogee) / 2;
  return (86400 / (2 * Math.PI)) * Math.sqrt(MU / a ** 3);
};
const eccFrom = (perigee, apogee) => (apogee - perigee) / (2 * RE + perigee + apogee);
const G = (key) => GROUPS.findIndex((g) => g[0] === key);

const epoch = new Date().toISOString().replace('Z', '');
const rows = [];
let norad = 60000; // above the hand-placed anchors below
const launchSeq = {};

function cospar(year) {
  launchSeq[year] = (launchSeq[year] || 0) + 1;
  const n = Math.min(launchSeq[year], 999);
  return `${year}-${String(Math.ceil(n / 3)).padStart(3, '0')}${'ABCDEFGHJK'[n % 10]}`;
}

function add(o) {
  const year = o.year ?? Math.floor(range(1990, 2026));
  const month = String(1 + Math.floor(rnd() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
  rows.push([
    o.norad ?? ++norad,
    o.name,
    o.cospar ?? cospar(year),
    epoch,
    o.n,
    o.e ?? range(0.0001, 0.002),
    o.i,
    o.raan ?? range(0, 360),
    o.argp ?? range(0, 360),
    o.ma ?? range(0, 360),
    o.bstar ?? range(1e-5, 4e-4),
    o.ndot ?? range(1e-6, 4e-5),
    0,
    Math.floor(range(100, 60000)),
    999,
    o.type ?? 'P',
    o.owner ?? 'US',
    o.launch ?? `${year}-${month}-${day}`,
    o.site ?? pick(['AFETR', 'AFWTR', 'TYMSC', 'PLMSC', 'JSC', 'FRGUI', 'SRILR', 'TAISC']),
    o.status ?? (o.type && o.type !== 'P' ? '' : pick(['+', '+', '+', '-', '?'])),
    o.rcs ?? null,
    o.groups ?? [],
  ]);
}

// Named anchors
add({ norad: 25544, name: 'ISS (ZARYA)', cospar: '1998-067A', n: 15.4985, e: 0.0006, i: 51.6393, owner: 'ISS', launch: '1998-11-20', site: 'TYMSC', status: '+', rcs: 399, groups: [G('stations'), G('visual')], bstar: 2.6e-4 });
add({ norad: 48274, name: 'CSS (TIANHE)', cospar: '2021-035A', n: 15.6147, e: 0.0005, i: 41.4669, owner: 'PRC', launch: '2021-04-29', site: 'WSC', status: '+', rcs: 50, groups: [G('stations'), G('visual')] });
add({ norad: 20580, name: 'HST', cospar: '1990-037B', n: 15.2876, e: 0.0002, i: 28.4699, owner: 'US', launch: '1990-04-24', site: 'AFETR', status: '+', rcs: 12, groups: [G('science'), G('visual')] });

// Starlink shells
const shells = [
  [550, 53.05, 72, 22], [540, 53.2, 72, 22], [570, 70, 36, 20], [560, 97.6, 10, 40], [530, 43, 28, 40], [480, 53.0, 24, 30],
];
let sl = 1000;
for (const [alt, inc, planes, per] of shells)
  for (let p = 0; p < planes; p++)
    for (let s = 0; s < per; s++)
      add({ name: `STARLINK-${++sl}`, n: nFromAlt(alt + gauss() * 2), i: inc + gauss() * 0.02, raan: (360 * p) / planes, ma: (360 * s) / per + p * 1.3, e: range(0.0001, 0.0003), owner: 'US', year: Math.floor(range(2019, 2026.9)), site: pick(['AFETR', 'AFETR', 'AFWTR']), status: '+', rcs: 3.5, groups: [G('starlink')] });

// Other LEO constellations
for (let p = 0; p < 12; p++) for (let s = 0; s < 49; s++) add({ name: `ONEWEB-${String(p * 49 + s + 10).padStart(4, '0')}`, n: nFromAlt(1200), i: 87.9, raan: (180 * p) / 12, ma: (360 * s) / 49, owner: 'UK', year: Math.floor(range(2019, 2024)), site: pick(['TYMSC', 'FRGUI', 'AFETR', 'SRILR']), status: '+', groups: [G('oneweb')] });
for (let p = 0; p < 6; p++) for (let s = 0; s < 11; s++) add({ name: `IRIDIUM ${100 + p * 11 + s}`, n: nFromAlt(780), i: 86.4, raan: (180 * p) / 6, ma: (360 * s) / 11, owner: 'US', year: Math.floor(range(2017, 2020)), site: 'AFWTR', status: '+', rcs: 4, groups: [G('iridium-NEXT')] });
for (let p = 0; p < 8; p++) for (let s = 0; s < 6; s++) add({ name: `GLOBALSTAR M${String(p * 6 + s + 60).padStart(3, '0')}`, n: nFromAlt(1414), i: 52, raan: 45 * p, ma: 60 * s, owner: 'GLOB', groups: [G('globalstar')] });
for (let p = 0; p < 12; p++) for (let s = 0; s < 18; s++) add({ name: `KUIPER-${String(p * 18 + s + 1).padStart(5, '0')}`, n: nFromAlt(630), i: 51.9, raan: 30 * p, ma: 20 * s, owner: 'US', year: 2025, site: 'AFETR', status: '+', groups: [G('kuiper')] });
for (let p = 0; p < 6; p++) for (let s = 0; s < 18; s++) add({ name: `QIANFAN-${p * 18 + s + 1}`, n: nFromAlt(800), i: 89, raan: 30 * p, ma: 20 * s, owner: 'PRC', year: 2025, site: 'TAISC', status: '+', groups: [G('qianfan')] });

// GNSS
for (let p = 0; p < 6; p++) for (let s = 0; s < 5; s++) add({ name: `GPS BIIF-${p * 5 + s + 1} (PRN ${String(p * 5 + s + 1).padStart(2, '0')})`, n: 2.0056, e: range(0.002, 0.012), i: 55 + gauss() * 0.5, raan: 60 * p + 15, ma: 72 * s, owner: 'US', site: 'AFETR', status: '+', rcs: 10, groups: [G('gps-ops'), G('gnss')] });
for (let p = 0; p < 3; p++) for (let s = 0; s < 8; s++) add({ name: `COSMOS ${2400 + p * 8 + s} (GLONASS-M)`, n: 2.1314, i: 64.8, raan: 120 * p, ma: 45 * s, owner: 'CIS', site: 'PLMSC', status: '+', groups: [G('glo-ops'), G('gnss')] });
for (let p = 0; p < 3; p++) for (let s = 0; s < 9; s++) add({ name: `GSAT0${200 + p * 9 + s} (GALILEO ${p * 9 + s + 5})`, n: 1.7048, i: 56, raan: 120 * p + 40, ma: 40 * s, owner: 'ESA', site: 'FRGUI', status: '+', groups: [G('galileo'), G('gnss')] });
for (let p = 0; p < 3; p++) for (let s = 0; s < 8; s++) add({ name: `BEIDOU-3 M${p * 8 + s + 1}`, n: 1.8623, i: 55, raan: 120 * p + 80, ma: 45 * s, owner: 'PRC', site: 'XSC', status: '+', groups: [G('beidou'), G('gnss')] });

// GEO belt — active (station-kept) and retired (drifting, inclined)
const geoOwners = ['US', 'ITSO', 'SES', 'EUTE', 'PRC', 'CIS', 'JPN', 'IND', 'IM', 'AB', 'BRAZ', 'SKOR', 'FR'];
for (let k = 0; k < 560; k++) add({ name: `${pick(['INTELSAT', 'SES', 'EUTELSAT', 'CHINASAT', 'EXPRESS', 'JCSAT', 'GSAT', 'INMARSAT', 'ARABSAT', 'ASTRA', 'TELSTAR', 'DIRECTV'])} ${Math.floor(range(1, 40))}${pick(['', 'A', 'B', 'C'])}`, n: 1.00272 + gauss() * 0.00002, e: range(0.0001, 0.0005), i: range(0, 0.1), raan: range(0, 360), owner: pick(geoOwners), site: pick(['AFETR', 'FRGUI', 'TYMSC', 'XSC']), status: '+', rcs: 20, groups: [G('geo')] });
for (let k = 0; k < 700; k++) add({ name: `${pick(['GORIZONT', 'RADUGA', 'SATCOM', 'GSTAR', 'ANIK', 'INTELSAT', 'STATSIONAR'])} ${Math.floor(range(1, 40))}`, n: range(0.99, 1.012), e: range(0.0002, 0.006), i: range(0.5, 15), owner: pick(geoOwners), year: Math.floor(range(1970, 2010)), status: '-', groups: [] });
for (let k = 0; k < 300; k++) add({ name: `${pick(['ARIANE 5', 'ATLAS 5 CENTAUR', 'CZ-3B', 'PROTON-M BREEZE-M', 'FALCON 9'])} R/B`, type: 'R', n: range(2.2, 2.4), e: range(0.68, 0.73), i: range(0, 28), owner: pick(['FR', 'US', 'PRC', 'CIS']), status: '' });

// HEO
for (let k = 0; k < 40; k++) add({ name: `MOLNIYA ${Math.floor(range(1, 3))}-${Math.floor(range(10, 99))}`, n: 2.0063, e: range(0.68, 0.74), i: 63.4 + gauss() * 0.4, argp: 270 + gauss() * 8, owner: 'CIS', site: 'PLMSC', year: Math.floor(range(1970, 2000)), status: '-', groups: [G('molniya')] });

// Sun-synchronous Earth observation
const eoOwners = ['US', 'PRC', 'ESA', 'JPN', 'IND', 'FR', 'GER', 'CA', 'SKOR', 'ISRA', 'UK', 'CIS'];
for (let k = 0; k < 1600; k++) {
  const alt = range(450, 820);
  add({ name: `${pick(['FLOCK 4X', 'LEMUR-2', 'SENTINEL', 'JILIN-1', 'YAOGAN', 'WORLDVIEW', 'SKYSAT', 'CARTOSAT', 'ICEYE-X', 'CAPELLA', 'GAOFEN'])}-${Math.floor(range(1, 300))}`, n: nFromAlt(alt), i: 96.5 + (alt - 450) / 370 * 2.3 + gauss() * 0.1, owner: pick(eoOwners), year: Math.floor(range(2005, 2026)), site: pick(['AFWTR', 'TAISC', 'JSC', 'SRILR', 'PLMSC']), groups: [pick([G('resource'), G('planet'), G('spire'), G('weather'), G('cubesat')])] });
}
// Misc LEO payloads
for (let k = 0; k < 1500; k++) {
  const per = range(300, 1500);
  add({ name: `${pick(['COSMOS', 'USA', 'OBJECT', 'TIANQI', 'LEMUR', 'NOAA', 'METEOR-M', 'SAOCOM', 'CUBESAT'])} ${Math.floor(range(1, 2600))}`, n: nFromAlt(per, per + range(0, 300)), e: undefined, i: pick([28.5, 51.6, 65, 74, 82.5, 97.8, range(0, 100)]) + gauss() * 0.4, owner: pick(['US', 'CIS', 'PRC', 'JPN', 'IND', 'ESA', 'UK', 'FR']), year: Math.floor(range(1965, 2026)), status: pick(['+', '-', '-', '?']), groups: [pick([G('science'), G('military'), G('amateur'), G('engineering'), G('other')])] });
}

// Rocket bodies in LEO
for (let k = 0; k < 2100; k++) {
  const per = range(350, 1600);
  add({ name: `${pick(['SL-8', 'SL-16', 'SL-3', 'CZ-4C', 'CZ-2D', 'DELTA 2', 'THOR AGENA D', 'ATLAS CENTAUR', 'PSLV', 'H-2A'])} R/B`, type: 'R', n: nFromAlt(per, per + range(0, 400)), e: undefined, i: pick([71, 74, 82.9, 98.6, 51.6, 63, 28.5, range(0, 110)]) + gauss() * 0.3, owner: pick(['CIS', 'CIS', 'US', 'PRC', 'JPN', 'IND']), year: Math.floor(range(1962, 2026)), rcs: range(2, 15) });
}

// Debris clouds
function cloud(n, name, owner, alt, inc, raan, spread, groupKey, year, des) {
  // The parent first, then its debris under the same international designator.
  add({ name, type: 'P', n: nFromAlt(alt), i: inc, raan, owner, year, cospar: `${des}A`, status: '-', rcs: 2 });
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let k = 0; k < n; k++) {
    const p = alt + gauss() * spread;
    const a = p + Math.abs(gauss()) * spread * 1.5;
    const suffix = (k >= 24 * 24 ? L[Math.floor(k / 576) % 24] : '') + (k >= 24 ? L[Math.floor(k / 24) % 24] : '') + L[k % 24];
    add({ name: `${name} DEB`, type: 'D', n: nFromAlt(p, a), e: eccFrom(p, a), i: inc + gauss() * 0.6, raan: raan + gauss() * 12, owner, year, cospar: `${des}${k < 23 ? L[k + 1] : suffix}`, rcs: range(0.01, 0.3), groups: groupKey ? [G(groupKey)] : [] });
  }
}
cloud(2600, 'FENGYUN 1C', 'PRC', 850, 98.8, 120, 120, 'fengyun-1c-debris', 1999, '1999-025');
cloud(1100, 'COSMOS 2251', 'CIS', 790, 74, 30, 90, 'cosmos-2251-debris', 1993, '1993-036');
cloud(400, 'IRIDIUM 33', 'US', 780, 86.4, 200, 80, 'iridium-33-debris', 1997, '1997-051');
cloud(300, 'COSMOS 1408', 'CIS', 470, 82.6, 300, 60, 'cosmos-1408-debris', 1982, '1982-092');
for (let k = 0; k < 4200; k++) {
  const p = range(400, 1700);
  const a = p + Math.abs(gauss()) * 400;
  add({ name: `${pick(['SL-8', 'NOAA 16', 'DMSP 5D-2 F13', 'CZ-6A', 'PEGASUS', 'NOAA 17', 'THORAD AGENA D', 'DELTA 1', 'SL-14', 'TITAN 3C'])} DEB`, type: 'D', n: nFromAlt(p, a), e: eccFrom(p, a), i: pick([98, 99, 74, 82, 65, 28.5, 71]) + gauss() * 2, owner: pick(['US', 'CIS', 'PRC', 'IND', 'JPN', 'ESA']), year: Math.floor(range(1961, 2025)), rcs: range(0.005, 0.5) });
}
for (let k = 0; k < 150; k++) add({ name: `OBJECT ${String.fromCharCode(65 + (k % 26))}`, type: 'U', n: nFromAlt(range(300, 2000)), i: range(0, 100), owner: 'TBD' });

const catalog = {
  version: 1,
  generated: new Date().toISOString(),
  source: 'Synthetic sample (offline development)',
  sample: true,
  groups: GROUPS.map(([key, label, category]) => ({ key, label, category })),
  fields: ['norad', 'name', 'cospar', 'epoch', 'meanMotion', 'ecc', 'incl', 'raan', 'argp', 'ma', 'bstar', 'ndot', 'nddot', 'revs', 'elset', 'type', 'owner', 'launch', 'site', 'status', 'rcs', 'groups'],
  objects: rows,
};
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(catalog));
console.log(`[sample] wrote ${rows.length} synthetic objects to ${path.relative(ROOT, OUT)}`);

// ---------- history.json: synthetic re-entered objects ----------
const hist = [];
let hNorad = 2;
const hAdd = (o) => {
  hist.push([o.norad ?? ++hNorad + 100000, o.name, o.cospar ?? '', o.epoch ?? `${o.launch}T00:00:00`, o.n, o.e ?? 0.01, o.i, o.raan ?? range(0, 360), o.argp ?? range(0, 360), o.ma ?? range(0, 360), o.type ?? 'P', o.owner ?? 'US', o.launch, o.decay, o.site ?? 'AFETR', o.rcs ?? null, o.approx ?? 0]);
};
// A few real milestones (approximate orbits).
hAdd({ norad: 2, name: 'SPUTNIK 1', cospar: '1957-001B', n: nFromAlt(215, 939), e: eccFrom(215, 939), i: 65.1, owner: 'CIS', launch: '1957-10-04', decay: '1958-01-04', site: 'TYMSC' });
hAdd({ norad: 1, name: 'SL-1 R/B', cospar: '1957-001A', n: nFromAlt(212, 938), e: eccFrom(212, 938), i: 65.1, type: 'R', owner: 'CIS', launch: '1957-10-04', decay: '1957-12-01', site: 'TYMSC' });
hAdd({ norad: 3, name: 'SPUTNIK 2', cospar: '1957-002A', n: nFromAlt(212, 1660), e: eccFrom(212, 1660), i: 65.3, owner: 'CIS', launch: '1957-11-03', decay: '1958-04-14', site: 'TYMSC' });
hAdd({ norad: 4, name: 'EXPLORER 1', cospar: '1958-001A', n: nFromAlt(358, 2550), e: eccFrom(358, 2550), i: 33.2, launch: '1958-02-01', decay: '1970-03-31' });
hAdd({ norad: 6633, name: 'SKYLAB', cospar: '1973-027A', n: nFromAlt(434, 442), i: 50.0, launch: '1973-05-14', decay: '1979-07-11', rcs: 200 });
hAdd({ norad: 16609, name: 'MIR', cospar: '1986-017A', n: nFromAlt(354, 374), i: 51.6, owner: 'CIS', launch: '1986-02-19', decay: '2001-03-23', site: 'TYMSC', rcs: 300 });
// Thousands of generic short- and long-lived objects across the decades.
for (let k = 0; k < 9000; k++) {
  const y = 1958 + Math.floor(Math.pow(rnd(), 0.8) * 67);
  const launch = `${y}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
  const life = Math.exp(range(Math.log(5), Math.log(9000))) * 86400e3;
  const dt = Math.min(Date.parse(launch) + life, Date.now() - 86400e3 * range(1, 400));
  if (dt <= Date.parse(launch)) continue;
  const p = range(150, 600);
  const a = p + Math.abs(gauss()) * 300;
  const type = pick(['P', 'R', 'D', 'D', 'D']);
  hAdd({ name: type === 'D' ? `${pick(['SL-8', 'THOR AGENA', 'COSMOS 1275', 'DELTA 1', 'SL-3'])} DEB` : type === 'R' ? `${pick(['SL-4', 'SL-8', 'CZ-2C', 'DELTA'])} R/B` : `${pick(['COSMOS', 'USA', 'DISCOVERER', 'STARLINK', 'OPS'])} ${Math.floor(range(1, 5000))}`, n: nFromAlt(p, a), e: eccFrom(p, a), i: pick([51.6, 65, 72.9, 81.2, 97.5, 28.5, range(0, 100)]), type, owner: pick(['US', 'CIS', 'CIS', 'PRC', 'JPN', 'IND', 'ESA']), launch, decay: new Date(dt).toISOString().slice(0, 10), approx: rnd() < 0.3 ? 1 : 0 });
}
// A handful of recent re-entries for the re-entry watch.
for (let k = 0; k < 12; k++) {
  const d = new Date(Date.now() - range(1, 29) * 86400e3).toISOString().slice(0, 10);
  hAdd({ name: `${pick(['STARLINK', 'CZ-6A', 'COSMOS', 'FALCON 9'])}-${Math.floor(range(1000, 9999))} ${pick(['', 'R/B', 'DEB'])}`.trim(), n: nFromAlt(140, 180), i: pick([53, 43, 97.5, 70]), type: pick(['P', 'R', 'D']), owner: pick(['US', 'PRC', 'CIS']), launch: `${Math.floor(range(2018, 2026))}-0${1 + Math.floor(rnd() * 8)}-1${Math.floor(rnd() * 9)}`, decay: d });
}
await fs.writeFile(
  path.join(path.dirname(OUT), 'history.json'),
  JSON.stringify({ version: 1, generated: new Date().toISOString(), sample: true, fields: ['norad', 'name', 'cospar', 'epoch', 'meanMotion', 'ecc', 'incl', 'raan', 'argp', 'ma', 'type', 'owner', 'launch', 'decay', 'site', 'rcs', 'approx'], objects: hist }),
);
console.log(`[sample] wrote ${hist.length} synthetic re-entered objects to history.json`);

// ---------- reentry.json: synthetic predictions ----------
// The fastest (lowest) non-payload orbits stand in for decaying objects.
const lowest = rows.filter((r) => r[15] !== 'P').sort((a, b) => b[4] - a[4]).slice(0, 9);
const now = Date.now();
await fs.writeFile(
  path.join(path.dirname(OUT), 'reentry.json'),
  JSON.stringify({
    version: 1,
    generated: new Date(now).toISOString(),
    sample: true,
    predictions: true,
    upcoming: lowest.map((r, k) => ({
      norad: r[0],
      name: r[1],
      cospar: r[2],
      decay: new Date(now + (k * k + 0.4) * 0.9 * 86400e3).toISOString(),
      windowMin: k < 2 ? 60 * (k + 1) : null,
      source: k < 2 ? 'tip' : 'prediction',
      tip: k < 2 ? { lat: range(-50, 50), lon: range(-180, 180), direction: 'ascending', highInterest: k === 0 } : null,
    })),
    recent: hist.slice(-12).sort((a, b) => (a[13] < b[13] ? 1 : -1)).map((r) => ({ norad: r[0], name: r[1], cospar: r[2], decay: r[13], type: r[10], owner: r[11], rcs: r[15] })),
  }),
);
console.log('[sample] wrote synthetic reentry.json');

// ---------- synthetic snapshots ----------
// Every object alive at each planned snapshot time, with its orbit plane
// wound back by J2 nodal precession so planes visibly drift over time.
const { writeSnapshot, snapshotPlan, loadEvents } = await import('./snapshots.mjs');
const J2 = 1.08263e-3;
const all = [
  ...rows.map((r) => ({ norad: r[0], n: r[4], e: r[5], i: r[6], raan: r[7], argp: r[8], ma: r[9], bstar: r[10], launch: r[17], decay: null })),
  ...hist.map((r) => ({ norad: r[0], n: r[4], e: r[5], i: r[6], raan: r[7], argp: r[8], ma: r[9], bstar: 1e-4, launch: r[12], decay: r[13] })),
];
const manifest = [];
for (const item of snapshotPlan(Date.now(), await loadEvents())) {
  const D = item.t;
  const snap = { v: 2, sgp4: true, norad: [], n: [], e: [], i: [], raan: [], argp: [], ma: [], epochOff: [], bstar: [] };
  for (const o of all) {
    if (!o.launch || Date.parse(o.launch) > D || (o.decay && Date.parse(o.decay) < D)) continue;
    const nRad = (o.n * 2 * Math.PI) / 86400;
    const a = Math.cbrt(MU / nRad ** 2);
    const p = a * (1 - o.e * o.e);
    const dRaan = -1.5 * nRad * J2 * (RE / p) ** 2 * Math.cos((o.i * Math.PI) / 180); // rad/s
    const dt = (D - Date.now()) / 1000;
    snap.norad.push(o.norad);
    snap.n.push(o.n);
    snap.e.push(o.e);
    snap.i.push(o.i);
    snap.raan.push(o.raan + ((dRaan * dt) * 180) / Math.PI);
    snap.argp.push(o.argp);
    snap.ma.push(range(0, 360));
    snap.epochOff.push(Math.round(range(-36, 36) * 3600));
    snap.bstar.push(o.bstar);
  }
  if (!snap.norad.length) continue;
  await writeSnapshot(path.dirname(OUT), item.key, snap);
  manifest.push({ key: item.key, t: D, kind: item.kind, sgp4: true });
}
manifest.sort((a, b) => a.t - b.t);
const hpath = path.join(path.dirname(OUT), 'history.json');
const hjson = JSON.parse(await fs.readFile(hpath, 'utf8'));
hjson.snapshots = manifest;
await fs.writeFile(hpath, JSON.stringify(hjson));
console.log(`[sample] wrote ${manifest.length} synthetic snapshots`);

// ---------- conjunctions.json & launches.json (synthetic) ----------
{
  const leo = rows.filter((r) => r[4] > 14);
  const items = [];
  for (let k = 0; k < 14; k++) {
    const a = pick(leo);
    const b = pick(leo);
    if (a === b) continue;
    items.push({
      a: { norad: a[0], name: a[1] },
      b: { norad: b[0], name: b[1] },
      tca: new Date(Date.now() + range(0.3, 7) * 86400e3).toISOString(),
      rangeKm: Number(range(0.02, 4).toFixed(3)),
      speedKms: Number(range(0.5, 15).toFixed(2)),
      prob: Number((10 ** range(-7, -2.5)).toExponential(2)),
    });
  }
  items.sort((x, y) => x.rangeKm - y.rangeKm);
  await fs.writeFile(path.join(path.dirname(OUT), 'conjunctions.json'), JSON.stringify({ version: 1, generated: new Date().toISOString(), source: 'CelesTrak SOCRATES', sample: true, available: true, items }));

  const pads = [
    ['Space Launch Complex 40', 'Cape Canaveral SFS, FL, USA', 'US', 28.5619, -80.5774, 'SpaceX', 'Falcon 9 Block 5'],
    ['Launch Complex 39A', 'Kennedy Space Center, FL, USA', 'US', 28.6082, -80.6041, 'SpaceX', 'Falcon Heavy'],
    ['Space Launch Complex 4E', 'Vandenberg SFB, CA, USA', 'US', 34.6321, -120.6106, 'SpaceX', 'Falcon 9 Block 5'],
    ['Site 31/6', 'Baikonur Cosmodrome, Kazakhstan', 'KZ', 45.996, 63.564, 'Roscosmos', 'Soyuz 2.1a'],
    ['Launch Area 4 (SLS-2)', 'Jiuquan, China', 'CN', 40.958, 100.291, 'CASC', 'Long March 2D'],
    ['Launch Complex 201', 'Wenchang, China', 'CN', 19.614, 110.951, 'CASC', 'Long March 7'],
    ['Rocket Lab Launch Complex 1A', 'Mahia Peninsula, New Zealand', 'NZ', -39.262, 177.865, 'Rocket Lab', 'Electron'],
    ['Second Launch Pad', 'Satish Dhawan Space Centre, India', 'IN', 13.733, 80.235, 'ISRO', 'PSLV-XL'],
  ];
  const upcoming = [];
  for (let k = 0; k < 12; k++) {
    const [pad, location, country, lat, lon, provider, rocket] = pads[k % pads.length];
    // The first one is about to go, so launch day mode has something to show.
    const net = new Date(k === 0 ? Math.ceil((Date.now() + 25 * 60e3) / 60e3) * 60e3 : Date.now() + (k * 1.6 + range(0.1, 1)) * 86400e3).toISOString();
    upcoming.push({ id: `sample-${k}`, name: `${rocket} | Sample mission ${k + 1}`, net, windowStart: net, windowEnd: net, status: k < 3 ? 'Go' : 'TBC', statusName: k < 3 ? 'Go for Launch' : 'To Be Confirmed', provider, rocket, mission: `Sample mission ${k + 1}`, missionType: pick(['Communications', 'Earth Science', 'Navigation', 'Resupply']), description: 'Synthetic launch for offline development.', orbit: k === 0 ? 'LEO' : pick(['LEO', 'SSO', 'GTO', 'MEO']), pad, location, country, lat, lon, image: null, webcast: k === 0, vidUrl: null, infoUrl: null });
  }
  await fs.writeFile(path.join(path.dirname(OUT), 'launches.json'), JSON.stringify({ version: 1, generated: new Date().toISOString(), source: 'The Space Devs — Launch Library 2', sample: true, available: true, upcoming }));
  console.log('[sample] wrote synthetic conjunctions.json and launches.json');
}

// ---------- manoeuvres.json, breakups.json, status.json (synthetic) ----------
{
  const dir = path.dirname(OUT);
  const gen = new Date().toISOString();
  const payloads = rows.filter((r) => r[15] === 'P');
  const items = [];
  for (let k = 0; k < 40; k++) {
    const r = pick(payloads);
    const t = Date.now() - range(0.1, 13) * 86400e3;
    const plane = rnd() < 0.15;
    const da = plane ? range(-0.3, 0.3) : (rnd() < 0.7 ? 1 : -1) * range(0.9, 12);
    const di = plane ? (rnd() < 0.5 ? 1 : -1) * range(0.02, 0.2) : range(-0.004, 0.004);
    items.push({ norad: r[0], name: r[1], t: new Date(t).toISOString(), prev: new Date(t - range(0.3, 2) * 86400e3).toISOString(), daKm: Number(da.toFixed(2)), diDeg: Number(di.toFixed(4)), dvMs: Number((plane ? Math.abs(di) * 130 : Math.abs(da) * 0.55).toFixed(2)), kind: plane ? 'plane' : da > 0 ? 'raise' : 'lower', found: gen });
  }
  items.sort((a, b) => (a.t < b.t ? 1 : -1));
  await fs.writeFile(path.join(dir, 'manoeuvres.json'), JSON.stringify({ version: 1, generated: gen, sample: true, available: true, items }));

  // Breakups: the launches with the most debris in the sample.
  const deb = new Map();
  for (const r of rows) {
    const k = String(r[2]).slice(0, 8);
    if (!/^\d{4}-\d{3}$/.test(k)) continue;
    if (r[15] === 'D') deb.set(k, (deb.get(k) || 0) + 1);
  }
  const events = [...deb.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n], j) => {
      const parent = rows.find((r) => r[2] === `${k}A`) ?? rows.find((r) => String(r[2]).startsWith(k) && r[15] !== 'D');
      const first = new Date(Date.now() - (j * 23 + range(1, 9)) * 86400e3).toISOString();
      return { cospar: k, parent: parent ? { norad: parent[0], name: parent[1], type: parent[15], owner: parent[16] } : null, before: Math.round(n * 0.4), added: n - Math.round(n * 0.4), total: n, first, last: gen };
    });
  await fs.writeFile(path.join(dir, 'breakups.json'), JSON.stringify({ version: 1, generated: gen, sample: true, available: true, items: events }));

  const byType = rows.reduce((m, r) => ((m[r[15]] = (m[r[15]] || 0) + 1), m), {});
  const src = (key, h, ok = true) => ({ key, ok, fresh: ok && h < 0.5, fetchedAt: ok ? new Date(Date.now() - h * 3600e3).toISOString() : null, ...(ok ? {} : { error: 'offline' }) });
  await fs.writeFile(
    path.join(dir, 'status.json'),
    JSON.stringify({
      version: 1,
      generated: gen,
      durationS: 0,
      sample: true,
      catalog: { generated: gen, source: 'Synthetic sample', objects: rows.length, byType, fromSpaceTrack: 0, fromCelestrak: rows.length, oldestEpoch: epoch },
      files: {
        reentry: { upcoming: 9, recent: 0, predictions: true },
        conjunctions: { items: 14, available: true },
        launches: { upcoming: 12, available: true },
        magnitudes: { items: 0, available: false },
        manoeuvres: { items: items.length },
        breakups: { items: events.length },
      },
      snapshots: { planned: manifest.length + 8, available: manifest.length, sgp4: manifest.length, fetchedThisRun: 0, budget: 16, spaceTrack: false },
      spaceTrack: false,
      sources: [src('gp-active.json', 0.1), src('satcat.csv', 0.1), src('socrates-sort-minRange.csv', 0.2), src('ll2-upcoming-23.json', 6, true), src('qs.mag.txt', 0, false)],
    }),
  );
  console.log('[sample] wrote synthetic manoeuvres.json, breakups.json and status.json');
}
