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
// Molniya (critical inclination, apogee over the north) and QZSS (tilted, eccentric geosynchronous).
for (let k = 0; k < 8; k++) add({ name: `MOLNIYA 1-${80 + k}`, n: 2.0064, e: range(0.68, 0.74), i: 63.4 + gauss() * 0.4, raan: 45 * k, argp: 270 + gauss() * 4, ma: range(0, 360), owner: 'CIS', site: 'PKMTR', status: '-', rcs: 8, groups: [G('molniya')], year: Math.floor(range(1985, 2004)) });
for (let k = 0; k < 4; k++) add({ name: `QZS-${k + 1} (MICHIBIKI-${k + 1})`, n: 1.0027, e: 0.075, i: 41 + gauss() * 0.5, raan: 90 * k + 20, argp: 270, ma: 90 * k, owner: 'JPN', site: 'TNSTA', status: '+', rcs: 12, groups: [G('gnss')], year: 2010 + k * 3 });
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

// ---------- recent launches: a Starlink train and two deployments ----------
// Element sets twice a day since launch, so the deployment replay has a story:
// satellites released low, checked out, then raised (or not) to their shells.
const DAYMS = 86400e3;
const NOW = Date.now();
const J2c = 1.08263e-3;
const nodeRate = (alt, inc) => {
  const a = RE + alt;
  const n = Math.sqrt(MU / a ** 3);
  return (-1.5 * n * J2c * (RE / a) ** 2 * Math.cos((inc * Math.PI) / 180) * 180) / Math.PI; // deg/s
};
const meanMotionDeg = (alt) => (Math.sqrt(MU / (RE + alt) ** 3) * 180) / Math.PI; // deg/s
const deployStore = { launches: {} };
function deployment({ key, launchMs, inc, raan0, sats, altAt, name, type = 'P', groups = [], owner = 'US', site = 'AFETR', rcs = 3 }) {
  const launch = new Date(launchMs).toISOString().slice(0, 10);
  const objects = {};
  sats.forEach((sat, k) => {
    const id = sat.norad;
    let alt = altAt(sat, launchMs + 3600e3);
    let raan = raan0;
    let u = sat.u0;
    const els = [];
    const step = 3600e3;
    let last = -Infinity;
    for (let t = launchMs + 3600e3; t <= NOW; t += step) {
      alt = altAt(sat, t);
      if (alt < 140) break;
      raan += nodeRate(alt, inc) * (step / 1000);
      u += meanMotionDeg(alt) * (step / 1000);
      if (t - last >= 12 * 3600e3 || t + step > NOW) {
        last = t;
        const n = nFromAlt(alt);
        els.push([t, Number(n.toFixed(8)), 0.00015, inc, Number((((raan % 360) + 360) % 360).toFixed(4)), 0, Number((((u % 360) + 360) % 360).toFixed(4)), 2e-4]);
      }
    }
    objects[id] = { name: sat.name, type, els };
    const e = els[els.length - 1];
    if (e && altAt(sat, NOW) >= 140) add({ norad: id, name: sat.name, cospar: `${key}${'ABCDEFGHJKLMNPQRSTUVWXYZ'[k % 24]}${k >= 24 ? 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(k / 24) - 1] : ''}`, n: e[1], e: e[2], i: e[3], raan: e[4], argp: 0, ma: e[6], owner, launch, site, status: '+', rcs, groups });
  });
  deployStore.launches[key] = { key, launch, name, objects, history: true };
}
{
  const year = new Date(NOW).getUTCFullYear();
  // 40 days ago: 22 Starlinks released at ~290 km; most climb to 550 km after checkout, two never do.
  const L1 = Math.floor((NOW - 40 * DAYMS) / DAYMS) * DAYMS + 0.15 * DAYMS;
  deployment({
    key: `${year}-901`,
    launchMs: L1,
    inc: 43,
    raan0: 210,
    name: 'Starlink (22 satellites)',
    groups: [G('starlink')],
    sats: Array.from({ length: 22 }, (_, k) => ({ norad: 69001 + k, name: `STARLINK-${32100 + k}`, u0: -k * 0.3, wait: range(3, 16) * DAYMS, rate: range(7, 10), fail: k === 7 || k === 15 })),
    altAt: (s, t) => {
      const age = t - L1;
      if (s.fail) return 290 - 0.6 * (age / DAYMS) - 0.004 * (age / DAYMS) ** 2;
      if (age < s.wait) return 290 - 0.3 * (age / DAYMS);
      return Math.min(550, 290 - 0.3 * (s.wait / DAYMS) + s.rate * ((age - s.wait) / DAYMS));
    },
  });
  // 25 days ago: a rideshare to a 525 km sun-synchronous orbit; small differences in release speed spread them out.
  const L2 = Math.floor((NOW - 25 * DAYMS) / DAYMS) * DAYMS + 0.8 * DAYMS;
  const ride = ['FLOCK 4Y', 'LEMUR-2', 'ICEYE-X', 'CAPELLA', 'KINEIS', 'TYVAK', 'UMBRA', 'SPIRE'];
  deployment({
    key: `${year}-902`,
    launchMs: L2,
    inc: 97.5,
    raan0: 75,
    name: 'Rideshare (30 satellites)',
    groups: [G('cubesat')],
    owner: 'US',
    site: 'AFWTR',
    rcs: 0.1,
    sats: Array.from({ length: 30 }, (_, k) => ({ norad: 69101 + k, name: `${ride[k % ride.length]}-${100 + k}`, u0: -k * 0.05, dAlt: gauss() * 2.5 })),
    altAt: (s, t) => 525 + s.dAlt - 0.02 * ((t - L2) / DAYMS),
  });
  // 3 days ago: 24 Starlinks still in a tight line at 300 km, the "train" people report as UFOs.
  const L3 = Math.floor((NOW - 3 * DAYMS) / DAYMS) * DAYMS + 0.2 * DAYMS;
  deployment({
    key: `${year}-903`,
    launchMs: L3,
    inc: 53.2,
    raan0: (((NOW / DAYMS) * 37) % 360),
    name: 'Starlink (24 satellites)',
    groups: [G('starlink')],
    sats: Array.from({ length: 24 }, (_, k) => ({ norad: 69201 + k, name: `STARLINK-${33400 + k}`, u0: -k * 0.22 })),
    altAt: () => 300,
  });
}

