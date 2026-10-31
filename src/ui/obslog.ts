import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { gmst } from '../sim/astro';
import { satrecFor } from '../render/orbits';
import { compass, lookAt, magnitudeOf, observerFrame } from '../sim/observer';
import { fmtMag } from '../sim/brightness';
import { h } from './dom';
import { skyTool } from './skytools';

/**
 * Observation log: mark the satellites you saw, keep a list, and export it.
 * Each entry starts from the predicted position at the time you marked it;
 * edit in what you measured before reporting it, because the IOD format that
 * amateur observers send to SeeSat-L is for measured positions.
 */
export interface Sighting {
  id: string;
  norad: number;
  name: string;
  cospar: string;
  t: number;
  az: number;
  el: number;
  /** Topocentric right ascension (hours) and declination (deg), J2000. */
  ra: number;
  dec: number;
  mag: number | null;
  lat: number;
  lon: number;
  alt: number;
  note: string;
  /** Position entered by the observer (not the prediction). */
  measured: boolean;
}

const KEY = 'oo:obslog';
const STATION_KEY = 'oo:obslog-station';
const listeners = new Set<() => void>();
export function loadLog(): Sighting[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function saveLog(list: Sighting[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn());
}

const DEG = Math.PI / 180;
const AS = DEG / 3600;
/** Equator-and-equinox-of-date vector to J2000 (IAU 1976 precession). */
function toJ2000(v: [number, number, number], ms: number): [number, number, number] {
  const T = (ms / 86400000 + 2440587.5 - 2451545) / 36525;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * AS;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * AS;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * AS;
  const cz = Math.cos(zeta), sz = Math.sin(zeta), cZ = Math.cos(z), sZ = Math.sin(z), ct = Math.cos(th), st = Math.sin(th);
  // P = Rz(−z) Ry(θ) Rz(−ζ); J2000 = Pᵀ · date
  const P = [
    [cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st],
    [sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st],
    [st * cz, -st * sz, ct],
  ];
  return [0, 1, 2].map((j) => P[0][j] * v[0] + P[1][j] * v[1] + P[2][j] * v[2]) as [number, number, number];
}

/** Predicted topocentric position of an object from the observer at time t. */
export function predictedPosition(app: App, o: SatObject, t: number) {
  const rec = satrecFor(o);
  const obs = app.observer;
  if (!rec || !obs) return null;
  const la = lookAt(rec, obs, t);
  if (!la) return null;
  const f = observerFrame(obs, gmst(t));
  // Scene (x, y, z) -> inertial (x, −z, y).
  const d: [number, number, number] = [la.x - f.p[0], -(la.z - f.p[2]), la.y - f.p[1]];
  const r = Math.hypot(...d);
  const u: [number, number, number] = [d[0] / r, d[1] / r, d[2] / r];
  const j = toJ2000(u, t);
  const raOf = (v: number[]) => ((Math.atan2(v[1], v[0]) / DEG + 360) % 360) / 15;
  const decOf = (v: number[]) => Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG;
  const mag = magnitudeOf(la, app.stdMag(o).mag);
  return { az: la.az, el: la.el, ra: raOf(j), dec: decOf(j), raNow: raOf(u), decNow: decOf(u), mag: mag < 50 ? mag : null };
}

export function logSighting(app: App, o: SatObject, t = Date.now()) {
  const p = predictedPosition(app, o, t);
  const obs = app.observer;
  if (!p || !obs) return null;
  const s: Sighting = { id: `${o.norad}-${t}`, norad: o.norad, name: o.name, cospar: o.cospar, t, az: p.az, el: p.el, ra: p.ra, dec: p.dec, mag: p.mag, lat: obs.lat, lon: obs.lon, alt: obs.alt, note: '', measured: false };
  const list = loadLog();
  list.unshift(s);
  saveLog(list.slice(0, 500));
  return s;
}

// ---------- formats ----------
const pad = (n: number, w: number) => String(Math.max(0, Math.floor(n))).padStart(w, '0');
/** IOD "Mx" code: value ≈ M × 10^(x − 8). */
function mx(v: number) {
  if (!(v > 0)) return '  ';
  let x = Math.floor(Math.log10(v)) + 8;
  let m = Math.round(v / 10 ** (x - 8));
  if (m >= 10) {
    m = 1;
    x++;
  }
  return `${Math.min(9, m)}${Math.max(0, Math.min(9, x))}`;
}

/** One IOD line (angle format 2: RA HHMMmmm, Dec ±DDMMmm, J2000). */
export function iodLine(s: Sighting, station: string) {
  const d = new Date(s.t);
  const intl = /^(\d{2})(\d{2})-(\d{3})(\w*)$/.exec(s.cospar);
  const desig = intl ? `${intl[2]} ${intl[3]}${intl[4].padEnd(3, ' ').slice(0, 3)}` : '         ';
  const time = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds(), 2)}${pad(d.getUTCMilliseconds(), 3)}`;
  const raMin = s.ra * 60;
  const ra = `${pad(raMin / 60, 2)}${pad(raMin % 60, 2)}${pad(((raMin % 1) * 1000) % 1000, 3)}`;
  const decAbs = Math.abs(s.dec);
  const decMin = decAbs * 60;
  const dec = `${s.dec < 0 ? '-' : '+'}${pad(decAbs, 2)}${pad(decMin % 60, 2)}${pad(((decMin % 1) * 100) % 100, 2)}`;
  const mag = s.mag === null ? '    ' : `${s.mag < 0 ? '-' : '+'}${pad(Math.abs(s.mag) * 10, 3)}`;
  return `${pad(s.norad, 5)} ${desig} ${station.padStart(4, '0').slice(-4)} G ${time} ${mx(1)} 25 ${ra}${dec} ${mx(0.5)} S ${mag} 10`;
}

const csvCell = (v: unknown) => {
  const t = String(v ?? '');
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export function logCsv(list: Sighting[]) {
  const head = ['time_utc', 'norad', 'name', 'cospar', 'azimuth_deg', 'elevation_deg', 'ra_j2000_h', 'dec_j2000_deg', 'magnitude', 'position', 'lat', 'lon', 'alt_m', 'note'];
  const rows = list.map((s) => [new Date(s.t).toISOString(), s.norad, s.name, s.cospar, s.az.toFixed(2), s.el.toFixed(2), s.ra.toFixed(5), s.dec.toFixed(4), s.mag?.toFixed(1) ?? '', s.measured ? 'measured' : 'predicted', s.lat.toFixed(5), s.lon.toFixed(5), Math.round(s.alt * 1000), s.note]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

function download(text: string, name: string, type: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

const fmtHms = (hours: number) => {
  const s = Math.round(hours * 36000) / 10;
  return `${pad(s / 3600, 2)}h ${pad((s % 3600) / 60, 2)}m ${((s % 60) as number).toFixed(1).padStart(4, '0')}s`;
};
const fmtDms = (deg: number) => {
  const a = Math.abs(deg);
  return `${deg < 0 ? '−' : '+'}${pad(a, 2)}° ${pad((a * 60) % 60, 2)}′ ${pad((a * 3600) % 60, 2)}″`;
};
/** "12 34 56.7", "12h34m56.7s" or "12.5823" -> hours (or degrees). */
function parseSexagesimal(v: string) {
  const t = v.trim().replace(/[−–]/g, '-');
  const neg = t.startsWith('-');
  const parts = t.replace(/^[+-]/, '').split(/[^\d.]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.some((x) => !Number.isFinite(x))) return null;
  const val = parts[0] + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
  return neg ? -val : val;
}

const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "I saw it" button for an object (logs the predicted position now). */
export function logButton(app: App, o: SatObject) {
  const b = h('button', { class: 'btn', title: 'Add a sighting of this object to your observation log, at the current time' }, 'I saw it');
  b.onclick = () => {
    const p = app.observer ? predictedPosition(app, o, Date.now()) : null;
    const s = p && p.el > -2 ? logSighting(app, o, Date.now()) : null;
    b.textContent = s ? 'Logged ✓' : !app.observer ? 'Set your location first' : 'It’s below your horizon now';
    setTimeout(() => (b.textContent = 'I saw it'), 2500);
  };
  return b;
}

export function mountObsLog(app: App) {
  const t = skyTool('Observation log', 'satellites you have seen', () => render());
  const list = h('div', { class: 'obs-list' });
  const status = h('p', { class: 'sky-hint', style: 'margin:0' });
  let station = '9999';
  try {
    station = localStorage.getItem(STATION_KEY) || '9999';
  } catch {
    /* default */
  }
  const stationIn = h('input', { type: 'text', inputmode: 'numeric', maxlength: 4, value: station, class: 'obs-station', 'aria-label': 'COSPAR station number', title: 'Your COSPAR station number for IOD reports (9999 if you have none yet)' });
  stationIn.addEventListener('change', () => {
    station = stationIn.value.replace(/\D/g, '').slice(0, 4) || '9999';
    stationIn.value = station;
    try {
      localStorage.setItem(STATION_KEY, station);
    } catch {
      /* private mode */
    }
  });
  const iod = h('button', { class: 'btn', title: 'Interactive Orbit Determination format, for SeeSat-L: measured positions only' }, 'Export IOD');
  const csv = h('button', { class: 'btn' }, 'Export CSV');
  t.body.append(
    status,
    list,
    h('div', { class: 'sky-actions' }, csv, iod, h('label', { class: 'obs-station-l' }, h('span', null, 'Station'), stationIn)),
  );
  csv.onclick = () => download(logCsv(loadLog()), 'observation-log.csv', 'text/csv');
  iod.onclick = () => {
    const m = loadLog().filter((s) => s.measured);
    if (!m.length) {
      status.textContent = 'IOD reports are for positions you measured. Open an entry and enter the position you measured first; CSV export includes everything.';
      return;
    }
    download(m.map((s) => iodLine(s, station)).join('\r\n') + '\r\n', 'observations-iod.txt', 'text/plain');
  };

  let editing: string | null = null;
  function render() {
    const log = loadLog();
    status.textContent = log.length
      ? `${log.length} sighting${log.length === 1 ? '' : 's'}. Each starts from the predicted position at the time you logged it; edit in what you measured.`
      : 'Nothing logged yet. Press “I saw it” in an object’s details (under From your location), or log one from “What did I see?”.';
    list.replaceChildren(
      ...log.slice(0, 60).map((s) => {
        const o = app.cat.byNorad.get(s.norad);
        const row = h(
          'div',
          { class: 'obs-row' },
          h(
            'button',
            { class: 'obs-main', title: o ? 'Show it' : '', onclick: () => o && (app.exitHistory(), app.select(o, { fly: true })) },
            h('b', null, s.name.replace(/\s*\(.*\)$/, '')),
            h('small', null, `${when.format(s.t)} · ${Math.round(s.el)}° ${compass(s.az)}${s.mag !== null ? ` · mag ${fmtMag(s.mag)}` : ''}${s.measured ? ' · measured' : ''}${s.note ? ` · ${s.note}` : ''}`),
          ),
          h('button', { class: 'icon-mini', title: 'Edit', 'aria-label': 'Edit sighting', onclick: () => ((editing = editing === s.id ? null : s.id), render()) }, '✎'),
          h('button', { class: 'icon-mini', title: 'Delete', 'aria-label': 'Delete sighting', onclick: () => saveLog(loadLog().filter((x) => x.id !== s.id)) }, '×'),
        );
        return editing === s.id ? h('div', null, row, editor(s)) : row;
      }),
    );
  }

  function editor(s: Sighting) {
    const timeIn = h('input', { type: 'text', value: new Date(s.t).toISOString().replace('T', ' ').replace('Z', ''), 'aria-label': 'Time (UTC)' });
    const raIn = h('input', { type: 'text', value: fmtHms(s.ra), 'aria-label': 'Right ascension (J2000)' });
    const decIn = h('input', { type: 'text', value: fmtDms(s.dec), 'aria-label': 'Declination (J2000)' });
    const magIn = h('input', { type: 'text', inputmode: 'decimal', value: s.mag === null ? '' : s.mag.toFixed(1), 'aria-label': 'Magnitude' });
    const noteIn = h('input', { type: 'text', value: s.note, maxlength: 120, 'aria-label': 'Note' });
    const err = h('div', { class: 'sky-status error', hidden: true });
    const form = h(
      'form',
      { class: 'sky-form obs-form', novalidate: true },
      h('label', null, h('span', null, 'Time (UTC)'), timeIn),
      h('label', null, h('span', null, 'RA (J2000)'), raIn),
      h('label', null, h('span', null, 'Dec (J2000)'), decIn),
      h('label', null, h('span', null, 'Magnitude'), magIn),
      h('label', null, h('span', null, 'Note'), noteIn),
      err,
      h('div', { class: 'sky-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save'), h('button', { class: 'btn', type: 'button', onclick: () => ((editing = null), render()) }, 'Cancel')),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = Date.parse(timeIn.value.trim().replace(' ', 'T') + (/[zZ]$/.test(timeIn.value.trim()) ? '' : 'Z'));
      const ra = parseSexagesimal(raIn.value);
      const dec = parseSexagesimal(decIn.value);
      const mag = magIn.value.trim() ? Number(magIn.value) : null;
      if (!Number.isFinite(t) || ra === null || ra < 0 || ra >= 24 || dec === null || Math.abs(dec) > 90 || (mag !== null && !Number.isFinite(mag))) {
        err.hidden = false;
        err.textContent = 'Check the time (YYYY-MM-DD HH:MM:SS), RA (0–24 h) and Dec (−90 to +90°).';
        return;
      }
      const moved = Math.abs(ra - s.ra) > 1e-4 || Math.abs(dec - s.dec) > 1e-3;
      saveLog(loadLog().map((x) => (x.id === s.id ? { ...x, t, ra, dec, mag, note: noteIn.value.trim(), measured: x.measured || moved } : x)));
      editing = null;
    });
    return form;
  }

  listeners.add(render);
  return t.el;
}

/** For other panels: re-render when the log changes. */
export const onLogChange = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
