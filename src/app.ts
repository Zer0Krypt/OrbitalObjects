import * as THREE from 'three';
import { loadHistory, type Catalog, type SatObject } from './data/catalog';
import type { ReentryData, ReentryPrediction } from './data/reentry';
import {
  colorFor,
  defaultFilters,
  extendSearch,
  extendSearchFor,
  hexToRgb,
  passes,
  rankHits,
  tokenize,
  type ColorMode,
  type Filters,
} from './data/model';
import { eciToScene, gmst, sunDirectionEci } from './sim/astro';
import { SimClock } from './sim/clock';
import { loadObserver, lookAngles, observerFrame, saveObserver, sunElevation, sunlitScene, sunScene, type Observer, type ObserverFrame } from './sim/observer';
import { Propagator } from './sim/propagator';
import { createEarth, createSky, type EarthLayers } from './render/earth';
import { OrbitSet, SelectionOverlay } from './render/orbits';
import { SatellitePoints } from './render/satellites';
import { HistoryPoints } from './render/historyPoints';
import { Stage } from './render/scene';

export interface Settings {
  clouds: boolean;
  atmosphere: boolean;
  borders: boolean;
  graticule: boolean;
  bloom: boolean;
  track: boolean;
  footprint: boolean;
  orbits: boolean;
  labels: boolean;
  ghosts: boolean;
  earthFixed: boolean;
  autoRotate: boolean;
  sightLines: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  clouds: true,
  atmosphere: true,
  borders: true,
  graticule: false,
  bloom: true,
  track: true,
  footprint: true,
  orbits: true,
  labels: true,
  ghosts: true,
  earthFixed: false,
  autoRotate: true,
  sightLines: true,
};

const SIGHT_LINE_LIMIT = 160;
const SKY_REFRESH_MS = 1000;
/** Beyond this range even large satellites are too faint to see unaided. */
export const NAKED_EYE_RANGE_KM = 2500;

// 'sky' fires when the observer's sky is recomputed (about once a second);
// when the sky filter is on, the filtered lists are refreshed with it.
type Evt = 'filters' | 'selection' | 'colors' | 'settings' | 'hover' | 'frame' | 'history' | 'sky' | 'observer' | 'reentry';

/** Sputnik 1 — the start of the space age and of the history timeline. */
export const SPACE_AGE_START = Date.UTC(1957, 9, 4);

/**
 * History mode: objects appear as their launch date passes. The catalogue
 * only holds objects still in orbit today, drawn on today's orbits.
 */
export interface HistoryState {
  cutoff: number; // ms; objects launched after this are hidden
  playing: boolean;
  speed: number; // ms of history per real ms
}

const ORBIT_SET_LIMIT = 400;

export class App {
  readonly clock = new SimClock();
  readonly stage: Stage;
  readonly earth: EarthLayers;
  readonly prop: Propagator;
  readonly sats: SatellitePoints;
  readonly selection: SelectionOverlay;
  readonly orbitSet: OrbitSet;
  readonly sky: ReturnType<typeof createSky>;

  filters: Filters = defaultFilters();
  colorMode: ColorMode = 'type';
  settings: Settings;
  selected: SatObject | null = null;
  hovered: SatObject | null = null;
  following = false;

  /** Indices passing the filters. */
  visible: Uint8Array;
  /** Objects in orbit now (indices < liveCount); re-entered objects follow once loaded. */
  readonly liveCount: number;
  private liveObjects: SatObject[];
  visibleList: SatObject[] = [];
  /** Visible objects ranked for the result list. */
  results: SatObject[] = [];
  colorsHex: string[] = [];
  queryTokens: string[] = [];
  colorsLin: Float32Array;