const catalog = {
  version: 1,
  generated: new Date().toISOString(),
  source: 'Synthetic sample (offline development)',
  sample: true,
  groups: GROUPS.map(([key, label, category]) => ({ key, label, category })),
  fields: ['norad', 'name', 'cospar', 'epoch', 'meanMotion', 'ecc', 'incl', 'raan', 'argp', 'ma', 'bstar', 'ndot', 'nddot', 'revs', 'elset', 'type', 'owner', 'launch', 'site', 'status', 'rcs', 'groups', 'sup'],
  // Big fleets get operator-supplied (SupGP) orbits in the real pipeline.
  objects: rows.map((r) => [...r, r[21].some((g) => [G('starlink'), G('oneweb'), G('gps-ops')].includes(g)) ? 1 : 0]),
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
const altSnaps = [];
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
  altSnaps.push({ t: D, snap });
  manifest.push({ key: item.key, t: D, kind: item.kind, sgp4: true });
}
manifest.sort((a, b) => a.t - b.t);
{
  const { writeAltHistory } = await import('./extras.mjs');
  altSnaps.sort((a, b) => a.t - b.t);
  const alt = await writeAltHistory(path.dirname(OUT), altSnaps);
  console.log(`[sample] wrote altitude history for ${alt.objects} objects`);
}
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
        supgp: { objects: rows.filter((r) => r[21].some((g) => [G('starlink'), G('oneweb'), G('gps-ops')].includes(g))).length },
        spaceweather: { available: true, kp: 80 },
        deepspace: { craft: 10, available: true },
        radio: { satellites: 62, available: true },
        aurora: { available: true, forecast: new Date(Date.now() + 40 * 60e3).toISOString() },
        launchstats: { years: 70, recent: 1400 },
        classified: { objects: 16, available: true },
        digest: { days: 14 },
        deployments: { launches: 3 },
      },
      snapshots: { planned: manifest.length + 8, available: manifest.length, sgp4: manifest.length, fetchedThisRun: 0, budget: 16, spaceTrack: false },
      spaceTrack: false,
      sources: [src('gp-active.json', 0.1), src('satcat.csv', 0.1), src('socrates-sort-minRange.csv', 0.2), src('ll2-upcoming-23.json', 6, true), src('qs.mag.txt', 0, false)],
    }),
  );
  console.log('[sample] wrote synthetic manoeuvres.json, breakups.json and status.json');
}

