import type { App } from '../app';
import { describeMag, fmtMag, NAKED_EYE_MAG, SKY_QUALITY, skyQuality, type SkyQuality } from '../sim/brightness';
import { cloudAt, describeCloud } from '../data/weather';
import { TYPE_LABEL, type SatObject } from '../data/catalog';
import type { SkyFilter } from '../data/model';
import { satrecFor } from '../render/orbits';
import { compass, lookAt, sunScene, type Observer } from '../sim/observer';
import { $, fmt, fmtInt, fmtKm, h, icon } from './dom';
import { mountPlanner } from './planner';
import { ICON_SKY } from './skyview';

const PIN = '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>';
const LOCATE = '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>';
const GLOBE = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>';
const EDIT = '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>';
const X = '<path d="M6 6l12 12M18 6 6 18"/>';

export function fmtObserver(o: Observer) {
  const lat = `${fmt(Math.abs(o.lat), 3)}° ${o.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${fmt(Math.abs(o.lon), 3)}° ${o.lon >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lon}`;
}

/** Parse "47.6", "-122.3", "47.6, -122.3", "47.6N 122.3W". */
function parseCoord(v: string, isLat: boolean): number | null {
  const m = v.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/i);
  if (!m) return null;
  let n = Number(m[1]);
  const hemi = m[2]?.toUpperCase();
  if (hemi === 'S' || hemi === 'W') n = -Math.abs(n);
  if (isLat ? Math.abs(n) > 90 : Math.abs(n) > 180) return null;
  return n;
}

export function requestDeviceLocation(app: App, onStatus: (msg: string, tone?: 'info' | 'error') => void) {
  if (!('geolocation' in navigator) || !window.isSecureContext) {
    onStatus("This browser can't share its location here. Pick a point on the globe or enter coordinates instead.", 'error');
    return;
  }
  onStatus('Asking your browser for your location…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const first = !app.observer;
      app.setObserver({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        alt: Math.max(0, (pos.coords.altitude ?? 0) / 1000),
        source: 'device',
        accuracy: pos.coords.accuracy,
      });
      onStatus(pos.coords.accuracy > 5000 ? `Location is approximate (±${fmtKm(pos.coords.accuracy / 1000)} km). Edit it if it looks wrong.` : '');
      if (first && app.filters.sky === 'off') app.setFilters({ sky: 'above' });
      app.flyToObserver();
    },
    (err) => {
      const msg =
        err.code === err.PERMISSION_DENIED
          ? 'Location permission was denied. Pick a point on the globe or enter coordinates instead.'
          : err.code === err.TIMEOUT
            ? "Your browser didn't return a location in time. Try again, or set it manually."
            : "Your location couldn't be determined. Pick a point on the globe or enter coordinates instead.";
      onStatus(msg, 'error');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10 * 60e3 },
  );
}

