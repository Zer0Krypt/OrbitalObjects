import type { App } from '../app';
import { TYPE_LABEL } from '../data/catalog';
import { ownerName } from '../data/codes';
import { eciToGeodetic, gmst } from '../sim/astro';
import { fmtInt, h } from './dom';

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

export function download(blob: Blob, filename: string) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
}

/** The date the view shows: the history date, else the simulation clock. */
const viewTime = (app: App) => app.history?.cutoff ?? app.clock.now();

/** One line describing what's on screen, for captions. */
export function describeView(app: App) {
  const n = app.history ? app.historyShown : app.visibleList.length;
  const f = app.filters;
  const groups = [...f.groups].map((i) => app.cat.groups[i]?.label).filter(Boolean);
  const what = app.selected
    ? app.selected.name
    : f.idsLabel ||
      (f.query.trim() ? `“${f.query.trim()}”` : groups.length ? groups.slice(0, 2).join(' + ') + (groups.length > 2 ? ' …' : '') : n === app.universe.length ? 'Everything in Earth orbit' : 'Filtered objects');
  return `${what} · ${fmtInt(n)} object${n === 1 ? '' : 's'}`;
}

// ---------- CSV ----------
const cell = (v: unknown) => {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const r = (v: number, d: number) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

/** The filtered list (as of the history date in history mode), with positions at the current time. */
export function exportCsv(app: App) {
  const t = viewTime(app);
  const g = gmst(app.clock.now());
  const sky = app.observer && !app.history;
  const head = [
    'norad', 'name', 'cospar', 'type', 'owner', 'owner_name', 'launch', 'decay', 'site', 'status', 'regime',
    'perigee_km', 'apogee_km', 'inclination_deg', 'period_min', 'eccentricity', 'rcs_m2', 'epoch',
    'lat_deg', 'lon_deg', 'alt_km',
    ...(sky ? ['azimuth_deg', 'elevation_deg', 'magnitude'] : []),
  ];
  const rows = [head.join(',')];
  const p = { x: 0, y: 0, z: 0 };
  for (const o of app.inOrbitList()) {
    let geo: { lat: number; lon: number; alt: number } | null = null;
    if (app.hasPosition(o)) {
      const s = app.scenePosition(o, undefined, app.clock.now());
      // Scene (x, y, z) in Earth radii is inertial (x, −z, y).
      Object.assign(p, { x: s.x * 6371, y: -s.z * 6371, z: s.y * 6371 });
      geo = eciToGeodetic(p.x, p.y, p.z, g);
    }
    const row = [
      o.norad, o.name, o.cospar, TYPE_LABEL[o.type], o.owner, ownerName(o.owner), o.launch, o.decay ?? '', o.site, o.status, o.regime,
      r(o.perigee, 1), r(o.apogee, 1), r(o.incl, 4), r(o.period, 3), r(o.ecc, 7), o.rcs, o.epoch,
      geo ? r(geo.lat, 4) : null, geo ? r(geo.lon, 4) : null, geo ? r(geo.alt, 2) : null,
      ...(sky ? [r(app.skyAz[o.idx], 2), r(app.skyEl[o.idx], 2), app.skyMag[o.idx] < 50 ? r(app.skyMag[o.idx], 1) : null] : []),
    ];
    rows.push(row.map(cell).join(','));
  }
  const blob = new Blob(['﻿' + rows.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  download(blob, `orbital-objects-${stamp(t)}.csv`);
  return rows.length - 1;
}

// ---------- drawing the view ----------
const BRAND = 'ORBITAL OBJECTS';

/** Copy the labels the overlay draws in HTML onto a 2D canvas. */
function drawLabels(g: CanvasRenderingContext2D, scale: number) {
  const els = document.querySelectorAll<HTMLElement>('#overlay .label, #overlay .reticle .tag, #overlay .sv-label, #overlay .you-pin span, #overlay .pair-label');
  g.textBaseline = 'middle';
  for (const el of els) {
    if (el.hidden || el.closest('[hidden]') || !el.offsetParent || el.classList.contains('behind')) continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const text = (el.firstChild?.textContent ?? el.textContent ?? '').trim();
    if (!text) continue;
    g.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * scale}px Inter, system-ui, sans-serif`;
    g.fillStyle = cs.color;
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 6 * scale;
    g.fillText(text, (rect.left + parseFloat(cs.paddingLeft)) * scale, (rect.top + rect.height / 2) * scale);
  }
  g.shadowBlur = 0;
}

function drawCaption(app: App, g: CanvasRenderingContext2D, W: number, H: number, scale: number, big: boolean) {
  const pad = 22 * scale;
  const t = viewTime(app);
  const grd = g.createLinearGradient(0, H - 110 * scale, 0, H);
  grd.addColorStop(0, 'rgba(2,4,10,0)');
  grd.addColorStop(1, 'rgba(2,4,10,0.85)');
  g.fillStyle = grd;
  g.fillRect(0, H - 110 * scale, W, 110 * scale);
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#eaeef6';
  g.font = `600 ${(big ? 34 : 20) * scale}px "JetBrains Mono", ui-monospace, monospace`;
  const date = app.history && app.history.playing ? new Date(t).toISOString().slice(0, 7) : `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  g.fillText(date, pad, H - pad - 22 * scale);
  g.font = `500 ${14 * scale}px Inter, system-ui, sans-serif`;
  g.fillStyle = '#b4bccc';
  g.fillText(describeView(app), pad, H - pad);
  g.textAlign = 'right';
  g.font = `600 ${13 * scale}px Inter, system-ui, sans-serif`;
  g.fillStyle = '#eaeef6';
  g.fillText(BRAND, W - pad, H - pad - 18 * scale);
  g.font = `400 ${11 * scale}px Inter, system-ui, sans-serif`;
  g.fillStyle = '#7c8598';
  g.fillText(`Data: ${app.cat.source}`, W - pad, H - pad);
  g.textAlign = 'left';
}

/** Run `fn` right after the next frame renders, while the WebGL buffer is still readable. */
function afterRender(app: App, fn: () => void) {
  const off = app.on('frame', () => {
    off();
    fn();
  });
}

export function screenshot(app: App): Promise<void> {
  return new Promise((resolve) => {
    afterRender(app, () => {
      const src = app.stage.renderer.domElement;
      const W = src.width;
      const H = src.height;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d')!;
      g.fillStyle = '#02040a';
      g.fillRect(0, 0, W, H);
      g.drawImage(src, 0, 0);
      const scale = W / src.clientWidth;
      drawLabels(g, scale);
      drawCaption(app, g, W, H, scale, false);
      c.toBlob((b) => {
        if (b) download(b, `orbital-objects-${stamp(viewTime(app))}.png`);
        resolve();
      }, 'image/png');
    });
  });
}

// ---------- video ----------
function pickMime() {
  // WebM where possible (open codecs, widely supported); MP4 for Safari.
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'];
  return types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? null;
}

export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!pickMime() && 'captureStream' in HTMLCanvasElement.prototype;

/** Records the globe (with a caption) to a video file. */
export class Recorder {
  active = false;
  startedAt = 0;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private off: (() => void) | null = null;
  private listeners = new Set<() => void>();
  /** Stop automatically when history playback hands back to live time. */
  private stopOnLive = false;
  private readonly maxMs = 5 * 60e3;

  constructor(private app: App) {
    app.on('history', () => {
      if (this.active && this.stopOnLive && !app.history) this.stop();
    });
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  start(opts: { replay?: boolean } = {}) {
    if (this.active || !canRecord()) return false;
    const app = this.app;
    const src = app.stage.renderer.domElement;
    // Cap at 720p so slower devices keep up; even dimensions keep encoders happy.
    const k = Math.min(1, 1280 / src.width, 720 / src.height);
    const W = Math.round((src.width * k) / 2) * 2;
    const H = Math.round((src.height * k) / 2) * 2;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    // A CPU-backed canvas: some GPUs never hand an accelerated canvas that
    // is only drawn from WebGL to the encoder.
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const scale = W / src.clientWidth;
    // Frames are pushed explicitly after each draw: Chrome doesn't reliably
    // capture an off-screen canvas that is only drawn from WebGL.
    const stream = c.captureStream(0);
    const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
    let lastPush = 0;
    this.off = app.on('frame', () => {
      const now = performance.now();
      if (now - lastPush < 1000 / 31) return;
      lastPush = now;
      g.fillStyle = '#02040a';
      g.fillRect(0, 0, W, H);
      g.drawImage(src, 0, 0, W, H);
      drawLabels(g, scale);
      drawCaption(app, g, W, H, scale, !!app.history);
      track.requestFrame?.();
      if (now - this.startedAt > this.maxMs) this.stop();
    });
    const mime = pickMime()!;
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: mime.split(';')[0] });
      download(blob, `orbital-objects-${opts.replay ? 'space-age' : stamp(viewTime(app))}.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
      stream.getTracks().forEach((t) => t.stop());
    };
    this.rec.start(1000);
    this.active = true;
    this.startedAt = performance.now();
    this.stopOnLive = !!opts.replay;
    if (opts.replay) {
      // The whole space age in about 40 seconds.
      app.select(null);
      app.setHistory({ cutoff: Date.UTC(1957, 9, 1), playing: true, speed: (1.75 * 365.25 * 86400e3) / 1000 });
    }
    this.emit();
    return true;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.off?.();
    this.off = null;
    this.rec?.stop();
    this.rec = null;
    this.emit();
  }
}