  private listeners = new Map<Evt, Set<() => void>>();
  private flight: { from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number } | null = null;
  private lastSatDir: THREE.Vector3 | null = null;
  private lastGmst = 0;
  private viewOffset = { x: 0, y: 0, tx: 0, ty: 0 };
  private free = { w: 1, h: 1 }; // fraction of the viewport not covered by panels
  private idleSince = performance.now();
  selState: ReturnType<SelectionOverlay['update']> = null;

  /** Launch time per object (ms, NaN when unknown). */
  launchMs: Float64Array;
  /** Re-entered objects, drawn by their own layer in history mode. */
  historyLayer: HistoryPoints | null = null;
  historyStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  historyInfo = { count: 0, approx: 0 };
  private historyVisDirty = true;
  history: HistoryState | null = null;
  /** Objects passing the filters that have launched by the history cutoff. */
  historyShown = 0;
  private lastFrame = performance.now();

  // ---------- re-entries ----------
  reentry: ReentryData | null = null;
  readonly reentryByNorad = new Map<number, ReentryPrediction>();

  // ---------- observer ----------
  observer: Observer | null = loadObserver();
  /** Per-object elevation / azimuth (deg) from the observer, refreshed ~1 Hz. */
  skyEl: Float32Array;
  skyAz: Float32Array;
  /** Per-object result of the sky filter. */
  skyOk: Uint8Array;
  sunEl = 0; // deg, at the observer
  skyTime = 0;
  /** Waiting for a click on the globe to set the observer. */
  pickingLocation = false;
  private lastSky = 0;
  private sightLines: THREE.LineSegments;

