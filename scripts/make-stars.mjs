#!/usr/bin/env node
// Builds the star field and constellation figures in public/sky/ (committed;
// rerun only to change the magnitude limit or update the sources):
//
//   stars.bin            every star to magnitude 7.5 from the HYG database
//   constellations.json  stick figures, names and label positions, bright-star names
//
// Sources: HYG database v4.1 (astronexus, CC BY-SA 4.0) and d3-celestial
// constellation data (Olaf Frohn, BSD 3-Clause).
//
// stars.bin: 'STR1', uint32 count, then per star (sorted brightest first)
//   uint16 RA (0..24 h -> 0..65536), int16 Dec (±90° -> ±32767),
//   int8 magnitude × 10, int8 B−V colour index × 40.
//
// Usage: node scripts/make-stars.mjs [hygdata.csv] [constellations.lines.json] [constellations.json]
// (paths default to downloading the sources).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'sky');
const MAG_LIMIT = 7.5;
const NAME_LIMIT = 2.6;
const SOURCES = [
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv',
  'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json',
  'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json',
];

async function read(arg, url) {
  if (arg) return fs.readFile(arg, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function csvRow(line) {
  const out = [];
  let f = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(f);
      f = '';
    } else f += c;
  }
  out.push(f);
  return out;
}

const args = process.argv.slice(2);
const [hyg, lines, names] = await Promise.all(SOURCES.map((u, i) => read(args[i], u)));

const rows = hyg.split(/\r?\n/);
const head = csvRow(rows[0]);
const col = Object.fromEntries(head.map((k, i) => [k, i]));
const stars = [];
const named = [];
for (let r = 1; r < rows.length; r++) {
  if (!rows[r]) continue;
  const c = csvRow(rows[r]);
  if (c[col.proper] === 'Sol') continue;
  const mag = Number(c[col.mag]);
  if (!(mag <= MAG_LIMIT)) continue;
  const ra = Number(c[col.ra]); // hours
  const dec = Number(c[col.dec]);
  const ci = c[col.ci] === '' ? 0.6 : Number(c[col.ci]);
  stars.push({ ra, dec, mag, ci });
  if (c[col.proper] && mag <= NAME_LIMIT) named.push([+(ra * 15).toFixed(3), +dec.toFixed(3), c[col.proper], +mag.toFixed(2)]);
}
stars.sort((a, b) => a.mag - b.mag);

const buf = Buffer.alloc(8 + stars.length * 6);
buf.write('STR1', 0, 'ascii');
buf.writeUInt32LE(stars.length, 4);
stars.forEach((s, k) => {
  const o = 8 + k * 6;
  buf.writeUInt16LE(Math.round((s.ra / 24) * 65536) % 65536, o);
  buf.writeInt16LE(Math.round((s.dec / 90) * 32767), o + 2);
  buf.writeInt8(Math.max(-128, Math.min(127, Math.round(s.mag * 10))), o + 4);
  buf.writeInt8(Math.max(-128, Math.min(127, Math.round(s.ci * 40))), o + 5);
});

// Constellations: RA in degrees (0..360), Dec in degrees.
const ra360 = (lon) => +(lon < 0 ? lon + 360 : lon).toFixed(3);
const info = new Map(JSON.parse(names).features.map((f) => [f.id, f]));
const figures = JSON.parse(lines).features.map((f) => {
  const meta = info.get(f.id);
  return {
    id: f.id,
    name: meta?.properties.name ?? f.id,
    label: meta ? [ra360(meta.geometry.coordinates[0]), +meta.geometry.coordinates[1].toFixed(2)] : null,
    rank: Number(f.properties.rank),
    lines: f.geometry.coordinates.map((ln) => ln.flatMap(([lon, lat]) => [ra360(lon), +lat.toFixed(3)])),
  };
});

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'stars.bin'), buf);
await fs.writeFile(
  path.join(OUT, 'constellations.json'),
  JSON.stringify({
    source: 'HYG database v4.1 (CC BY-SA 4.0); d3-celestial (BSD 3-Clause)',
    stars: named.sort((a, b) => a[3] - b[3]),
    figures,
  }),
);
console.log(`[stars] ${stars.length} stars to mag ${MAG_LIMIT} (${(buf.length / 1024).toFixed(0)} KB), ${figures.length} constellations, ${named.length} named stars`);