// ---------- prediction histories, launch details, space weather, deep space, daily altitudes (synthetic) ----------
{
  const dir = path.dirname(OUT);
  const now = Date.now();
  const H = 3600e3;
  const D = 86400e3;
  const DEG = Math.PI / 180;

  // Each close approach: how earlier builds predicted it (every 6 hours, converging).
  const conj = JSON.parse(await fs.readFile(path.join(dir, 'conjunctions.json'), 'utf8'));
  for (const c of conj.items) {
    const n = 3 + Math.floor(rnd() * 6);
    const hist = [];
    let r = c.rangeKm * range(1.5, 6);
    for (let k = n; k >= 1; k--) {
      hist.push({ t: new Date(now - k * 6 * H).toISOString(), tca: new Date(Date.parse(c.tca) + gauss() * 20e3 * k).toISOString(), rangeKm: Number(r.toFixed(3)), prob: c.prob ? Number((c.prob * range(0.2, 1.4)).toExponential(2)) : null });
      r = c.rangeKm + (r - c.rangeKm) * range(0.3, 0.8) + gauss() * c.rangeKm * 0.1;
      r = Math.max(0.005, r);
    }
    hist.push({ t: new Date(now).toISOString(), tca: c.tca, rangeKm: c.rangeKm, prob: c.prob });
    c.history = hist;
  }
  await fs.writeFile(path.join(dir, 'conjunctions.json'), JSON.stringify(conj));

  // The first launch: a Falcon 9 with a published timeline and a drone-ship landing.
  const ll = JSON.parse(await fs.readFile(path.join(dir, 'launches.json'), 'utf8'));
  ll.upcoming[0].name = 'Falcon 9 Block 5 | Starlink Group 10-99';
  ll.upcoming[0].mission = 'Starlink Group 10-99';
  ll.upcoming[0].timeline = [
    { abbrev: 'MAXQ', name: 'Maximum dynamic pressure', t: 72 },
    { abbrev: 'MECO', name: 'Main engine cutoff', t: 148 },
    { abbrev: 'S2 Ignition', name: 'Second stage ignition', t: 159 },
    { abbrev: 'Fairing', name: 'Fairing deploy', t: 175 },
    { abbrev: 'SECO-1', name: 'Second engine cutoff', t: 525 },
    { abbrev: 'Landing', name: 'First stage landing', t: 510 },
    { abbrev: 'Deploy', name: 'Payload deploy', t: 3780 },
  ].sort((a, b) => a.t - b.t);
  ll.upcoming[0].landing = { name: 'A Shortfall of Gravitas', abbrev: 'ASOG', lat: 32.1, lon: -75.1, downrangeKm: 600, type: 'ASDS' };
  await fs.writeFile(path.join(dir, 'launches.json'), JSON.stringify(ll));

  // Space weather: cycle 23 peaked ~2001, 24 ~2014, 25 ~2024.
  const peaks = [2001.0, 2014.2, 2024.8];
  const amp = [180, 115, 160];
  const ssnAt = (y) => peaks.reduce((m, p, i) => m + amp[i] * Math.exp(-(((y - p) / 2.6) ** 2)), 0) + 4;
  const f107 = (ssn) => 63.7 + 0.728 * ssn + 0.00089 * ssn * ssn;
  const cycle = [];
  for (let y = 1996; y < 2026 + 10 / 12; y += 1 / 12) {
    const ssn = Math.max(0, ssnAt(y) * range(0.8, 1.2));
    const m = `${Math.floor(y)}-${String(Math.round((y % 1) * 12) + 1).padStart(2, '0')}`;
    if (!cycle.length || cycle[cycle.length - 1][0] !== m) cycle.push([m, Number(ssn.toFixed(1)), Number(f107(ssn).toFixed(1))]);
  }
  const predicted = [];
  for (let k = 1; k <= 36; k++) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() + k);
    const y = d.getUTCFullYear() + d.getUTCMonth() / 12;
    predicted.push([d.toISOString().slice(0, 7), Number(ssnAt(y).toFixed(1)), Number(f107(ssnAt(y)).toFixed(1))]);
  }
  const daily = [];
  for (let k = 119; k >= 0; k--) {
    const t = now - k * D;
    const y = new Date(t).getUTCFullYear() + new Date(t).getUTCMonth() / 12;
    daily.push([new Date(t).toISOString().slice(0, 10), Number((f107(ssnAt(y)) + 25 * Math.sin((k / 27) * 2 * Math.PI) + gauss() * 8).toFixed(1))]);
  }
  const kp = [];
  const t0 = Math.floor(now / (3 * H)) * 3 * H;
  for (let t = t0 - 7 * D; t <= t0 + 3 * D; t += 3 * H) {
    // A storm two days ago, and an active spell forecast for tomorrow.
    const storm = 6.3 * Math.exp(-(((t - (now - 2 * D)) / (9 * H)) ** 2)) + 3.2 * Math.exp(-(((t - (now + D)) / (12 * H)) ** 2));
    kp.push([new Date(t).toISOString(), Number(Math.min(9, Math.max(0, 1.6 + storm + gauss() * 0.6)).toFixed(1)), t <= now]);
  }
  await fs.writeFile(path.join(dir, 'spaceweather.json'), JSON.stringify({ version: 1, generated: new Date(now).toISOString(), source: 'NOAA Space Weather Prediction Center', sample: true, available: true, f107: daily, cycle, predicted, kp }));

  // Beyond Earth orbit: halo orbits around L1/L2 and orbiters around the Moon.
  const jd = (ms) => ms / D + 2440587.5;
  const sunDir = (ms) => {
    const n = jd(ms) - 2451545;
    const L = (280.46 + 0.9856474 * n) * DEG;
    const g = (357.528 + 0.9856003 * n) * DEG;
    const lam = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
    const eps = 23.439 * DEG;
    return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
  };
  const moonPos = (ms) => {
    const T = (jd(ms) - 2451545) / 36525;
    const sn = (a, b) => Math.sin((a + b * T) * DEG);
    const cs = (a, b) => Math.cos((a + b * T) * DEG);
    const lon = (218.32 + 481267.881 * T + 6.29 * sn(135.0, 477198.87) - 1.27 * sn(259.3, -413335.36) + 0.66 * sn(235.7, 890534.22) + 0.21 * sn(269.9, 954397.74) - 0.19 * sn(357.5, 35999.05) - 0.11 * sn(186.5, 966404.03)) * DEG;
    const lat = (5.13 * sn(93.3, 483202.02) + 0.28 * sn(228.2, 960400.89) - 0.28 * sn(318.3, 6003.15) - 0.17 * sn(217.6, -407332.21)) * DEG;
    const par = (0.9508 + 0.0518 * cs(135.0, 477198.87) + 0.0095 * cs(259.3, -413335.36) + 0.0078 * cs(235.7, 890534.22) + 0.0028 * cs(269.9, 954397.74)) * DEG;
    const r = 6378.14 / Math.sin(par);
    const eps = (23.439 - 0.013 * T) * DEG;
    const xe = r * Math.cos(lat) * Math.cos(lon);
    const ye = r * Math.cos(lat) * Math.sin(lon);
    const ze = r * Math.sin(lat);
    return [xe, ye * Math.cos(eps) - ze * Math.sin(eps), ye * Math.sin(eps) + ze * Math.cos(eps)];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = (a) => {
    const l = Math.hypot(...a);
    return a.map((x) => x / l);
  };
  const halo = (ms, side, ay, az, phase, periodD) => {
    const s = sunDir(ms);
    const ecl = [0, -Math.sin(23.439 * DEG), Math.cos(23.439 * DEG)]; // ecliptic north
    const u = nrm(cross(ecl, s));
    const w = nrm(cross(s, u));
    const th = (ms / D / periodD) * 2 * Math.PI + phase;
    const c = 1.5e6 * side;
    return [0, 1, 2].map((i) => s[i] * (c + 0.1 * ay * Math.cos(2 * th)) + u[i] * ay * Math.sin(th) + w[i] * az * Math.cos(th));
  };
  const lunar = (ms, rKm, incl, phase, periodMin) => {
    const m = moonPos(ms);
    const th = ((ms / 60e3) / periodMin) * 2 * Math.PI + phase;
    return [m[0] + rKm * Math.cos(th), m[1] + rKm * Math.sin(th) * Math.cos(incl * DEG), m[2] + rKm * Math.sin(th) * Math.sin(incl * DEG)];
  };
  const { DEEP_SPACE } = await import('./extras.mjs');
  const series = (fn, start, stop, stepMs, round = 1) => {
    const pos = [];
    for (let t = start; t <= stop; t += stepMs) pos.push(...fn(t).map((v) => Math.round(v / round) * round));
    return { t0: start, step: stepMs, pos };
  };
  const day0 = Math.floor(now / D) * D;
  const craft = DEEP_SPACE.map((c, i) => {
    let fn;
    if (c.where === 'L2') fn = (t) => halo(t, -1, 450e3 + i * 120e3, 300e3 + i * 80e3, i * 1.7, 180);
    else if (c.where === 'L1') fn = (t) => halo(t, 1, 260e3 + i * 70e3, 140e3 + i * 40e3, i * 1.3, 178);
    else fn = (t) => lunar(t, 1737 + (c.short === 'CAPSTONE' ? 30000 : 100 + i * 20), 85 + i, i, c.short === 'CAPSTONE' ? 9360 : 113 + i * 4);
    const lunarC = c.where === 'Moon';
    const s = lunarC ? series(fn, day0 - D, day0 + 3 * D, 10 * 60e3) : series(fn, day0 - 2 * D, day0 + 30 * D, 6 * H);
    return { ...c, ...s, path: lunarC ? null : series(fn, day0 - 90 * D, day0 + 90 * D, D, 10) };
  });
  await fs.writeFile(path.join(dir, 'deepspace.json'), JSON.stringify({ version: 1, generated: new Date(now).toISOString(), source: 'JPL Horizons', sample: true, available: true, craft }));

  // Daily altitude histories: the ISS (decay and reboosts), Hubble (servicing boosts), Tiangong.
  const detailDir = path.join(dir, 'althistory', 'detail');
  await fs.mkdir(detailDir, { recursive: true });
  const daily2 = (startIso, fn) => {
    const pts = [];
    let state = null;
    for (let t = Date.parse(startIso); t <= now; t += D) {
      state = fn(t, state);
      pts.push([new Date(t).toISOString().slice(0, 10), Number(state.p.toFixed(1)), Number(state.a.toFixed(1))]);
    }
    return pts;
  };
  const decayStep = (alt, t) => {
    const y = new Date(t).getUTCFullYear() + new Date(t).getUTCMonth() / 12;
    const sol = ssnAt(y) / 150;
    return 0.04 * (1 + 2.5 * sol) * Math.exp(-(alt - 350) / 60);
  };
  const iss = daily2('1998-11-21', (t, s) => {
    const target = Date.parse('2011-01-01') < t ? 410 : 360;
    let alt = s ? s.alt - decayStep(s.alt, t) : 340;
    if (alt < target - 15 && rnd() < 0.08) alt += range(4, 12);
    return { alt, p: alt - 4, a: alt + 4 };
  });
  const boosts = ['1993-12-10', '1997-02-19', '1999-12-27', '2002-03-09', '2009-05-18'].map(Date.parse);
  // Hubble: 615 km at launch, sinking faster as it gets lower, boosted a little on each servicing visit.
  const hstStart = Date.parse('1990-04-25');
  const hst = daily2('1990-04-25', (t) => {
    const f = (t - hstStart) / (now - hstStart);
    const alt = 615 - 150 * f ** 1.7 + 4 * boosts.filter((b) => t >= b).length;
    return { alt, p: alt - 3, a: alt + 3 };
  });
  const css = daily2('2021-04-30', (t, s) => {
    let alt = s ? s.alt - decayStep(s.alt, t) : 340;
    if (alt < 375 && rnd() < 0.05) alt += range(5, 15);
    return { alt, p: alt - 3, a: alt + 3 };
  });
  for (const [id, points] of [
    [25544, iss],
    [20580, hst],
    [48274, css],
  ])
    await fs.writeFile(path.join(detailDir, `${id}.json`), JSON.stringify({ norad: id, source: 'Synthetic sample (daily)', points }));
  await fs.writeFile(path.join(detailDir, 'index.json'), JSON.stringify([25544, 20580, 48274]));
  console.log('[sample] wrote prediction histories, launch details, spaceweather.json, deepspace.json and daily altitude histories');
}

