import type { SatObject } from './catalog';

// Reconstructs a two-line element set from the stored mean elements.

function checksum(line: string) {
  let s = 0;
  for (const c of line) {
    if (c >= '0' && c <= '9') s += Number(c);
    else if (c === '-') s += 1;
  }
  return s % 10;
}

const ALPHA5 = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function satnum(n: number) {
  if (n < 100000) return String(n).padStart(5, '0');
  const lead = Math.floor(n / 10000) - 10;
  return (ALPHA5[lead] ?? '?') + String(n % 10000).padStart(4, '0');
}

/** TLE "assumed decimal" exponent notation, e.g. 0.00012345 -> " 12345-3". */
function expo(v: number) {
  if (!v) return ' 00000+0';
  const sign = v < 0 ? '-' : ' ';
  let e = Math.floor(Math.log10(Math.abs(v))) + 1;
  let m = Math.round(Math.abs(v) / 10 ** e * 1e5);
  if (m >= 1e5) {
    m = Math.round(m / 10);
    e += 1;
  }
  return `${sign}${String(m).padStart(5, '0')}${e < 0 ? '-' : '+'}${Math.abs(e)}`;
}

function epochField(iso: string) {
  const d = new Date(/Z$/.test(iso) ? iso : iso + 'Z');
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const doy = (d.getTime() - start) / 86400000 + 1;
  return `${String(y % 100).padStart(2, '0')}${doy.toFixed(8).padStart(12, '0')}`;
}

export function toTLE(o: SatObject): [string, string] {
  const id = o.cospar.match(/^(\d{4})-(\d{3})(\w*)$/);
  const intl = id ? `${id[1].slice(2)}${id[2]}${id[3]}`.padEnd(8) : ''.padEnd(8);
  const ndot = (o.ndot < 0 ? '-' : ' ') + Math.abs(o.ndot).toFixed(8).replace(/^0/, '');
  let l1 = `1 ${satnum(o.norad)}U ${intl} ${epochField(o.epoch)} ${ndot} ${expo(o.nddot)} ${expo(o.bstar)} 0 ${String(o.elset % 10000).padStart(4)}`;
  l1 += checksum(l1);
  const ecc = o.ecc.toFixed(7).slice(2);
  let l2 = `2 ${satnum(o.norad)} ${o.incl.toFixed(4).padStart(8)} ${o.raan.toFixed(4).padStart(8)} ${ecc} ${o.argp.toFixed(4).padStart(8)} ${o.ma.toFixed(4).padStart(8)} ${o.meanMotion.toFixed(8).padStart(11)}${String(o.revs % 100000).padStart(5)}`;
  l2 += checksum(l2);
  return [l1, l2];
}

// ---------- parsing ----------
export interface ParsedTle {
  norad: number;
  name: string;
  cospar: string;
  epoch: string;
  n: number;
  ecc: number;
  incl: number;
  raan: number;
  argp: number;
  ma: number;
  bstar: number;
  ndot: number;
  nddot: number;
  revs: number;
  elset: number;
  l1: string;
  l2: string;
}

const assumed = (s: string) => {
  const t = s.trim();
  if (!t) return 0;
  const m = /^([+-]?)(\d+)([+-]\d)$/.exec(t);
  return m ? Number(`${m[1]}0.${m[2]}e${m[3]}`) : Number(t);
};
const unAlpha5 = (s: string) => {
  const c = s.charAt(0);
  const k = ALPHA5.indexOf(c.toUpperCase());
  return k >= 0 ? (k + 10) * 10000 + Number(s.slice(1)) : Number(s);
};

/** Two- or three-line element sets from pasted text; `errors` explains lines that didn't parse. */
export function parseTleText(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const out: ParsedTle[] = [];
  const errors: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[i].trimStart();
    const l2 = (lines[i + 1] ?? '').trimStart();
    if (!/^1 /.test(l1)) continue;
    if (!/^2 /.test(l2)) {
      errors.push(`Line 1 for ${l1.slice(2, 7).trim()} has no line 2 after it.`);
      continue;
    }
    if (l1.length < 68 || l2.length < 68) {
      errors.push(`Element set ${l1.slice(2, 7).trim()} is too short: TLE lines are 69 characters.`);
      i++;
      continue;
    }
    for (const [k, l] of [
      [1, l1],
      [2, l2],
    ] as [number, string][])
      if (l.length >= 69 && checksum(l.slice(0, 68)) !== Number(l.charAt(68))) errors.push(`Line ${k} of ${l1.slice(2, 7).trim()}: checksum doesn't match (a copying mistake?).`);
    const prev = lines[i - 1]?.trim() ?? '';
    const name = i > 0 && !/^[12] /.test(prev) ? prev.replace(/^0 /, '').trim() : '';
    const yy = Number(l1.slice(18, 20));
    const doy = Number(l1.slice(20, 32));
    const epoch = Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (doy - 1) * 86400000;
    const im = /^(\d\d)(\d{3})(\w*)$/.exec(l1.slice(9, 17).trim());
    const norad = unAlpha5(l1.slice(2, 7).trim());
    const e: ParsedTle = {
      norad,
      name: (name || `OBJECT ${norad}`).slice(0, 40),
      cospar: im ? `${Number(im[1]) < 57 ? 20 : 19}${im[1]}-${im[2]}${im[3]}` : '',
      epoch: new Date(epoch).toISOString().replace('Z', ''),
      ndot: Number(l1.slice(33, 43)) || 0,
      nddot: assumed(l1.slice(44, 52)),
      bstar: assumed(l1.slice(53, 61)),
      elset: Number(l1.slice(64, 68)) || 0,
      incl: Number(l2.slice(8, 16)),
      raan: Number(l2.slice(17, 25)),
      ecc: Number(`0.${l2.slice(26, 33).trim()}`),
      argp: Number(l2.slice(34, 42)),
      ma: Number(l2.slice(43, 51)),
      n: Number(l2.slice(52, 63)),
      revs: Number(l2.slice(63, 68)) || 0,
      l1: l1.slice(0, 69),
      l2: l2.slice(0, 69),
    };
    if (!(e.norad > 0) || !(e.n > 0) || !Number.isFinite(e.incl) || !Number.isFinite(epoch)) errors.push(`Element set ${l1.slice(2, 7).trim()} has unreadable numbers.`);
    else out.push(e);
    i++;
  }
  return { sets: out, errors };
}

/** Parsed element sets as catalogue rows (fields as in catalog.json). */
export const TLE_FIELDS = ['norad', 'name', 'cospar', 'epoch', 'meanMotion', 'ecc', 'incl', 'raan', 'argp', 'ma', 'bstar', 'ndot', 'nddot', 'revs', 'elset', 'type', 'owner', 'launch', 'site', 'status', 'rcs', 'groups', 'sup'];
export const tleRows = (sets: ParsedTle[]) => sets.map((e) => [e.norad, e.name, e.cospar, e.epoch, e.n, e.ecc, e.incl, e.raan, e.argp, e.ma, e.bstar, e.ndot, e.nddot, e.revs, e.elset, 'P', 'UNK', '', '', '?', null, [], 0]);