export function mountSkySection(app: App) {
  const status = h('div', { class: 'sky-status', hidden: true });
  const setStatus = (msg: string, tone: 'info' | 'error' = 'info') => {
    status.hidden = !msg;
    status.textContent = msg;
    status.className = `sky-status ${tone}`;
  };

  // ---------- location row ----------
  const locate = () => requestDeviceLocation(app, setStatus);
  const pick = () => {
    app.setPickingLocation(!app.pickingLocation);
    document.body.classList.remove('explorer-open');
  };
  const btn = (path: string, label: string, onclick: () => void, cls = 'btn') => h('button', { class: cls, onclick, title: label, 'aria-label': label }, icon(path), h('span', null, label));

  const intro = h(
    'div',
    { class: 'sky-intro' },
    h('p', null, "See what's overhead from where you are. Your location stays in this browser."),
    h('div', { class: 'sky-actions' }, btn(LOCATE, 'Use my location', locate, 'btn primary'), btn(GLOBE, 'Pick on globe', pick), btn(EDIT, 'Enter coordinates', () => openForm())),
  );

  const locText = h('div', { class: 'sky-loc-text' });
  const locRow = h(
    'div',
    { class: 'sky-loc' },
    icon(PIN, 'sky-pin'),
    locText,
    h(
      'div',
      { class: 'sky-loc-btns' },
      h('button', { class: 'icon-mini', title: 'Use my device location', 'aria-label': 'Use my device location', onclick: locate }, icon(LOCATE)),
      h('button', { class: 'icon-mini', title: 'Pick on globe', 'aria-label': 'Pick location on globe', onclick: pick }, icon(GLOBE)),
      h('button', { class: 'icon-mini', title: 'Edit coordinates', 'aria-label': 'Edit coordinates', onclick: () => openForm() }, icon(EDIT)),
      h('button', { class: 'icon-mini', title: 'Forget location', 'aria-label': 'Forget location', onclick: () => app.setObserver(null) }, icon(X)),
    ),
  );

  // ---------- manual form ----------
  const latIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'e.g. 47.6062', 'aria-label': 'Latitude' });
  const lonIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'e.g. -122.3321', 'aria-label': 'Longitude' });
  const altIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Elevation in metres' });
  const formErr = h('div', { class: 'sky-status error', hidden: true });
  const form = h(
    'form',
    { class: 'sky-form', hidden: true, novalidate: true },
    h('label', null, h('span', null, 'Latitude'), latIn),
    h('label', null, h('span', null, 'Longitude'), lonIn),
    h('label', null, h('span', null, 'Elevation (m)'), altIn),
    h('p', { class: 'sky-hint' }, 'Decimal degrees; south and west are negative (or use N/S/E/W). You can paste "47.6, -122.3" into Latitude.'),
    formErr,
    h('div', { class: 'sky-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save location'), h('button', { class: 'btn', type: 'button', onclick: () => (form.hidden = true) }, 'Cancel')),
  );
  latIn.addEventListener('paste', (e) => {
    const t = e.clipboardData?.getData('text') ?? '';
    const parts = t.split(/[,;\s]+/).filter(Boolean);
    if (parts.length >= 2) {
      e.preventDefault();
      latIn.value = parts[0];
      lonIn.value = parts[1];
    }
  });
  function openForm() {
    const o = app.observer;
    latIn.value = o ? o.lat.toFixed(5) : '';
    lonIn.value = o ? o.lon.toFixed(5) : '';
    altIn.value = o ? String(Math.round(o.alt * 1000)) : '';
    formErr.hidden = true;
    form.hidden = false;
    latIn.focus();
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const lat = parseCoord(latIn.value, true);
    const lon = parseCoord(lonIn.value, false);
    const altM = altIn.value.trim() ? Number(altIn.value) : 0;
    if (lat === null || lon === null || !Number.isFinite(altM) || altM < -500 || altM > 9000) {
      formErr.hidden = false;
      formErr.textContent =
        lat === null ? 'Latitude must be between -90 and 90.' : lon === null ? 'Longitude must be between -180 and 180.' : 'Elevation must be between -500 and 9,000 m.';
      return;
    }
    const first = !app.observer;
    app.setObserver({ lat, lon, alt: altM / 1000, source: 'manual' });
    form.hidden = true;
    setStatus('');
    if (first && app.filters.sky === 'off') app.setFilters({ sky: 'above' });
    app.flyToObserver();
  });

  // ---------- filter controls ----------
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Sky filter' });
  for (const [k, l, tip] of [
    ['off', 'Everything', 'No sky filter'],
    ['above', 'Above horizon', 'Objects above the minimum elevation from your location'],
    ['visible', 'Visible to eye', `Sunlit, predicted brighter than magnitude ${NAKED_EYE_MAG} and above the minimum elevation, while your sky is dark`],
  ] as [SkyFilter, string, string][]) {
    seg.append(h('button', { 'data-k': k, title: tip, onclick: () => app.setFilters({ sky: k }) }, l));
  }
  const elVal = h('span', { class: 'mono' });
  const elIn = h('input', { type: 'range', min: 0, max: 60, step: 1, class: 'el-range', 'aria-label': 'Minimum elevation' });
  elIn.addEventListener('input', () => {
    elVal.textContent = `${elIn.value}°`;
    app.setFilters({ minEl: Number(elIn.value) });
  });
  const elRow = h('div', { class: 'sky-el' }, h('span', null, 'Minimum elevation'), elIn, elVal);

  // ---------- observing conditions ----------
  const qualSel = h(
    'select',
    { class: 'sky-select', 'aria-label': 'How dark your sky is', onchange: (e: Event) => app.setSkyQuality((e.target as HTMLSelectElement).value as SkyQuality) },
    ...(Object.entries(SKY_QUALITY) as [SkyQuality, (typeof SKY_QUALITY)[SkyQuality]][]).map(([k, q]) => h('option', { value: k }, `${q.label} · mag ${q.mag}`)),
  );
  const qualNote = h('small');
  const wxBtn = h('button', { class: 'chip', onclick: () => app.setWeatherOn(!app.weatherOn) }, 'Cloud forecast');
  const wxNote = h('small');
  const condRow = h(
    'div',
    { class: 'sky-cond' },
    h('label', null, h('span', null, 'Your sky'), qualSel),
    qualNote,
    h('div', { class: 'sky-wx' }, wxBtn, wxNote),
  );
  const summary = h('div', { class: 'sky-summary' });

  // ---------- sky plot ----------
  const plot = h('canvas', { class: 'sky-plot', 'aria-label': 'Sky plot: objects above your horizon' });
  const plotWrap = h('div', { class: 'sky-plot-wrap' }, plot);

  const views = h(
    'div',
    { class: 'sky-actions' },
    h('button', { class: 'btn primary', onclick: () => app.enterSkyView(), title: 'Look up at the sky from your location' }, icon(ICON_SKY), 'Sky view'),
    h('button', { class: 'btn', onclick: () => app.openIdentify(), title: 'Identify a satellite you saw' }, 'What did I see?'),
  );
  const controls = h('div', { class: 'sky-controls' }, locRow, seg, elRow, condRow, summary, plotWrap, views, mountPlanner(app));
  const el = h('div', { class: 'section', id: 'sky-section' }, h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, 'Your sky')), intro, controls, status, form);

  function syncWx() {
    wxBtn.setAttribute('aria-pressed', String(app.weatherOn));
    if (!app.weatherOn) {
      wxNote.textContent = 'Shows cloud cover on passes. Sends your location, rounded to about 10 km, to Open-Meteo.';
      return;
    }
    const c = cloudAt(app.weather, Date.now());
    wxNote.textContent = !app.weather ? 'Loading the forecast…' : c === null ? 'Forecast unavailable right now.' : `Now: ${describeCloud(c).toLowerCase()} (${Math.round(c)}% cloud). Forecast by Open-Meteo.`;
  }
  app.on('weather', syncWx);

  // ---------- render ----------
  function sync() {
    const o = app.observer;
    intro.hidden = !!o;
    controls.hidden = !o;
    if (o) {
      const src = o.source === 'device' ? `Device${o.accuracy ? ` · ±${o.accuracy < 1000 ? Math.round(o.accuracy) + ' m' : fmtKm(o.accuracy / 1000) + ' km'}` : ''}` : o.source === 'globe' ? 'Picked on globe' : 'Entered manually';
      locText.replaceChildren(h('b', null, fmtObserver(o)), h('small', null, `${src} · ${Math.round(o.alt * 1000)} m elevation`));
    }
    for (const b of seg.children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.k === app.filters.sky));
    qualSel.value = skyQuality;
    qualNote.textContent = `${SKY_QUALITY[skyQuality].note}. Satellites count as visible to the eye down to magnitude ${NAKED_EYE_MAG}.`;
    seg.querySelector<HTMLElement>('[data-k="visible"]')!.title = `Sunlit, predicted brighter than magnitude ${NAKED_EYE_MAG} and above the minimum elevation, while your sky is dark`;
    syncWx();
    elRow.hidden = app.filters.sky === 'off';
    elIn.value = String(app.filters.minEl);
    elVal.textContent = `${app.filters.minEl}°`;
    syncSummary();
    drawPlot();
  }

  function syncSummary() {
    if (!app.observer) return;
    const sun = app.sunEl;
    const sunTxt = sun > 0 ? `Sun ${Math.round(sun)}° up` : sun > -6 ? 'Civil twilight' : sun > -18 ? 'Twilight' : 'Night';
    let n = 0;
    const minEl = app.filters.sky === 'off' ? 0 : app.filters.minEl;
    for (const o of app.visibleList) if (app.skyEl[o.idx] >= minEl) n++;
    const what = app.filters.sky === 'visible' ? 'visible to the eye' : `above ${minEl}°`;
    const warn = app.filters.sky === 'visible' && sun >= -6 ? h('div', { class: 'sky-warn' }, "It's too bright at your location: satellites are only visible to the eye once the Sun is 6° below the horizon.") : null;
    summary.replaceChildren(h('div', null, h('b', { class: 'mono' }, fmtInt(n)), ` objects ${what}`, h('span', { class: 'dot-sep' }, '·'), sunTxt), warn ?? '');
  }

  let points: { x: number; y: number; o: SatObject }[] = [];
  let track: { az: number; el: number; t: number }[] = [];
  let trackFor: number | null = null;
  let trackAt = 0;

  function drawPlot() {
    const o = app.observer;
    if (!o || controls.hidden) return;
    const dpr = Math.min(2, window.devicePixelRatio);
    const S = plot.clientWidth || 300;
    plot.width = plot.height = S * dpr;
    const g = plot.getContext('2d')!;
    g.scale(dpr, dpr);
    const cx = S / 2;
    const cy = S / 2;
    const R = S / 2 - 16;
    const proj = (az: number, el: number) => {
      const r = ((90 - Math.max(0, el)) / 90) * R;
      const a = (az * Math.PI) / 180;
      return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
    };
    // Sky colour follows the Sun.
    const sun = app.sunEl;
    const day = Math.min(1, Math.max(0, (sun + 12) / 18));
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    grd.addColorStop(0, `rgba(${Math.round(6 + 30 * day)},${Math.round(10 + 50 * day)},${Math.round(24 + 80 * day)},0.95)`);
    grd.addColorStop(1, `rgba(${Math.round(10 + 60 * day)},${Math.round(16 + 70 * day)},${Math.round(34 + 90 * day)},0.95)`);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    // Grid
    g.strokeStyle = 'rgba(160,190,255,0.14)';
    g.lineWidth = 1;
    for (const el of [0, 30, 60]) {
      g.beginPath();
      g.arc(cx, cy, ((90 - el) / 90) * R, 0, Math.PI * 2);
      g.stroke();
    }
    for (let az = 0; az < 360; az += 45) {
      const p = proj(az, 0);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(p.x, p.y);
      g.stroke();
    }
    if (app.filters.sky !== 'off' && app.filters.minEl > 0) {
      g.setLineDash([3, 4]);
      g.strokeStyle = 'rgba(250,178,25,0.45)';
      g.beginPath();
      g.arc(cx, cy, ((90 - app.filters.minEl) / 90) * R, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    g.font = '600 10px "Inter Variable", system-ui';
    g.fillStyle = '#b4bccc';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [l, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as [string, number][]) {
      const a = (az * Math.PI) / 180;
      g.fillText(l, cx + (R + 9) * Math.sin(a), cy - (R + 9) * Math.cos(a));
    }
    g.font = '9px "JetBrains Mono Variable", monospace';
    g.fillStyle = '#545c6e';
    g.fillText('30°', cx + 3, cy - (60 / 90) * R + 8);
    g.fillText('60°', cx + 3, cy - (30 / 90) * R + 8);

    // Sun
    const f = app.observerFrameAt(app.skyTime || app.clock.now());
    if (f && sun > -2) {
      const s = sunScene(app.skyTime);
      const e = s[0] * f.east[0] + s[1] * f.east[1] + s[2] * f.east[2];
      const nn = s[0] * f.north[0] + s[1] * f.north[1] + s[2] * f.north[2];
      const az = ((Math.atan2(e, nn) * 180) / Math.PI + 360) % 360;
      const p = proj(az, sun);
      const sg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
      sg.addColorStop(0, 'rgba(255,240,200,1)');
      sg.addColorStop(0.35, 'rgba(250,178,25,0.6)');
      sg.addColorStop(1, 'rgba(250,178,25,0)');
      g.fillStyle = sg;
      g.beginPath();
      g.arc(p.x, p.y, 14, 0, Math.PI * 2);
      g.fill();
    }

    // Selected object's track across the sky (±10 min).
    const sel = app.selected;
    if (sel) {
      const now = app.clock.now();
      if (trackFor !== sel.idx || Math.abs(now - trackAt) > 30e3) {
        trackFor = sel.idx;
        trackAt = now;
        track = [];
        const rec = satrecFor(sel);
        if (rec)
          for (let i = -40; i <= 40; i++) {
            const t = now + i * 15e3;
            const la = lookAt(rec, o, t);
            if (la) track.push({ az: la.az, el: la.el, t });
          }
      }
      g.strokeStyle = app.colorsHex[sel.idx];
      g.lineWidth = 2;
      g.globalAlpha = 0.8;
      g.beginPath();
      let pen = false;
      for (const p of track) {
        if (p.el < 0) {
          pen = false;
          continue;
        }
        const q = proj(p.az, p.el);
        if (pen) g.lineTo(q.x, q.y);
        else g.moveTo(q.x, q.y);
        pen = true;
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    // Objects
    const minEl = 0;
    const list = app.visibleList;
    points = [];
    const big = list.length < 400;
    for (const s of list) {
      const el = app.skyEl[s.idx];
      if (el < minEl) continue;
      const p = proj(app.skyAz[s.idx], el);
      points.push({ x: p.x, y: p.y, o: s });
    }
    const r = points.length > 1500 ? 1.2 : big ? 2.4 : 1.7;
    for (const p of points) {
      g.fillStyle = app.colorsHex[p.o.idx];
      g.globalAlpha = app.skyOk[p.o.idx] || app.filters.sky === 'off' ? 1 : 0.35;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    if (sel && app.skyEl[sel.idx] >= 0) {
      const p = proj(app.skyAz[sel.idx], app.skyEl[sel.idx]);
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(p.x, p.y, 6, 0, Math.PI * 2);
      g.stroke();
    }
    // Zenith marker
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(cx - 0.5, cy - 4, 1, 8);
    g.fillRect(cx - 4, cy - 0.5, 8, 1);
  }

  // Hover / click on the plot
  const tooltip = $('#tooltip');
  let hit: SatObject | null = null;
  plot.addEventListener('mousemove', (e) => {
    const r = plot.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let bd = 70;
    hit = null;
    for (const p of points) {
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bd) {
        bd = d;
        hit = p.o;
      }
    }
    plot.style.cursor = hit ? 'pointer' : '';
    app.setHover(hit);
    if (!hit) {
      tooltip.hidden = true;
      return;
    }
    tooltip.hidden = false;
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    const el = app.skyEl[hit.idx];
    const az = app.skyAz[hit.idx];
    tooltip.replaceChildren(
      h('b', null, hit.name),
      h('div', { class: 'tt-sub' }, `${hit.norad} · ${TYPE_LABEL[hit.type]}`),
      h('div', { class: 'tt-row' }, h('span', null, 'Elevation'), h('span', null, `${fmt(el, 1)}°`)),
      h('div', { class: 'tt-row' }, h('span', null, 'Azimuth'), h('span', null, `${fmt(az, 0)}° ${compass(az)}`)),
      h('div', { class: 'tt-row' }, h('span', null, 'Brightness'), h('span', null, app.skyMag[hit.idx] < 50 ? `${fmtMag(app.skyMag[hit.idx])} · ${describeMag(app.skyMag[hit.idx])}` : "in Earth's shadow")),
    );
  });
  plot.addEventListener('mouseleave', () => {
    tooltip.hidden = true;
    app.setHover(null);
  });
  plot.addEventListener('click', () => {
    if (hit) app.select(hit, { fly: true });
  });

  app.on('observer', sync);
  app.on('filters', sync);
  app.on('colors', drawPlot);
  app.on('selection', () => {
    trackFor = null;
    drawPlot();
  });
  app.on('sky', () => {
    syncSummary();
    drawPlot();
  });
  requestAnimationFrame(sync);

  return el;
}
