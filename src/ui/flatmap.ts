import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { TYPE_LABEL } from '../data/catalog';
import { eciToGeodetic, gmst, sunDirectionEci } from '../sim/astro';
import { satrecFor, stateAt } from '../render/orbits';
import { $, fmtKm, h } from './dom';

/**
 * Flat map view: the whole world at once (equirectangular), with every
 * object at its sub-satellite point, day and night, the selected object's
 * ground track and your location. Scroll to zoom, drag to pan.
 */
const DEG = Math.PI / 180;
const base = import.meta.env.BASE_URL;

export function mountFlatMap(app: App) {
  const canvas = h('canvas', { class: 'flatmap', hidden: true, 'aria-label': 'Flat map of every object' });
  document.getElementById('globe')!.after(canvas);
  const day = new Image();
  const night = new Image();
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    day.src = base + 'textures/earth-day.jpg';
    night.src = base + 'textures/earth-night.jpg';
  };
  const tooltip = $('#tooltip');
  let view = { s: 1, x: 0, y: 0 }; // zoom, pan in screen px
  let pts: { x: number; y: number; o: SatObject }[] = [];
  let hit: SatObject | null = null;
  let track: { lat: number; lon: number }[] = [];
  let trackFor = -1;
  let trackAt = 0;
  let aurora: HTMLCanvasElement | null = null;
  let auroraFrom: Uint8Array | null = null;

  function auroraImage() {
    const g = app.aurora;
    if (!g) return null;
    if (aurora && auroraFrom === g.data) return aurora;
    auroraFrom = g.data;
    aurora = document.createElement('canvas');
    aurora.width = 360;
    aurora.height = 181;
    const c = aurora.getContext('2d')!;
    const img = c.createImageData(360, 181);
    for (let la = 0; la < 181; la++)
      for (let lo = 0; lo < 360; lo++) {
        const v = g.data[la * 360 + lo];
        // Map column: longitude −180..180 from the left.
        const col = (lo + 180) % 360;
        const k = ((180 - la) * 360 + col) * 4;
        img.data[k] = 60;
        img.data[k + 1] = 255;
        img.data[k + 2] = 120;
        img.data[k + 3] = Math.min(170, v * 3.5);
      }
    c.putImageData(img, 0, 0);
    return aurora;
  }

  function layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    // Fit the 2:1 map to the screen.
    const mw = Math.min(W, H * 2) * view.s;
    return { W, H, dpr, mw, mh: mw / 2, ox: (W - mw) / 2 + view.x, oy: (H - mw / 2) / 2 + view.y };
  }

  let last = 0;
  function draw() {
    if (canvas.hidden) return;
    const now = performance.now();
    if (now - last < 66) return;
    last = now;
    const L = layout();
    const g = canvas.getContext('2d')!;
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.fillStyle = '#02040a';
    g.fillRect(0, 0, L.W, L.H);
    const X = (lon: number) => L.ox + ((lon + 180) / 360) * L.mw;
    const Y = (lat: number) => L.oy + ((90 - lat) / 180) * L.mh;
    if (day.complete && day.naturalWidth) g.drawImage(day, L.ox, L.oy, L.mw, L.mh);
    const t = app.clock.now();
    const gm = gmst(t);
    // Night side, with city lights.
    const sun = sunDirectionEci(t);
    const sunLon = Math.atan2(sun[1], sun[0]) - gm;
    const dec = Math.asin(sun[2]);
    g.save();
    g.beginPath();
    for (let i = 0; i <= 360; i++) {
      const lon = -180 + i;
      const lat = Math.atan(-Math.cos(lon * DEG - sunLon) / Math.tan(dec || 1e-6)) / DEG;
      if (i === 0) g.moveTo(X(lon), Y(lat));
      else g.lineTo(X(lon), Y(lat));
    }
    const pole = dec > 0 ? -90 : 90;
    g.lineTo(X(180), Y(pole));
    g.lineTo(X(-180), Y(pole));
    g.closePath();
    g.clip();
    g.fillStyle = 'rgba(0,3,12,0.78)';
    g.fillRect(L.ox, L.oy, L.mw, L.mh);
    if (night.complete && night.naturalWidth) {
      g.globalAlpha = 0.85;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(night, L.ox, L.oy, L.mw, L.mh);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    g.restore();
    if (app.settings.aurora) {
      const a = auroraImage();
      if (a) {
        g.imageSmoothingEnabled = true;
        g.drawImage(a, L.ox, L.oy, L.mw, L.mh);
      }
    }
    // Graticule
    g.strokeStyle = 'rgba(160,190,255,0.10)';
    g.lineWidth = 1;
    for (let lon = -150; lon < 180; lon += 30) {
      g.beginPath();
      g.moveTo(X(lon), L.oy);
      g.lineTo(X(lon), L.oy + L.mh);
      g.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      g.beginPath();
      g.moveTo(L.ox, Y(lat));
      g.lineTo(L.ox + L.mw, Y(lat));
      g.stroke();
    }

    // Objects
    const tmp = { x: 0, y: 0, z: 0 };
    const list = app.visibleList.length === app.universe.length ? app.cat.objects.slice(0, app.liveCount) : app.visibleList;
    const r = list.length > 8000 ? 1.1 : list.length > 1500 ? 1.6 : 2.4;
    pts = [];
    for (const o of list) {
      if (!app.isLiveObject(o) || !app.prop.valid[o.idx] || !app.launched(o.idx)) continue;
      app.prop.position(o.idx, t, tmp);
      const rr = Math.hypot(tmp.x, tmp.y, tmp.z);
      const lat = Math.asin(tmp.y / rr) / DEG;
      let lon = (Math.atan2(-tmp.z, tmp.x) - gm) / DEG;
      lon = ((((lon + 180) % 360) + 360) % 360) - 180;
      const x = X(lon);
      const y = Y(lat);
      if (x < -4 || y < -4 || x > L.W + 4 || y > L.H + 4) continue;
      g.fillStyle = app.colorsHex[o.idx];
      g.fillRect(x - r / 2, y - r / 2, r, r);
      pts.push({ x, y, o });
    }

    // Selected: ground track ±1 orbit and a ring.
    const sel = app.selected;
    if (sel && app.isLiveObject(sel)) {
      if (trackFor !== sel.idx || Math.abs(t - trackAt) > (sel.period * 60e3) / 30) {
        trackFor = sel.idx;
        trackAt = t;
        track = [];
        const rec = satrecFor(sel);
        const span = Math.min(sel.period * 60e3, 12 * 3600e3);
        if (rec)
          for (let i = 0; i <= 360; i++) {
            const ts = t + ((i / 360) * 2 - 1) * span;
            const st = stateAt(rec, ts);
            if (st) track.push(eciToGeodetic(st.position.x, st.position.y, st.position.z, gmst(ts)));
          }
      }
      g.strokeStyle = app.colorsHex[sel.idx];
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < track.length; i++) {
        const p = track[i];
        const q = track[i - 1];
        if (!q || Math.abs(p.lon - q.lon) > 180) g.moveTo(X(p.lon), Y(p.lat));
        else g.lineTo(X(p.lon), Y(p.lat));
      }
      g.stroke();
      const me = pts.find((p) => p.o === sel);
      if (me) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(me.x, me.y, 7, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // Observer
    const ob = app.observer;
    if (ob) {
      const x = X(ob.lon);
      const y = Y(ob.lat);
      g.fillStyle = '#fab219';
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#02040a';
      g.lineWidth = 1.5;
      g.stroke();
    }
  }

  // ---------- interaction ----------
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag && e.buttons) {
      view.x = drag.vx + e.clientX - drag.x;
      view.y = drag.vy + e.clientY - drag.y;
      last = 0;
      return;
    }
    let bd = 64;
    hit = null;
    for (const p of pts) {
      const d = (p.x - e.clientX) ** 2 + (p.y - e.clientY) ** 2;
      if (d < bd) {
        bd = d;
        hit = p.o;
      }
    }
    canvas.style.cursor = hit ? 'pointer' : 'grab';
    app.setHover(hit);
    if (!hit) {
      tooltip.hidden = true;
      return;
    }
    tooltip.hidden = false;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.replaceChildren(h('b', null, hit.name), h('div', { class: 'tt-sub' }, `${hit.norad} · ${TYPE_LABEL[hit.type]} · ${fmtKm((hit.perigee + hit.apogee) / 2)} km`));
  });
  canvas.addEventListener('pointerup', (e) => {
    const moved = drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4;
    drag = null;
    if (!moved && hit) app.select(hit, { fly: false });
  });
  canvas.addEventListener('pointerleave', () => {
    tooltip.hidden = true;
    app.setHover(null);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * 0.0015);
      const s1 = Math.min(12, Math.max(1, view.s * k));
      const f = s1 / view.s;
      // Zoom about the cursor.
      const cx = e.clientX - window.innerWidth / 2;
      const cy = e.clientY - window.innerHeight / 2;
      view = { s: s1, x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f };
      if (s1 === 1) view.x = view.y = 0;
      last = 0;
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', () => ((view = { s: 1, x: 0, y: 0 }), (last = 0)));

  app.setFlatMap = (on: boolean) => {
    if (on && app.skyView.active) app.exitSkyView();
    if (on && app.closeup.active) app.exitCloseup();
    app.flatMap = on;
    canvas.hidden = !on;
    document.body.classList.toggle('flatmap-on', on);
    if (on) {
      load();
      last = 0;
      if (app.settings.aurora) void app.refreshAurora();
    }
    app.emit('settings');
  };
  app.on('frame', draw);
  app.on('skyview', () => app.skyView.active && app.flatMap && app.setFlatMap(false));
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'm' || e.key === 'M') app.setFlatMap(!app.flatMap);
  });
}
