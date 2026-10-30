import * as THREE from 'three';
import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { eciToScene, moonPhase, moonPositionEci, raDecToScene, sunDirectionEci } from '../sim/astro';
import { describeMag, fmtMag } from '../sim/brightness';
import { compass, findPasses, type Pass } from '../sim/observer';
import { satrecFor } from '../render/orbits';
import { PLANETS } from '../sim/planets';
import { STAR_RADIUS } from '../render/celestial';
import { fmtInt, h, icon } from './dom';
import { fmtObserver } from './sky';

export const ICON_SKY = '<path d="M3 18h18"/><path d="M5 18a7 7 0 0 1 14 0"/><circle cx="8" cy="6" r="1"/><circle cx="16" cy="5" r="1"/><circle cx="19" cy="10" r="0.8"/><circle cx="4" cy="11" r="0.8"/>';
const ICON_PHONE = '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>';
const ICON_GRID = '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>';
const ICON_FIG = '<path d="m4 18 5-7 4 3 7-9"/><circle cx="4" cy="18" r="1.4"/><circle cx="9" cy="11" r="1.4"/><circle cx="13" cy="14" r="1.4"/><circle cx="20" cy="5" r="1.4"/>';
const ICON_TAG = '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>';
const ICON_ASK = '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>';
const X = '<path d="M6 6l12 12M18 6 6 18"/>';
const ICON_RED = '<path d="M12 3a6 6 0 0 0-6 6c0 3.5 3 5 3 8h6c0-3 3-4.5 3-8a6 6 0 0 0-6-6z"/><path d="M9.5 20.5h5"/>';
const ICON_BINO = '<circle cx="7" cy="15" r="4"/><circle cx="17" cy="15" r="4"/><path d="M7 11V6a2 2 0 0 1 4 0v6M17 11V6a2 2 0 0 0-4 0v6M11 13h2"/>';

/** Field-of-view circles for common instruments (true field, degrees). */
const SCOPES: { label: string; deg: number }[] = [
  { label: '10×50 binoculars', deg: 6.5 },
  { label: 'Finder scope 8×50', deg: 5 },
  { label: 'Telescope, low power', deg: 1.2 },
];

