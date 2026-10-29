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