  constructor(readonly cat: Catalog, canvas: HTMLCanvasElement) {
    extendSearch(cat);
    this.settings = { ...DEFAULT_SETTINGS, ...loadSettings() };
    const n = cat.objects.length;
    this.visible = new Uint8Array(n).fill(1);
    this.colorsLin = new Float32Array(n * 3);
    this.launchMs = new Float64Array(n);
    for (const o of cat.objects) this.launchMs[o.idx] = o.launch ? Date.parse(o.launch + 'T00:00:00Z') : NaN;
    this.skyEl = new Float32Array(n).fill(-90);
    this.skyAz = new Float32Array(n);
    this.skyOk = new Uint8Array(n);

    this.stage = new Stage(canvas);
    const { scene } = this.stage;

    this.sky = createSky();
    scene.add(this.sky.sky, this.sky.sun);

    this.earth = createEarth(this.stage.renderer);
    scene.add(this.earth.group, this.earth.atmosphere);

    this.prop = new Propagator(cat.objects, this.clock);
    this.liveCount = this.prop.count;
    this.liveObjects = cat.objects.slice();
    this.sats = new SatellitePoints(this.prop);
    scene.add(this.sats.points);

    this.selection = new SelectionOverlay(scene, this.earth.group);
    this.orbitSet = new OrbitSet(scene);

    this.sightLines = new THREE.LineSegments(
      new THREE.BufferGeometry()
        .setAttribute('position', new THREE.BufferAttribute(new Float32Array(SIGHT_LINE_LIMIT * 6), 3).setUsage(THREE.DynamicDrawUsage))
        .setAttribute('color', new THREE.BufferAttribute(new Float32Array(SIGHT_LINE_LIMIT * 6), 3).setUsage(THREE.DynamicDrawUsage)),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.sightLines.frustumCulled = false;
    this.sightLines.renderOrder = 3;
    scene.add(this.sightLines);
    this.clock.onChange(() => (this.lastSky = 0));
    this.stage.onResize((w, h) => {
      this.selection.setResolution(w, h);
      this.updateViewOffset();
    });

    const c = this.stage.controls;
    c.addEventListener('start', () => {
      this.flight = null;
      this.idleSince = Infinity;
    });
    c.addEventListener('end', () => (this.idleSince = performance.now()));

    this.recolor();
    this.applyFilters();
    this.applySettings();
  }

  // ---------- events ----------
  on(e: Evt, fn: () => void) {
    if (!this.listeners.has(e)) this.listeners.set(e, new Set());
    this.listeners.get(e)!.add(fn);
    return () => this.listeners.get(e)!.delete(fn);
  }
  emit(e: Evt) {
    this.listeners.get(e)?.forEach((fn) => fn());
  }

  // ---------- filters & colour ----------
  setFilters(patch: Partial<Filters>) {
    Object.assign(this.filters, patch);
    // The sky mask depends on the mode and minimum elevation.
    if ('sky' in patch || 'minEl' in patch) this.refreshSky(true, true);
    this.applyFilters();
  }

  applyFilters(fromSky = false) {
    const f = this.filters;
    let tokens = tokenize(f.query);
    // A multi-word query that matches names as a phrase ("cosmos 24") is
    // treated as one token, so stray hits on IDs don't flood the results.
    if (tokens.length > 1) {
      const phrase = tokens.join(' ');
      if (this.universe.some((o) => o.search.includes(phrase))) tokens = [phrase];
    }
    this.queryTokens = tokens;
    const list: SatObject[] = [];
    const skyOn = f.sky !== 'off' && !!this.observer;
    // Re-entered objects only take part in history mode.
    this.visible.fill(0, this.liveCount);
    for (const o of this.universe) {
      const ok = passes(o, f, tokens, undefined, skyOn ? this.skyOk : null);
      this.visible[o.idx] = ok ? 1 : 0;
      if (ok) list.push(o);
    }
    this.visibleList = list;
    if (tokens.length) this.results = rankHits(list, tokens);
    // Looking at your sky: highest first.
    else if (skyOn) this.results = [...list].sort((a, b) => this.skyEl[b.idx] - this.skyEl[a.idx]);
    else this.results = list;
    this.historyVisDirty = true;
    this.pushVisibility();
    this.emit(fromSky ? 'sky' : 'filters');
  }

  /** Objects that filters apply to: in orbit now, plus re-entered ones in history mode. */
  get universe(): SatObject[] {
    return this.history && this.historyLayer ? this.cat.objects : this.liveObjects;
  }

  isLiveObject(o: SatObject) {
    return o.idx < this.liveCount;
  }

  setReentries(d: ReentryData | null) {
    this.reentry = d;
    this.reentryByNorad.clear();
    for (const u of d?.upcoming ?? []) this.reentryByNorad.set(u.norad, u);
    this.emit('reentry');
  }

  /** Is the sky filter in effect (needs an observer)? */
  get skyActive() {
    return this.filters.sky !== 'off' && !!this.observer;
  }

  // ---------- observer ----------
  /** `persist: false` for a location that arrives in a shared link. */
  setObserver(o: Observer | null, persist = true) {
    this.observer = o;
    if (persist) saveObserver(o);
    this.pickingLocation = false;
    if (!o && this.filters.sky !== 'off') this.filters.sky = 'off';
    this.refreshSky(true, true);
    this.applyFilters();
    this.emit('observer');
  }

  setPickingLocation(v: boolean) {
    this.pickingLocation = v;
    this.emit('observer');
  }

  /** Observer frame at a sim time (scene coordinates). */
  observerFrameAt(t: number): ObserverFrame | null {
    return this.observer ? observerFrame(this.observer, gmst(t)) : null;
  }

  /** Recompute every object's elevation/azimuth from the observer and the sky filter mask. */
  refreshSky(force = false, silent = false) {
    const now = performance.now();
    if (!force && now - this.lastSky < SKY_REFRESH_MS) return;
    this.lastSky = now;
    const t = this.clock.now();
    this.skyTime = t;
    const f = this.observerFrameAt(t);
    if (!f) {
      this.skyOk.fill(0);
      this.skyEl.fill(-90);
      if (force && !silent) this.emit('sky');
      return;
    }
    this.sunEl = sunElevation(f, t);
    const sun = sunScene(t);
    const dark = this.sunEl < -6;
    const minEl = this.filters.minEl;
    const naked = this.filters.sky === 'visible';
    const tmp = { x: 0, y: 0, z: 0 };
    const { valid } = this.prop;
    for (let i = 0; i < this.prop.count; i++) {
      if (!valid[i] || !this.launched(i)) {
        this.skyEl[i] = -90;
        this.skyOk[i] = 0;
        continue;
      }
      this.prop.position(i, t, tmp);
      const la = lookAngles(f, tmp.x, tmp.y, tmp.z);
      this.skyEl[i] = la.el;
      this.skyAz[i] = la.az;
      let ok = la.el >= minEl;
      // Naked-eye: dark sky, sunlit, near enough and big enough to be seen.
      if (ok && naked) {
        const rcs = this.cat.objects[i].rcs;
        ok = dark && la.range <= NAKED_EYE_RANGE_KM && (rcs === null || rcs >= 0.1) && sunlitScene(tmp.x, tmp.y, tmp.z, sun);
      }
      this.skyOk[i] = ok ? 1 : 0;
    }
    if (silent) return;
    if (this.filters.sky !== 'off') this.applyFilters(true);
    else this.emit('sky');
  }

  private updateSightLines(t: number) {
    const lines = this.sightLines;
    const f = this.settings.sightLines && this.skyActive ? this.observerFrameAt(t) : null;
    if (!f) {
      lines.visible = false;
      return;
    }
    const pos = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = lines.geometry.getAttribute('color') as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const C = col.array as Float32Array;
    const tmp = { x: 0, y: 0, z: 0 };
    let k = 0;
    // results are sorted highest-first, so the cap keeps the best-placed objects.
    for (const o of this.results) {
      if (k >= SIGHT_LINE_LIMIT) break;
      if (!this.prop.valid[o.idx]) continue;
      this.prop.position(o.idx, t, tmp);
      const j = k * 6;
      P[j] = f.p[0];
      P[j + 1] = f.p[1];
      P[j + 2] = f.p[2];
      P[j + 3] = tmp.x;
      P[j + 4] = tmp.y;
      P[j + 5] = tmp.z;
      const c = o.idx * 3;
      const sel = this.selected === o ? 1.6 : 1;
      // Dim at the observer, bright at the object.
      C[j] = this.colorsLin[c] * 0.08;
      C[j + 1] = this.colorsLin[c + 1] * 0.08;
      C[j + 2] = this.colorsLin[c + 2] * 0.08;
      C[j + 3] = this.colorsLin[c] * 0.55 * sel;
      C[j + 4] = this.colorsLin[c + 1] * 0.55 * sel;
      C[j + 5] = this.colorsLin[c + 2] * 0.55 * sel;
      k++;
    }
    lines.geometry.setDrawRange(0, k * 2);
    pos.needsUpdate = col.needsUpdate = true;
    lines.visible = k > 0;
  }

  private pushVisibility() {
    const n = this.liveCount;
    const vis = new Float32Array(n);
    const ghost = this.settings.ghosts ? 0.07 : 0;
    const all = this.visibleList.length === this.universe.length;
    const h = this.history;
    // Objects launched within this much history time flare briefly.
    const fresh = h && h.playing ? h.speed * 900 : 0;
    let shown = 0;
    for (let i = 0; i < n; i++) {
      let v = this.visible[i] ? 1 : all ? 1 : ghost;
      if (h) {
        const age = h.cutoff - this.launchMs[i];
        if (!(age >= 0)) v = 0;
        else if (v === 1) {
          shown++;
          if (age < fresh) v = 1 + 1.6 * (1 - age / fresh);
        }
      }
      vis[i] = v;
    }
    const sel = this.selected;
    if (sel && sel.idx < n) vis[sel.idx] = Math.max(1, vis[sel.idx]);
    this.sats.setVisibility(vis);
    this.sats.setEmphasis(this.visibleList.length);

    // Re-entered objects: filter visibility uploads only when it changes; the
    // date window (launch <= cutoff < re-entry) is applied on the GPU.
    const layer = this.historyLayer;
    if (layer) {
      const m = layer.objects.length;
      if (this.historyVisDirty) {
        const hv = new Float32Array(m);
        for (let j = 0; j < m; j++) hv[j] = this.visible[n + j];
        if (sel && sel.idx >= n) hv[sel.idx - n] = 1;
        layer.setVisibility(hv);
        this.historyVisDirty = false;
      }
      if (h) for (let j = 0; j < m; j++) if (this.visible[n + j] && layer.aliveAt(j, h.cutoff)) shown++;
    }
    this.historyShown = h ? shown : this.visibleList.length;
  }

  setColorMode(m: ColorMode) {
    this.colorMode = m;
    this.recolor();
  }

  recolor() {
    const cache = new Map<string, [number, number, number]>();
    for (const o of this.cat.objects) {
      const hex = colorFor(o, this.colorMode);
      this.colorsHex[o.idx] = hex;
      let rgb = cache.get(hex);
      if (!rgb) cache.set(hex, (rgb = hexToRgb(hex)));
      this.colorsLin.set(rgb, o.idx * 3);
    }
    this.sats.setColors(this.colorsLin.subarray(0, this.liveCount * 3));
    this.historyLayer?.setColors(this.colorsLin.subarray(this.liveCount * 3));
    if (this.selected) this.setSelectionOverlay(this.selected);
    this.emit('colors');
  }

  private selectionColor(o: SatObject) {
    // Brighten toward white so the highlighted orbit reads above the point cloud.
    return new THREE.Color(this.colorsHex[o.idx]).lerp(new THREE.Color(1, 1, 1), 0.35);
  }

  // ---------- settings ----------
  setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
    this.settings[k] = v;
    saveSettings(this.settings);
    this.applySettings();
    if (k === 'ghosts') this.pushVisibility();
  }

