// Change detection between builds: manoeuvres (an orbit that changed more
// than drag explains) and breakups (a jump in the debris catalogued from one
// launch). Each run compares the new catalogue with a compact copy of the
// previous one kept in .data-cache/, so detections start from the second run.

const MU = 398600.4418;
const DAY = 86400e3;
const R = (v, d) => Number(v.toFixed(d));

const smaKm = (n) => Math.cbrt(MU / ((n * 2 * Math.PI) / 86400) ** 2);
const epochMs = (s) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');

/** Compact per-object elements: norad -> [epochMs, meanMotion, ecc, incl, ndot]. */
export function elementState(rows) {
  const els = {};
  for (const r of rows) {
    const t = epochMs(r[3]);
    if (Number.isFinite(t) && r[4]) els[r[0]] = [t, r[4], r[5], r[6], r[11] ?? 0];
  }
  return els;
}

/**
 * Objects whose semi-major axis or inclination changed between their previous
 * and current element sets by more than drag and fitting noise explain.
 * Only payloads: debris and rocket bodies can't manoeuvre, and their jumps
 * are fitting artefacts.
 */
export function detectManoeuvres(prevEls, rows, now = Date.now()) {
  const out = [];
  if (!prevEls) return out;
  for (const r of rows) {
    if (r[15] !== 'P') continue;
    const p = prevEls[r[0]];
    if (!p) continue;
    const t = epochMs(r[3]);
    const dtDays = (t - p[0]) / DAY;
    // Same element set, or too long a gap to tell a burn from drag.
    if (!(dtDays > 0.01) || dtDays > 10) continue;
    const a0 = smaKm(p[1]);
    const a1 = smaKm(r[4]);
    const alt = a1 * (1 - r[5]) - 6378;
    if (alt < 250) continue; // decaying fast: changes are mostly drag
    // Drag: n grows at 2·ndot rev/day², and a ∝ n^(−2/3).
    const ndot = (p[4] + (r[11] ?? 0)) / 2;
    const expected = (-2 / 3) * a0 * ((2 * ndot) / p[1]) * dtDays;
    const da = a1 - a0 - expected;
    const di = r[6] - p[3];
    const geo = a1 > 40000 && a1 < 44000;
    const daLimit = geo ? 3 : a1 > 10000 ? 2 : 0.8;
    const diLimit = geo ? 0.02 : 0.015;
    if (Math.abs(da) < daLimit && Math.abs(di) < diLimit) continue;
    // Rough Δv: tangential burn for Δa, plane change for Δi.
    const v = Math.sqrt(MU / a1);
    const dvA = (Math.abs(da) * v) / (2 * a1);
    const dvI = 2 * v * Math.sin(((Math.abs(di) * Math.PI) / 180) / 2);
    out.push({
      norad: r[0],
      name: r[1],
      t: new Date(t).toISOString(),
      prev: new Date(p[0]).toISOString(),
      daKm: R(da, 2),
      diDeg: R(di, 4),
      dvMs: R(Math.hypot(dvA, dvI) * 1000, 2),
      kind: Math.abs(di) >= diLimit && dvI > dvA ? 'plane' : da > 0 ? 'raise' : 'lower',
      found: new Date(now).toISOString(),
    });
  }
  return out;
}

/** Merge new detections into the rolling log: latest per object, last 14 days. */
export function mergeManoeuvres(log, found, now = Date.now()) {
  const byKey = new Map((log ?? []).map((m) => [`${m.norad}-${m.t}`, m]));
  for (const m of found) byKey.set(`${m.norad}-${m.t}`, m);
  return [...byKey.values()].filter((m) => now - Date.parse(m.t) < 14 * DAY).sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 4000);
}

const launchOf = (cospar) => String(cospar).match(/^(\d{4}-\d{3})/)?.[1] ?? null;

/** Catalogued debris per launch: "1999-025" -> count. */
export function debrisCounts(rows) {
  const c = {};
  for (const r of rows) {
    if (r[15] !== 'D') continue;
    const k = launchOf(r[2]);
    if (k) c[k] = (c[k] || 0) + 1;
  }
  return c;
}

/**
 * A breakup shows up as a jump in one launch's debris count: new pieces are
 * catalogued over days to weeks, so a recent event keeps growing.
 */
export function detectBreakups(prevCounts, rows, events, now = Date.now()) {
  const counts = debrisCounts(rows);
  const list = [...(events ?? [])];
  if (!prevCounts) return { counts, events: list };
  const parents = new Map();
  for (const r of rows) {
    const k = launchOf(r[2]);
    if (!k || r[15] === 'D') continue;
    const cur = parents.get(k);
    // The original object: a payload before a rocket body, lowest number first.
    if (!cur || (r[15] === 'P' && cur[15] !== 'P') || (r[15] === cur[15] && r[0] < cur[0])) parents.set(k, r);
  }
  for (const [k, n] of Object.entries(counts)) {
    const before = prevCounts[k] ?? 0;
    const added = n - before;
    const recent = list.find((e) => e.cospar === k && now - Date.parse(e.last) < 60 * DAY);
    // A fresh jump, or a known event still growing.
    if (added < (recent ? 1 : before ? Math.max(8, before * 0.1) : 10)) continue;
    const parent = parents.get(k);
    if (recent) {
      recent.added += added;
      recent.total = n;
      recent.last = new Date(now).toISOString();
    } else
      list.push({
        cospar: k,
        parent: parent ? { norad: parent[0], name: parent[1], type: parent[15], owner: parent[16] } : null,
        before,
        added,
        total: n,
        first: new Date(now).toISOString(),
        last: new Date(now).toISOString(),
      });
  }
  return { counts, events: list.filter((e) => now - Date.parse(e.last) < 180 * DAY).sort((a, b) => (a.first < b.first ? 1 : -1)) };
}