// ---------- radio, aurora, launch statistics, classified, digest, deployments (synthetic) ----------
{
  const dir = path.dirname(OUT);
  const now = Date.now();
  const more = await import('./more.mjs');

  // Radio: the ISS's voice and packet radio, and beacons on amateur and SatNOGS-group satellites.
  const sats = {};
  const tx = (norad, list) => (sats[norad] = list);
  tx(25544, [
    ['Mode V/U FM voice repeater', 437800000, null, 145990000, null, 'FM', null, 'Amateur', 'Transceiver', 0],
    ['APRS digipeater', 145825000, null, 145825000, null, 'AFSK', 1200, 'Amateur', 'Transceiver', 0],
    ['FM voice (ARISS contacts)', 145800000, null, null, null, 'FM', null, 'Amateur', 'Transmitter', 0],
  ]);
  tx(48274, [['Telemetry beacon', 145825000, null, null, null, 'FM', null, 'Amateur', 'Transmitter', 0]]);
  const amateur = rows.filter((r) => r[21].includes(G('amateur')) || r[21].includes(G('cubesat'))).slice(0, 60);
  for (const r of amateur) {
    const f = Math.round(range(435.1, 437.9) * 200) * 5000;
    const list = [['Telemetry beacon', f, null, null, null, pick(['GMSK', 'BPSK', 'CW', 'AFSK', 'GFSK']), pick([1200, 2400, 4800, 9600, null]), 'Amateur', 'Transmitter', 0]];
    if (rnd() < 0.25) list.push(['Linear transponder', f - 20000, f + 10000, 145950000, 145980000, 'SSB', null, 'Amateur', 'Transponder', 1]);
    tx(r[0], list);
  }
  await fs.writeFile(path.join(dir, 'radio.json'), JSON.stringify({ version: 1, generated: new Date(now).toISOString(), source: 'SatNOGS DB (CC BY-SA 4.0)', sample: true, available: true, fields: ['description', 'downlinkLow', 'downlinkHigh', 'uplinkLow', 'uplinkHigh', 'mode', 'baud', 'service', 'type', 'inverted'], sats }));

  // Aurora: an oval ~20° from each geomagnetic pole, brighter on the night side (a moderately active night).
  const grid = new Uint8Array(360 * 181);
  const DEG = Math.PI / 180;
  const poleN = [80.7 * DEG, -72.7 * DEG];
  const sunLon = ((180 - ((now % 86400e3) / 86400e3) * 360) + 540) % 360 - 180; // sub-solar longitude
  for (let lat = -90; lat <= 90; lat++)
    for (let lon = 0; lon < 360; lon++) {
      const la = lat * DEG;
      const lo = lon * DEG;
      const c = Math.sin(la) * Math.sin(poleN[0]) + Math.cos(la) * Math.cos(poleN[0]) * Math.cos(lo - poleN[1]);
      const mlat = Math.asin(Math.max(-1, Math.min(1, c))) / DEG; // geomagnetic latitude
      const night = 0.5 - 0.5 * Math.cos((((lon - sunLon) % 360) + 360) % 360 * DEG); // 1 at local midnight
      const band = Math.exp(-(((Math.abs(mlat) - (66 - 3 * night)) / (3 + 2 * night)) ** 2));
      grid[(lat + 90) * 360 + lon] = Math.round(Math.min(100, (12 + 55 * night) * band * (lat >= 0 ? 1 : 0.8)));
    }
  await fs.writeFile(path.join(dir, 'aurora.json'), JSON.stringify({ version: 1, generated: new Date(now).toISOString(), source: 'NOAA SWPC OVATION model', sample: true, available: true, observed: new Date(now - 30 * 60e3).toISOString(), forecast: new Date(now + 40 * 60e3).toISOString(), w: 360, h: 181, data: Buffer.from(grid).toString('base64') }));

  // Launch statistics: from every launch designator in the sample (in orbit and re-entered).
  const satcat = new Map();
  for (const r of rows) satcat.set(r[0], { OBJECT_ID: r[2], LAUNCH_SITE: r[18] });
  for (const r of hist) satcat.set(r[0], { OBJECT_ID: r[2] || `${r[12].slice(0, 4)}-${String(100 + (r[0] % 400)).padStart(3, '0')}A`, LAUNCH_SITE: r[14] });
  const providers = [
    ['SpaceX', 'US', 'Falcon 9 Block 5', 'Falcon'],
    ['China Aerospace Science and Technology Corporation', 'CN', 'Long March 2D', 'Long March 2'],
    ['Rocket Lab', 'NZ', 'Electron', 'Electron'],
    ['Russian Federal Space Agency (ROSCOSMOS)', 'RU', 'Soyuz 2.1b', 'Soyuz'],
    ['Indian Space Research Organization', 'IN', 'PSLV-XL', 'PSLV'],
    ['Arianespace', 'EU', 'Ariane 62', 'Ariane'],
    ['United Launch Alliance', 'US', 'Vulcan VC2S', 'Vulcan'],
    ['Japan Aerospace Exploration Agency', 'JP', 'H3-22S', 'H3'],
    ['Galactic Energy', 'CN', 'Ceres-1', 'Ceres'],
    ['Blue Origin', 'US', 'New Glenn', 'New Glenn'],
  ];
  const items = {};
  let id = 0;
  for (let y = 2021; y <= new Date(now).getUTCFullYear(); y++) {
    const yearEnd = Math.min(now, Date.UTC(y + 1, 0, 1));
    const n = Math.round([146, 186, 223, 259, 320, 330][y - 2021] ?? 330) * ((yearEnd - Date.UTC(y, 0, 1)) / (365.25 * 86400e3));
    for (let k = 0; k < n; k++) {
      const p = rnd() < 0.5 ? providers[0] : rnd() < 0.5 ? providers[1] : pick(providers);
      const t = Date.UTC(y, 0, 1) + rnd() * (yearEnd - Date.UTC(y, 0, 1));
      const fail = rnd() < (p[0] === 'SpaceX' ? 0.004 : 0.05);
      const reuse = p[0] === 'SpaceX' ? (rnd() < 0.93 ? 1 : 0) : 0;
      const land = p[0] === 'SpaceX' ? 1 : p[0] === 'Rocket Lab' && rnd() < 0.1 ? 1 : 0;
      items[++id] = [String(id), new Date(t).toISOString(), fail ? 'Failure' : 'Success', p[0], p[2], p[3], p[1], reuse, p[0] === 'SpaceX' ? 2 : 1, land, land && !fail && rnd() < 0.985 ? 1 : 0];
    }
  }
  const recent = more.ll2Stats(items);
  await fs.writeFile(path.join(dir, 'launchstats.json'), JSON.stringify({ version: 1, generated: new Date(now).toISOString(), sample: true, available: true, countries: more.COUNTRY_LABEL, satcat: { source: 'CelesTrak SATCAT (launches that reached orbit)', years: more.satcatLaunches(satcat) }, recent: { source: 'The Space Devs — Launch Library 2', ...recent } }));

  // Classified (hobbyist-tracked): reconnaissance and signals satellites the public catalogue leaves out.
  const crow = [];
  const cls = [
    ['USA 224', 97.9, 260, 1000, 2011],
    ['USA 245', 97.9, 270, 980, 2013],
    ['USA 290', 97.9, 255, 1010, 2018],
    ['USA 314', 97.4, 400, 410, 2021],
    ['USA 338', 97.0, 510, 515, 2022],
    ['USA 276', 50.0, 410, 420, 2017],
    ['USA 281', 106.0, 1010, 1205, 2018],
    ['USA 267', 63.4, 1100, 1180, 2016],
    ['USA 184', 63.4, 1200, 39000, 2006],
    ['USA 259', 63.4, 2400, 39200, 2014],
    ['USA 299', 74.0, 600, 600, 2020],
    ['NOSS 3-8 (A)', 63.4, 1010, 1210, 2017],
    ['NOSS 3-8 (C)', 63.4, 1010, 1210, 2017],
    ['USA 326', 57.0, 715, 730, 2022],
    ['COSMOS 2558', 97.3, 430, 445, 2022],
    ['COSMOS 2562', 97.3, 290, 310, 2022],
  ];
  cls.forEach(([name, inc, p, a, y], k) => {
    const mm = nFromAlt(p, a);
    crow.push([37000 + k * 113, name, `${y}-0${10 + k}A`, epoch, mm, eccFrom(p, a), inc, range(0, 360), a > 20000 ? 270 : range(0, 360), range(0, 360), 1e-5, 0, 0, 1000, 999, 'P', name.startsWith('COSMOS') ? 'CIS' : 'US', '', '', '?', null, [], 0]);
  });
  await fs.writeFile(path.join(dir, 'classified.json'), JSON.stringify({ version: 1, generated: new Date(now).toISOString(), source: "Mike McCants' classfd.tle: orbits worked out by hobbyist observers", sample: true, available: true, fields: ['norad', 'name', 'cospar', 'epoch', 'meanMotion', 'ecc', 'incl', 'raan', 'argp', 'ma', 'bstar', 'ndot', 'nddot', 'revs', 'elset', 'type', 'owner', 'launch', 'site', 'status', 'rcs', 'groups', 'sup'], objects: crow }));

  // Digest: the last fortnight, as if a build had run every six hours.
  let state = null;
  const man = JSON.parse(await fs.readFile(path.join(dir, 'manoeuvres.json'), 'utf8')).items;
  const brk = JSON.parse(await fs.readFile(path.join(dir, 'breakups.json'), 'utf8')).items;
  const recentRe = JSON.parse(await fs.readFile(path.join(dir, 'reentry.json'), 'utf8')).recent;
  for (let d = 13; d >= 0; d--) {
    const t = now - d * 86400e3;
    const iso = new Date(t).toISOString().slice(0, 10);
    // That day's launches, plus a few dozen newly catalogued pieces of old debris.
    const dayRows = new Set([...rows.filter((r) => r[17] === iso), ...Array.from({ length: Math.floor(range(3, 40)) }, () => pick(rows))]);
    const prevEls = Object.fromEntries(rows.filter((r) => !dayRows.has(r)).map((r) => [r[0], [0]]));
    state = more.updateDigest(state, {
      rows,
      prevEls,
      decayed: [],
      reentries: recentRe.filter((r) => r.decay === new Date(t).toISOString().slice(0, 10)),
      manoeuvres: man.filter((m) => Math.abs(Date.parse(m.t) - t) < 43200e3),
      breakups: brk.filter((b) => Math.abs(Date.parse(b.first) - t) < 43200e3),
      now: t,
    });
  }
  const digest = more.digestJson(state, now, { sample: true });
  await fs.writeFile(path.join(dir, 'digest.json'), JSON.stringify(digest));
  await fs.writeFile(path.join(dir, 'feed.xml'), more.atomFeed(digest, 'https://zer0krypt.github.io/OrbitalObjects'));

  const dep = await more.writeDeploymentFiles(dir, deployStore, now);
  console.log(`[sample] wrote radio.json, aurora.json, launchstats.json, classified.json, digest.json, feed.xml and ${dep.length} deployments`);
}