  applySettings() {
    const s = this.settings;
    this.earth.clouds.visible = s.clouds;
    this.earth.atmosphere.visible = s.atmosphere;
    this.earth.borders.visible = s.borders;
    this.earth.graticule.visible = s.graticule;
    this.stage.bloomEnabled = s.bloom;
    this.emit('settings');
  }

  // ---------- selection & camera ----------
  select(o: SatObject | null, opts: { fly?: boolean } = {}) {
    if (o === this.selected) {
      if (o && opts.fly) this.flyTo(o);
      return;
    }
    this.selected = o;
    const live = !!o && this.isLiveObject(o);
    this.sats.setSelected(live ? o!.idx : null);
    this.historyLayer?.setSelected(o && !live ? o.idx - this.liveCount : null);
    this.setSelectionOverlay(o);
    this.lastSatDir = null;
    if (!o) this.following = false;
    this.historyVisDirty = true;
    this.pushVisibility();
    document.body.classList.toggle('has-info', !!o);
    this.emit('selection');
    // Panels are laid out by now; frame the view around what's left free.
    this.updateViewOffset();
    if (o && opts.fly !== false) this.flyTo(o);
  }

  /** Live objects get SGP4 orbit + ground track; re-entered ones their final Keplerian orbit. */
  private setSelectionOverlay(o: SatObject | null) {
    if (o && !this.isLiveObject(o) && this.historyLayer) {
      this.selection.set(null);
      this.selection.setStatic(this.historyLayer.orbitPath(o.idx - this.liveCount), this.selectionColor(o));
    } else this.selection.set(o, o ? this.selectionColor(o) : undefined);
  }

