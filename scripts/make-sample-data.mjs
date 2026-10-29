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
function cloud(n, name, owner, alt, inc, raan, spread, groupKey, year) {
  for (let k = 0; k < n; k++) {
    const p = alt + gauss() * spread;
    const a = p + Math.abs(gauss()) * spread * 1.5;
    add({ name: `${name} DEB`, type: 'D', n: nFromAlt(p, a), e: eccFrom(p, a), i: inc + gauss() * 0.6, raan: raan + gauss() * 12, owner, year, rcs: range(0.01, 0.3), groups: groupKey ? [G(groupKey)] : [] });
  }
}
cloud(2600, 'FENGYUN 1C', 'PRC', 850, 98.8, 120, 120, 'fengyun-1c-debris', 1999);
cloud(1100, 'COSMOS 2251', 'CIS', 790, 74, 30, 90, 'cosmos-2251-debris', 1993);
cloud(400, 'IRIDIUM 33', 'US', 780, 86.4, 200, 80, 'iridium-33-debris', 1997);
cloud(300, 'COSMOS 1408', 'CIS', 470, 82.6, 300, 60, 'cosmos-1408-debris', 1982);
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
