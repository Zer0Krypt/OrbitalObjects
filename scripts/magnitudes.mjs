// Standard magnitudes from Mike McCants' qs.mag (distributed as qsmag.zip).
import zlib from 'node:zlib';

/** The first file of a ZIP archive whose name matches, as text (stored or deflated). */
export function unzipText(buf, match) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not a zip archive');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < entries; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('latin1', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!match.test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    return (method === 8 ? zlib.inflateRawSync(data) : data).toString('latin1');
  }
  throw new Error(`no ${match} in archive`);
}

/**
 * qs.mag lines start with the 5-digit catalogue number; the standard
 * magnitude is the last number on the line (after the name and, on most
 * lines, three dimensions in metres), optionally followed by a source flag.
 */
export function parseQsMag(text) {
  const mags = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d{1,5})\s+(.*)$/.exec(line);
    if (!m) continue;
    const nums = m[2].match(/-?\d+\.\d+/g);
    if (!nums) continue;
    const mag = Number(nums[nums.length - 1]);
    if (mag >= -3 && mag <= 15) mags.push([Number(m[1]), mag]);
  }
  return mags;
}