  /** Shift the projection so Earth is centred in the area not covered by panels. */
  updateViewOffset() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    let left = 0;
    let right = W;
    let top = 0;
    let bottom = H;
    const ex = document.getElementById('explorer');
    const info = document.getElementById('info');
    const mobile = W <= 760;
    // offset* ignore the panels' entrance transforms.
    if (!mobile && ex && ex.offsetParent) left = ex.offsetLeft + ex.offsetWidth;
    if (info && !info.hidden) {
      if (mobile) bottom = info.offsetTop;
      else right = info.offsetLeft;
    }
    const timebar = document.getElementById('timebar');
    if (timebar && timebar.offsetParent) bottom = Math.min(bottom, timebar.offsetTop + 30);
    top = mobile ? 40 : 50;
    this.free = { w: Math.max(0.2, (right - left) / W), h: Math.max(0.2, (bottom - top) / H) };
    this.viewOffset.tx = (left + right) / 2 - W / 2;
    this.viewOffset.ty = (top + bottom) / 2 - H / 2;
  }

  setHover(o: SatObject | null) {
    if (o === this.hovered) return;
    this.hovered = o;
    const live = !!o && this.isLiveObject(o);
    this.sats.setHover(live ? o!.idx : null);
    this.historyLayer?.setHover(o && !live ? o.idx - this.liveCount : null);
    this.emit('hover');
  }

  scenePosition(o: SatObject, out = new THREE.Vector3(), t = this.clock.now()) {
    const p = { x: 0, y: 0, z: 0 };
    if (this.isLiveObject(o)) this.prop.position(o.idx, t, p);
    else this.historyLayer?.positionAt(o.idx - this.liveCount, t, p);
    return out.set(p.x, p.y, p.z);
  }

  /** Does o have a drawable position right now (valid SGP4, or alive in history mode)? */
  hasPosition(o: SatObject) {
    if (this.isLiveObject(o)) return !!this.prop.valid[o.idx] && this.launched(o.idx);
    return !!this.history && !!this.historyLayer && this.historyLayer.aliveAt(o.idx - this.liveCount, this.history.cutoff);
  }

  flyTo(o: SatObject) {
    const p = this.scenePosition(o);
    const r = p.length();
    if (!(r > 0.5)) return;
    const cam = this.stage.camera.position;
    let dist = r < 1.5 ? r + 2.3 : r * 1.7 + 1;
    // Pull back when the free viewport is narrow (portrait phones, open panels).
    const cam0 = this.stage.camera;
    const tv = Math.tan(THREE.MathUtils.degToRad(cam0.fov / 2));
    const effective = Math.min(tv * this.free.h, tv * cam0.aspect * this.free.w);
    dist *= THREE.MathUtils.clamp(tv / effective, 1, 3.2) ** 0.85;
    // Approach from above the object, tilted toward its orbit normal, so the
    // orbit ring is seen obliquely rather than edge-on.
    const ahead = this.scenePosition(o, new THREE.Vector3(), this.clock.now() + 20e3);
    const normal = p.clone().cross(ahead).normalize();
    const dir = p.clone().normalize();
    if (Number.isFinite(normal.x) && normal.lengthSq() > 0.5) {
      // Prefer the normal on the camera's current side to keep the flight short.
      if (normal.dot(cam) < 0) normal.negate();
      dir.addScaledVector(normal, 0.6);
    }
    dir.normalize();
    this.flight = { from: cam.clone(), to: dir.multiplyScalar(dist), t0: performance.now(), dur: 1600 };
    this.idleSince = Infinity;
  }

  flyHome() {
    const cam = this.stage.camera.position;
    const to = cam.clone().normalize().multiplyScalar(4.4);
    this.flight = { from: cam.clone(), to, t0: performance.now(), dur: 1400 };
  }

  zoomTo(dist: number) {
    const cam = this.stage.camera.position;
    this.flight = { from: cam.clone(), to: cam.clone().setLength(dist), t0: performance.now(), dur: 1400 };
  }

  /** Look down on the observer's location, tilted toward the equator. */
  flyToObserver() {
    const f = this.observerFrameAt(this.clock.now());
    if (!f || !this.observer) return;
    const dir = new THREE.Vector3(...f.up).addScaledVector(new THREE.Vector3(...f.north), this.observer.lat >= 0 ? -0.45 : 0.45).normalize();
    const cam = this.stage.camera.position;
    this.flight = { from: cam.clone(), to: dir.multiplyScalar(3.4), t0: performance.now(), dur: 1600 };
    this.idleSince = Infinity;
  }

  setFollowing(v: boolean) {
    this.following = v && !!this.selected;
    this.lastSatDir = null;
    if (this.following) this.idleSince = Infinity;
    this.emit('selection');
  }

  /** Objects for the faint multi-orbit layer (small filtered sets only). */
  orbitSetObjects() {
    const list = this.visibleList.length <= ORBIT_SET_LIMIT && this.visibleList.length < this.cat.objects.length ? this.visibleList : [];
    return list.filter((o) => this.isLiveObject(o) && this.launched(o.idx));
  }

  // ---------- history ----------
  /** Has object i launched by the history cutoff (always true outside history mode)? */
  launched(i: number) {
    return !this.history || this.launchMs[i] <= this.history.cutoff;
  }

  setHistory(patch: Partial<HistoryState>) {
    const wasActive = !!this.history;
    this.history = { cutoff: SPACE_AGE_START, playing: false, speed: 2 * 365.25 * 86400e3 / 1000, ...this.history, ...patch };
    // Orbits animate in real time while the calendar is scrubbed.
    if (!wasActive) this.clock.resetToNow();
    this.history.cutoff = Math.max(SPACE_AGE_START, this.history.cutoff);
    if (this.history.cutoff >= Date.now()) return this.exitHistory();
    if (!wasActive) {
      void this.ensureHistory();
      if (this.historyLayer) this.applyFilters();
    }
    this.pushVisibility();
    this.emit('history');
  }

  exitHistory() {
    if (!this.history) return;
    this.history = null;
    if (this.selected && !this.isLiveObject(this.selected)) this.select(null);
    if (this.historyLayer) this.applyFilters();
    else this.pushVisibility();
    this.emit('history');
  }

  /** Load re-entered objects (history.json) the first time history mode is used. */
  async ensureHistory() {
    if (this.historyStatus !== 'idle') return;
    this.historyStatus = 'loading';
    this.emit('history');
    try {
      const data = await loadHistory(`${import.meta.env.BASE_URL}data/history.json`, this.cat);
      extendSearchFor(data.objects);
      this.growArrays();
      this.historyLayer = new HistoryPoints(data.objects, Date.now());
      this.stage.scene.add(this.historyLayer.points);
      this.historyInfo = { count: data.objects.length, approx: data.approx };
      this.historyStatus = 'ready';
      this.historyVisDirty = true;
      this.recolor();
      this.applyFilters();
    } catch (err) {
      console.warn('History data unavailable:', err);
      this.historyStatus = 'error';
    }
    this.emit('history');
  }

  /** Resize per-object arrays after the catalogue grows. */
  private growArrays() {
    const n = this.cat.objects.length;
    const grow = <T extends Float32Array | Float64Array | Uint8Array>(a: T, size: number, fill: number): T => {
      const b = new (a.constructor as new (n: number) => T)(size);
      b.fill(fill);
      b.set(a);
      return b;
    };
    this.visible = grow(this.visible, n, 0);
    this.colorsLin = grow(this.colorsLin, n * 3, 0);
    this.skyEl = grow(this.skyEl, n, -90);
    this.skyAz = grow(this.skyAz, n, 0);
    this.skyOk = grow(this.skyOk, n, 0);
    this.launchMs = grow(this.launchMs, n, NaN);
    for (let i = this.liveCount; i < n; i++) {
      const o = this.cat.objects[i];
      this.launchMs[i] = o.launch ? Date.parse(o.launch + 'T00:00:00Z') : NaN;
    }
  }

  // ---------- frame ----------
  frame() {
    const t = this.clock.now();
    const { camera, controls } = this.stage;
    const now = performance.now();
    const realDt = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;

    // Advance history playback; reaching the present hands back to live time.
    const h = this.history;
    if (h?.playing) {
      h.cutoff += realDt * h.speed;
      if (h.cutoff >= Date.now()) {
        this.exitHistory();
        this.clock.resetToNow();
      } else {
        this.pushVisibility();
        this.emit('history');
      }
    }

    // Earth orientation & sun
    const g = gmst(t);
    this.earth.group.rotation.y = g;
    if (this.settings.earthFixed) {
      const dg = g - this.lastGmst;
      if (Math.abs(dg) < 1) camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), dg);
    }
    this.lastGmst = g;
    const s = sunDirectionEci(t);
    const sun = eciToScene(s[0], s[1], s[2]).normalize();
    this.earth.setSun(sun);
    this.sky.sun.position.copy(sun).multiplyScalar(800);
    this.earth.setCloudDrift(((t / 86400000) * 0.004) % 1);

    // Camera flight
    if (this.flight) {
      const f = this.flight;
      const k = Math.min(1, (now - f.t0) / f.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      const a = f.from.clone().normalize();
      const b = f.to.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(a, b);
      const qi = new THREE.Quaternion().slerp(q, e);
      const len = THREE.MathUtils.lerp(f.from.length(), f.to.length(), e);
      // Arc outward mid-flight for a cinematic pull-back.
      const arc = 1 + Math.sin(Math.PI * e) * Math.min(0.35, a.angleTo(b) * 0.25);
      camera.position.copy(a.applyQuaternion(qi).multiplyScalar(len * arc));
      if (k >= 1) {
        this.flight = null;
        this.lastSatDir = null;
      }
    }

    // Follow the selected object
    if (this.selected && this.following && !this.flight) {
      const dir = this.scenePosition(this.selected).normalize();
      if (this.lastSatDir && Number.isFinite(dir.x)) {
        const q = new THREE.Quaternion().setFromUnitVectors(this.lastSatDir, dir);
        camera.position.applyQuaternion(q);
      }
      this.lastSatDir = dir;
    }

    // Ease the off-centre projection.
    const vo = this.viewOffset;
    if (Math.abs(vo.tx - vo.x) > 0.3 || Math.abs(vo.ty - vo.y) > 0.3 || camera.view === null) {
      vo.x += (vo.tx - vo.x) * 0.08;
      vo.y += (vo.ty - vo.y) * 0.08;
      const W = window.innerWidth;
      const H = window.innerHeight;
      camera.setViewOffset(W, H, -vo.x, -vo.y, W, H);
    }

    // Gentle auto-rotate when idle with nothing selected.
    controls.autoRotate = this.settings.autoRotate && !this.selected && now - this.idleSince > 4000 && !this.flight;
    controls.autoRotateSpeed = 0.35;
    controls.update();

    const { renderer } = this.stage;
    this.sats.update(t, renderer.domElement.clientHeight, renderer.getPixelRatio());
    const layer = this.historyLayer;
    if (layer) {
      layer.points.visible = !!this.history;
      if (this.history) {
        const fresh = this.history.playing ? this.history.speed * 900 : 0;
        layer.update(t, this.history.cutoff, fresh, renderer.domElement.clientHeight, renderer.getPixelRatio(), this.sats.material.uniforms.uMinSize.value);
      }
    }

    this.selState = this.selection.update(t, this.settings.track, this.settings.footprint);
    if (this.observer) this.refreshSky();
    this.updateSightLines(t);
    this.orbitSet.update(this.orbitSetObjects(), this.colorsLin, t, this.settings.orbits);

    this.stage.render();
    this.emit('frame');
  }
}

function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem('oo.settings') || '{}');
  } catch {
    return {};
  }
}
function saveSettings(s: Settings) {
  try {
    localStorage.setItem('oo.settings', JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