const CARDINALS: [string, number][] = [
  ['N', 0],
  ['NE', 45],
  ['E', 90],
  ['SE', 135],
  ['S', 180],
  ['SW', 225],
  ['W', 270],
  ['NW', 315],
];
const SAT_LABELS = 10;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The sky view's controls, labels and heads-up display. */
export function mountSkyView(app: App) {
  const canvas = app.stage.renderer.domElement;
  const sv = app.skyView;

  // ---------- look around ----------
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (!sv.active) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!sv.active || !p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 1 && !sv.ar) {
      // Drag the sky: degrees per pixel follow the field of view.
      const k = sv.fov / canvas.clientHeight;
      sv.az = (((sv.az - dx * k) % 360) + 360) % 360;
      sv.el = THREE.MathUtils.clamp(sv.el + dy * k, -10, 89.5);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) sv.fov = THREE.MathUtils.clamp((sv.fov * pinch) / d, 15, 110);
      pinch = d;
    }
  });
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!sv.active) return;
      e.preventDefault();
      sv.fov = THREE.MathUtils.clamp(sv.fov * Math.exp(e.deltaY * 0.001), 15, 110);
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    if (!sv.active || e.target instanceof HTMLInputElement) return;
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowLeft') sv.az = (sv.az - step + 360) % 360;
    else if (e.key === 'ArrowRight') sv.az = (sv.az + step) % 360;
    else if (e.key === 'ArrowUp') sv.el = Math.min(89.5, sv.el + step);
    else if (e.key === 'ArrowDown') sv.el = Math.max(-10, sv.el - step);
    else if (e.key === '+' || e.key === '=') sv.fov = Math.max(15, sv.fov / 1.2);
    else if (e.key === '-') sv.fov = Math.min(110, sv.fov * 1.2);
    else return;
    e.preventDefault();
  });

  // ---------- point your phone ----------
  type OrientEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };
  let absolute = false;
  const euler = new THREE.Euler();
  const qBack = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // look out of the back, not the top
  const zee = new THREE.Vector3(0, 0, 1);
  const onOrient = (e: OrientEvt, isAbsolute: boolean) => {
    if (!sv.ar || e.beta === null || e.gamma === null) return;
    if (isAbsolute) absolute = true;
    else if (absolute) return; // prefer the absolute (compass-referenced) stream
    // iOS gives a compass heading; elsewhere alpha is measured counter-clockwise from north.
    const alpha = e.webkitCompassHeading !== undefined ? 360 - e.webkitCompassHeading : (e.alpha ?? 0);
    const orient = (screen.orientation?.angle ?? 0) * (Math.PI / 180);
    const d = THREE.MathUtils.degToRad;
    euler.set(d(e.beta), d(alpha), -d(e.gamma), 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(euler).multiply(qBack).multiply(new THREE.Quaternion().setFromAxisAngle(zee, -orient));
    app.arDevice = q;
    compassNote.hidden = isAbsolute || e.webkitCompassHeading !== undefined;
  };
  const absHandler = (e: Event) => onOrient(e as OrientEvt, true);
  const relHandler = (e: Event) => onOrient(e as OrientEvt, false);
  async function setAR(on: boolean) {
    if (on) {
      const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
      if (!DOE) return;
      if (DOE.requestPermission) {
        try {
          // iOS asks the user; some browsers answer 'prompt' and then simply deliver events.
          if ((await DOE.requestPermission()) === 'denied') {
            app.alerts?.toast('Motion access was denied', 'Allow motion and orientation access for this site to point your phone at the sky.');
            return;
          }
        } catch {
          return;
        }
      }
      absolute = false;
      window.addEventListener('deviceorientationabsolute', absHandler, true);
      window.addEventListener('deviceorientation', relHandler, true);
      sv.ar = true;
      sv.fov = Math.max(sv.fov, 60);
    } else {
      window.removeEventListener('deviceorientationabsolute', absHandler, true);
      window.removeEventListener('deviceorientation', relHandler, true);
      sv.ar = false;
      app.arDevice = null;
      compassNote.hidden = true;
    }
    sync();
  }
  const hasSensors = 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches;

  // ---------- heads-up display ----------
  const where = h('div', { class: 'sv-where' });
  const status = h('div', { class: 'sv-status' });
  const seg = h(
    'div',
    { class: 'seg sv-seg', role: 'group', 'aria-label': 'Which objects' },
    h('button', { 'data-k': 'eye', title: 'Only what you could see with your eyes right now', onclick: () => ((sv.showAll = false), sync()) }, 'Visible to eye'),
    h('button', { 'data-k': 'all', title: 'Every tracked object above the horizon, dimmed if too faint or in shadow', onclick: () => ((sv.showAll = true), sync()) }, 'All tracked'),
  );
  const tool = (path: string, label: string, onclick: () => void) => h('button', { class: 'icon-mini sv-tool', title: label, 'aria-label': label, onclick }, icon(path));
  const gridBtn = tool(ICON_GRID, 'Altitude / azimuth grid', () => ((sv.grid = !sv.grid), sync()));
  const figBtn = tool(ICON_FIG, 'Constellation figures', () => app.setSetting('constellations', !app.settings.constellations));
  const tagBtn = tool(ICON_TAG, 'Labels', () => app.setSetting('labels', !app.settings.labels));
  const redBtn = tool(ICON_RED, 'Red night-vision mode', () => app.setSetting('nightRed', !app.settings.nightRed));
  let scope = -1;
  const scopeBtn = tool(ICON_BINO, 'Binocular / telescope field of view', () => {
    scope = scope + 1 >= SCOPES.length ? -1 : scope + 1;
    sync();
  });
  const arBtn = h('button', { class: 'btn sv-ar', hidden: !hasSensors, onclick: () => setAR(!sv.ar) }, icon(ICON_PHONE), 'Point phone');
  const askBtn = h('button', { class: 'btn', title: 'Identify something you saw', onclick: () => app.openIdentify() }, icon(ICON_ASK), 'What did I see?');
  const compassNote = h('div', { class: 'sv-note', hidden: true }, "This device doesn't report a compass heading, so north may be off: turn on the spot until the labels line up.");
  const hud = h(
    'div',
    { class: 'skyview-hud', hidden: true, role: 'region', 'aria-label': 'Sky view' },
    h('div', { class: 'sv-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Sky view'), where), h('button', { class: 'icon-mini', 'aria-label': 'Leave sky view', title: 'Leave sky view (Esc)', onclick: () => app.exitSkyView() }, icon(X))),
    status,
    h('div', { class: 'sv-row' }, seg, gridBtn, figBtn, tagBtn),
    h('div', { class: 'sv-row' }, arBtn, askBtn, scopeBtn, redBtn),
    compassNote,
  );
  const heading = h('div', { class: 'sv-heading', hidden: true });
  // Instrument field of view, centred where you're looking.
  const fovRing = h('div', { class: 'sv-fov', hidden: true }, h('span'));
  // Guidance toward the selected object when it's off-screen or below the horizon.
  const guide = h('div', { class: 'sv-guide', hidden: true }, h('i', { class: 'sv-arrow' }), h('span'));
  const labels = h('div', { class: 'sv-labels', hidden: true });
  document.getElementById('app')!.append(hud, heading);
  document.getElementById('overlay')!.append(labels, fovRing);
  document.getElementById('app')!.append(guide);

  // ---------- labels ----------
  type Label = { el: HTMLElement; pos: THREE.Vector3 };
  const mk = (cls: string, text: string) => {
    const el = h('div', { class: `sv-label ${cls}` }, text);
    labels.append(el);
    return el;
  };
  const cardinal: Label[] = CARDINALS.map(([n]) => ({ el: mk(n.length === 1 ? 'card main' : 'card', n), pos: new THREE.Vector3() }));
  let starLabels: Label[] = [];
  let figLabels: Label[] = [];
  const sunLabel: Label = { el: mk('body sun', 'Sun'), pos: new THREE.Vector3() };
  const moonLabel: Label = { el: mk('body moon', 'Moon'), pos: new THREE.Vector3() };
  const planetLabels: HTMLElement[] = PLANETS.map((p) => mk('body planet', p.name));
  const satLabels: { el: HTMLElement; o: SatObject | null }[] = Array.from({ length: SAT_LABELS + 1 }, () => ({ el: mk('sat', ''), o: null }));
  void app.celestial.ready.then(() => {
    starLabels = app.celestial.named.filter((s) => s.mag < 1.6).map((s) => ({ el: mk('star', s.name), pos: raDecToScene(s.ra, s.dec, STAR_RADIUS) }));
    figLabels = app.celestial.figures.filter((f) => f.label && f.rank <= 2).map((f) => ({ el: mk('fig', f.name), pos: raDecToScene(f.label![0], f.label![1], STAR_RADIUS) }));
  });

  const v = new THREE.Vector3();
  const cam = app.stage.camera;
  const fwd = new THREE.Vector3();
  function place(el: HTMLElement, world: THREE.Vector3, up: THREE.Vector3, W: number, H: number, minEl = 0) {
    v.copy(world).sub(cam.position);
    const len = v.length();
    if (v.dot(up) / len < Math.sin((minEl * Math.PI) / 180) || v.dot(fwd) <= 0) {
      el.hidden = true;
      return false;
    }
    v.copy(world).project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) {
      el.hidden = true;
      return false;
    }
    el.hidden = false;
    el.style.transform = `translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((1 - (v.y * 0.5 + 0.5)) * H).toFixed(1)}px)`;
    return true;
  }

  let brightest: SatObject[] = [];
  let lastList = 0;
  let lastHud = 0;
  app.on('frame', () => {
    if (!sv.active || !app.observer) return;
    const t = app.clock.now();
    const f = app.observerFrameAt(t)!;
    const up = new THREE.Vector3(...f.up);
    const east = new THREE.Vector3(...f.east);
    const north = new THREE.Vector3(...f.north);
    cam.getWorldDirection(fwd);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const show = app.settings.labels;

    CARDINALS.forEach(([, az], i) => {
      const a = (az * Math.PI) / 180;
      const p = east.clone().multiplyScalar(Math.sin(a)).addScaledVector(north, Math.cos(a)).addScaledVector(up, 0.012).multiplyScalar(500).add(cam.position);
      place(cardinal[i].el, p, up, W, H, -1);
    });
    for (const l of starLabels) if (!show || !app.settings.stars || app.sunEl > -4 || !place(l.el, l.pos, up, W, H)) l.el.hidden = true;
    for (const l of figLabels) if (!app.settings.constellations || !place(l.el, l.pos, up, W, H)) l.el.hidden = true;
    const s = sunDirectionEci(t);
    sunLabel.pos.copy(eciToScene(s[0], s[1], s[2]).normalize().multiplyScalar(800).add(cam.position));
    if (!show || !app.settings.sun || !place(sunLabel.el, sunLabel.pos, up, W, H, -1)) sunLabel.el.hidden = true;
    const m = moonPositionEci(t);
    eciToScene(m[0], m[1], m[2], moonLabel.pos);
    if (!show || !app.settings.moon || !place(moonLabel.el, moonLabel.pos, up, W, H, -1)) moonLabel.el.hidden = true;
    const pInfo = app.celestial.planetInfo;
    planetLabels.forEach((el, i) => {
      const p = pInfo[i];
      // Planets show once they'd be visible: brighter than the sky's current limit.
      if (!show || !app.settings.planets || !p || p.mag > app.celestial.starUniforms.uLimit.value + 0.5 || !place(el, app.celestial.planetScene[i], up, W, H, -1)) el.hidden = true;
    });

    // The brightest satellites in view get names; the list refreshes each second.
    if (performance.now() - lastList > 1000) {
      lastList = performance.now();
      const cand: SatObject[] = [];
      const all = app.visibleList.length === app.universe.length;
      for (let i = 0; i < app.liveCount; i++) if (app.skyMag[i] < 3 && (all || app.visible[i])) cand.push(app.cat.objects[i]);
      brightest = cand.sort((a, b) => app.skyMag[a.idx] - app.skyMag[b.idx]).slice(0, SAT_LABELS);
      moonLabel.el.textContent = `Moon · ${Math.round(moonPhase(t).illum * 100)}%`;
    }
    const sel = app.selected;
    const list = sel && app.isLiveObject(sel) && !brightest.includes(sel) ? [...brightest, sel] : brightest;
    satLabels.forEach((l, i) => {
      const o = list[i];
      if (!o || (!show && o !== sel)) {
        l.el.hidden = true;
        return;
      }
      if (l.o !== o) {
        l.o = o;
        const mag = app.skyMag[o.idx];
        l.el.replaceChildren(o.name.replace(/\s*\(.*\)$/, ''), mag < 50 ? h('small', null, fmtMag(mag)) : '');
      }
      l.el.classList.toggle('sel', o === sel);
      place(l.el, app.scenePosition(o, v.clone(), t), up, W, H);
    });

    // Heading
    const az = ((THREE.MathUtils.radToDeg(Math.atan2(fwd.dot(east), fwd.dot(north))) % 360) + 360) % 360;
    const el = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(fwd.dot(up), -1, 1)));
    updateGuide(t, up, W, H, az, el);
    if (scope >= 0) {
      // True field to screen pixels for the current (vertical) field of view.
      const r = (Math.tan(((SCOPES[scope].deg / 2) * Math.PI) / 180) / Math.tan(((cam.fov / 2) * Math.PI) / 180)) * (H / 2);
      fovRing.style.width = fovRing.style.height = `${(2 * r).toFixed(1)}px`;
      fovRing.style.left = `${W / 2}px`;
      fovRing.style.top = `${H / 2}px`;
    }
    heading.textContent = `Facing ${compass(az)} · ${Math.round(az)}° · ${Math.round(el)}° up · ${Math.round(sv.fov)}° view`;

    if (performance.now() - lastHud > 1000) {
      lastHud = performance.now();
      renderStatus(t);
    }
  });

  // ---------- guidance to the selected object ----------
  let guideFor: SatObject | null = null;
  let nextPass: Pass | null | 'never' | 'always' = null;
  let passAt = 0;
  const pv = new THREE.Vector3();
  const camInv = new THREE.Quaternion();
  function updateGuide(t: number, up: THREE.Vector3, W: number, H: number, az: number, el: number) {
    const o = app.selected;
    if (!o || !app.isLiveObject(o) || !app.hasPosition(o) || !app.observer) {
      guide.hidden = true;
      return;
    }
    app.scenePosition(o, pv, t).sub(cam.position);
    const d = pv.length();
    const elev = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(pv.dot(up) / d, -1, 1)));
    const label = guide.lastChild as HTMLElement;
    const name = o.name.replace(/\s*\(.*\)$/, '');
    if (elev < 0) {
      // Below the horizon: when and where it rises next (refreshed each minute).
      if (guideFor !== o || Math.abs(t - passAt) > 60e3) {
        guideFor = o;
        passAt = t;
        const rec = satrecFor(o);
        const ps = rec ? findPasses(rec, app.observer, t, 24, 0, o.period, app.stdMag(o).mag) : 'never';
        nextPass = Array.isArray(ps) ? (ps.find((p) => p.rise > t) ?? null) : ps;
      }
      const p = nextPass;
      guide.hidden = false;
      guide.classList.add('below');
      guide.style.transform = '';
      label.replaceChildren(
        h('b', null, name),
        p && typeof p === 'object'
          ? ` is below the horizon. Rises in ${fmtIn(p.rise - t)} in the ${compass(p.riseAz)}, highest ${Math.round(p.maxEl)}° in the ${compass(p.peakAz)}${p.visible ? ' (visible)' : ''}.`
          : ' is below the horizon and doesn’t rise in the next 24 hours.',
      );
      return;
    }
    guide.classList.remove('below');
    // On screen already? No arrow needed.
    const ndc = pv.clone().add(cam.position).project(cam);
    const front = pv.dot(fwd) > 0;
    if (front && Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.85) {
      guide.hidden = true;
      return;
    }
    // Direction in camera space: right = +x, up = +y.
    camInv.copy(cam.quaternion).invert();
    const q = pv.clone().applyQuaternion(camInv);
    let ang = Math.atan2(q.y, q.x);
    if (!front && Math.abs(q.x) < 1e-3 && Math.abs(q.y) < 1e-3) ang = 0;
    // Keep the arrow inside the part of the screen the panels leave uncovered.
    const r = safeRect(W, H);
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const x = cx + Math.cos(ang) * ((r.right - r.left) / 2 - 22);
    const y = cy - Math.sin(ang) * ((r.bottom - r.top) / 2 - 22);
    const flip = x > cx;
    guide.hidden = false;
    guide.classList.toggle('flip', flip);
    guide.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)${flip ? ' translateX(-100%)' : ''}`;
    (guide.firstChild as HTMLElement).style.transform = `rotate(${(-ang * 180) / Math.PI}deg)`;
    const oaz = ((app.skyAz[o.idx] % 360) + 360) % 360;
    let dAz = oaz - az;
    if (dAz > 180) dAz -= 360;
    if (dAz < -180) dAz += 360;
    const turn = Math.abs(dAz) < 8 ? '' : `turn ${dAz > 0 ? 'right' : 'left'} ${Math.round(Math.abs(dAz))}°`;
    const tilt = Math.abs(elev - el) < 8 ? '' : `look ${elev > el ? 'up' : 'down'} ${Math.round(Math.abs(elev - el))}°`;
    label.replaceChildren(h('b', null, name), ` ${[turn, tilt].filter(Boolean).join(', ') || 'just off screen'} · ${Math.round(elev)}° up in the ${compass(oaz)}`);
  }
  /** The canvas area not covered by the HUD, top bar, timeline or info panel. */
  function safeRect(W: number, H: number) {
    const rect = (el: Element | null) => (el && !(el as HTMLElement).hidden ? el.getBoundingClientRect() : null);
    const r = { left: 8, right: W - 8, top: 8, bottom: H - 8 };
    const top = rect(document.querySelector('.topbar'));
    if (top) r.top = Math.max(r.top, top.bottom + 8);
    const hudR = rect(hud);
    // A full-width HUD (phones) pushes the area down; a corner one pushes it right.
    if (hudR && hudR.width > W * 0.6) r.top = Math.max(r.top, hudR.bottom + 8);
    else if (hudR) r.left = Math.max(r.left, hudR.right + 8);
    const bar = rect(document.getElementById('timebar'));
    if (bar && bar.height) r.bottom = Math.min(r.bottom, bar.top - 8);
    const info = rect(document.getElementById('info'));
    if (info && info.width) {
      if (info.width > W * 0.6) r.bottom = Math.min(r.bottom, info.top - 8);
      else r.right = Math.min(r.right, info.left - 8);
    }
    if (r.bottom - r.top < 120) r.top = Math.max(8, r.bottom - 120);
    return r;
  }
  const fmtIn = (ms: number) => {
    const m = Math.max(0, Math.round(ms / 60e3));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  };

  function renderStatus(t: number) {
    const sun = app.sunEl;
    const sky = sun > 0 ? 'Daylight' : sun > -6 ? 'Civil twilight' : sun > -12 ? 'Nautical twilight' : sun > -18 ? 'Astronomical twilight' : 'Night';
    let up = 0;
    let seen = 0;
    const limit = app.skyLimit();
    for (let i = 0; i < app.liveCount; i++) {
      if (app.skyEl[i] <= 0) continue;
      up++;
      if (app.skyMag[i] <= limit) seen++;
    }
    status.replaceChildren(
      h('div', null, h('b', null, sky), ` · Sun ${Math.round(sun)}° · ${timeFmt.format(t)}`),
      h('div', null, h('b', { class: 'mono' }, fmtInt(up)), ' above the horizon · ', h('b', { class: 'mono' }, fmtInt(seen)), ` bright enough to see (mag ≤ ${fmtMag(limit)}, ${describeMag(limit)})`),
    );
  }

  function sync() {
    const on = sv.active;
    hud.hidden = heading.hidden = labels.hidden = !on;
    fovRing.hidden = !on || scope < 0;
    if (!on) guide.hidden = true;
    if (!on) {
      if (sv.ar) void setAR(false);
      return;
    }
    if (app.observer) where.textContent = fmtObserver(app.observer);
    for (const b of seg.children) b.setAttribute('aria-pressed', String(((b as HTMLElement).dataset.k === 'all') === sv.showAll));
    gridBtn.setAttribute('aria-pressed', String(sv.grid));
    figBtn.setAttribute('aria-pressed', String(app.settings.constellations));
    tagBtn.setAttribute('aria-pressed', String(app.settings.labels));
    redBtn.setAttribute('aria-pressed', String(app.settings.nightRed));
    scopeBtn.setAttribute('aria-pressed', String(scope >= 0));
    scopeBtn.title = scope >= 0 ? `${SCOPES[scope].label} (${SCOPES[scope].deg}°) · click for the next` : 'Binocular / telescope field of view';
    if (scope >= 0) (fovRing.firstChild as HTMLElement).textContent = `${SCOPES[scope].label} · ${SCOPES[scope].deg}°`;
    arBtn.setAttribute('aria-pressed', String(sv.ar));
    arBtn.replaceChildren(icon(ICON_PHONE), sv.ar ? 'Stop pointing' : 'Point phone');
    renderStatus(app.clock.now());
  }
  app.on('skyview', sync);
  app.on('settings', sync);
  app.on('observer', sync);
  sync();
}
