import * as THREE from 'three';
import { loadHistory, type Catalog, type SatObject } from './data/catalog';
import type { ReentryData, ReentryPrediction } from './data/reentry';
import type { ConjunctionData, LaunchData } from './data/watch';
import type { BreakupData, ManoeuvreData } from './data/changes';
import type { SpaceEvent } from './data/events';
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
import { eciToScene, gmst, moonPositionEci, sunDirectionEci } from './sim/astro';
import { SimClock } from './sim/clock';
import { loadObserver, lookAngles, observerFrame, saveObserver, sunElevation, sunlitScene, sunScene, type Observer, type ObserverFrame } from './sim/observer';
import { Propagator, type TimeSource } from './sim/propagator';
import { createEarth, type EarthLayers } from './render/earth';
import { createCelestial, type Celestial } from './render/celestial';
import { OrbitSet, SelectionOverlay } from './render/orbits';
import { SatellitePoints } from './render/satellites';
import { HistoryPoints } from './render/historyPoints';
import { loadSnapshot, parseManifest, pickEventSnapshot, pickSnapshot, type Snapshot, type SnapshotInfo } from './data/snapshots';
import { Stage } from './render/scene';
import type { PassAlerts } from './ui/alerts';
import { lightMode } from './ui/platform';
import { CloseUp, type ObjectState } from './render/closeup';
import { SkyViewLayer } from './render/skyview';
import { hasModel } from './render/models';
import { satrecFor, stateAt } from './render/orbits';
import { apparentMagnitude, NAKED_EYE_MAG, phaseAngle, setSkyQuality, standardMagnitude, type MagnitudeData, type SkyQuality } from './sim/brightness';
import { fetchClouds, setWeatherEnabled, weatherEnabled, type CloudForecast } from './data/weather';

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
  launchSites: boolean;
  sun: boolean;
  moon: boolean;
  stars: boolean;
  constellations: boolean;
  planets: boolean;
  /** Red night-vision mode: keeps your eyes dark-adapted. */
  nightRed: boolean;
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
  launchSites: true,
  sun: true,
  moon: true,
  stars: true,
  constellations: false,
  planets: true,
  nightRed: false,
};

const SIGHT_LINE_LIMIT = 160;
const SKY_REFRESH_MS = 1000;

// 'sky' fires when the observer's sky is recomputed (about once a second);
// when the sky filter is on, the filtered lists are refreshed with it.
type Evt = 'filters' | 'selection' | 'colors' | 'settings' | 'hover' | 'frame' | 'history' | 'sky' | 'observer' | 'reentry' | 'pair' | 'watch' | 'compare' | 'profile' | 'closeup' | 'skyview' | 'watchlist' | 'weather';

/** First-person view of the sky from the observer's location. */
export type WatchTab = 'reentry' | 'conjunctions' | 'launches' | 'manoeuvres' | 'breakups';

const WATCHLIST_KEY = 'oo:watchlist';
function loadWatchlist() {
  try {
    const v = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
    return new Set<number>(Array.isArray(v) ? v.filter((n) => typeof n === 'number') : []);
  } catch {
    return new Set<number>();
  }
}

export interface SkyViewState {
  active: boolean;
  /** Looking direction: azimuth (deg from north, clockwise) and elevation (deg). */
  az: number;
  el: number;
  fov: number;
  /** Device orientation drives the view (phones and tablets). */
  ar: boolean;
  /** Also show objects too faint to see or in Earth's shadow. */
  showAll: boolean;
  grid: boolean;
}

/** Two objects shown as an encounter: a close approach or a collision. */
export interface Encounter {
  a: SatObject;
  b: SatObject;
  label: string;
  /** Time of closest approach (ms), when known. */
  tca?: number;
  /** Predicted miss distance (km), when known. */
  missKm?: number;
}

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
  readonly celestial: Celestial;
  /** True-scale 3D model view of the selected object (ISS, Hubble, Tiangong). */
  readonly closeup: CloseUp;
  readonly skyLayer: SkyViewLayer;
  skyView: SkyViewState = { active: false, az: 180, el: 30, fov: 70, ar: false, showAll: true, grid: false };
  /**
   * Device orientation from the motion sensors while AR is on, in a local
   * frame with +Y up, −Z north and +X east (the device looking out of its back).
   */
  arDevice: THREE.Quaternion | null = null;
  private arSmoothed: THREE.Quaternion | null = null;
  private arLast = 0;
  private skyTrailAt = 0;

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
  /** Orbital snapshots available (history/<key>.bin). */
  snapshots: SnapshotInfo[] = [];
  private snapWanted: string | null | undefined = undefined;
  /** Snapshot currently applied to the orbit layer. */
  activeSnapshot: Snapshot | null = null;
  /**
   * Debris inherits its parent's launch date, so a fragment would otherwise
   * appear years before the break-up that made it. When a snapshot is
   * applied, debris it has no element set for (not yet tracked) is hidden.
   */
  private debrisGate: Uint8Array | null = null;
  /** SGP4 propagation of the active snapshot, for true positions. */
  private trueProp: { key: string; prop: Propagator; indices: Int32Array; ready: boolean } | null = null;
  /** History mode is drawing true (SGP4) positions rather than illustrative ones. */
  trueMode = false;
  private lastHistoryCount = 0;
  private historyClockListeners = new Set<() => void>();
  /** History mode's clock: the history date, running at real time unless playing. */
  readonly historyClock: TimeSource = {
    now: () => this.history?.cutoff ?? Date.now(),
    get paused() {
      return false;
    },
    rate: 1,
    onChange: (fn: () => void) => this.historyClockListeners.add(fn),
  };
  private indexOf = (norad: number) => this.cat.byNorad.get(norad)?.idx;
  history: HistoryState | null = null;
  /** Objects passing the filters that have launched by the history cutoff. */
  historyShown = 0;
  private lastFrame = performance.now();
  private lastFrameRaw = performance.now();

  // ---------- encounters & comparison ----------
  pair: Encounter | null = null;
  /** Owner code whose profile is open (shown in place of the info panel). */
  profile: string | null = null;
  /** Object compared with the selected one. */
  compare: SatObject | null = null;
  /** The next selection becomes the comparison target. */
  comparePicking = false;
  private pairLine: THREE.Line;

  // ---------- watch: close approaches & launches ----------
  conjunctions: ConjunctionData | null = null;
  launches: LaunchData | null = null;
  /** Opens the Insights drawer, optionally on a tab (set by the drawer when mounted). */
  openInsights: (tab?: 'overview' | 'debris', open?: boolean) => void = () => {};
  /** Opens "What did I see?" (set by that panel when mounted). */
  openIdentify: () => void = () => {};
  /** Follows a launch in launch day mode (set by that panel when mounted). */
  followLaunch: (id: string) => void = () => {};
  /** Jumps to a timeline event in history mode (set by the timeline when mounted). */
  openEvent: (e: SpaceEvent) => void = () => {};
  /** Starts a guided tour (set by the tour player when mounted). */
  startTour: (id: string) => void = () => {};
  /** Opens the Watch panel on a tab (set by the panel when mounted). */
  openWatch: (tab: WatchTab, id?: string) => void = () => {};
  /** Manoeuvres and breakups detected between builds. */
  manoeuvres: ManoeuvreData | null = null;
  breakups: BreakupData | null = null;

  // ---------- watchlist ("My satellites") ----------
  readonly watchlist: Set<number> = loadWatchlist();

  // ---------- re-entries ----------
  reentry: ReentryData | null = null;
  readonly reentryByNorad = new Map<number, ReentryPrediction>();

  // ---------- observer ----------
  observer: Observer | null = loadObserver();
  /** Pass notifications (set up by the UI). */
  alerts: PassAlerts | null = null;
  /** Per-object elevation / azimuth (deg) from the observer, refreshed ~1 Hz. */
  skyEl: Float32Array;
  skyAz: Float32Array;
  /** Per-object result of the sky filter. */
  skyOk: Uint8Array;
  /** Per-object predicted visual magnitude from the observer (99 when unlit or below the horizon). */
  skyMag: Float32Array;
  /** Published standard magnitudes (magnitudes.json), when loaded. */
  magnitudes: MagnitudeData | null = null;
  private stdMags: Float32Array | null = null;
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
    this.skyMag = new Float32Array(n).fill(99);

    this.stage = new Stage(canvas);
    const { scene } = this.stage;

    this.celestial = createCelestial(this.stage.renderer);
    const c0 = this.celestial;
    scene.add(c0.milkyWay, c0.stars, c0.planets, c0.figureLines, c0.sun, c0.moon);

    this.closeup = new CloseUp(this.stage.renderer);
    this.stage.setOverlay(this.closeup.scene, this.closeup.camera);

    this.earth = createEarth(this.stage.renderer, !lightMode());
    scene.add(this.earth.group, this.earth.atmosphere);

    this.prop = new Propagator(cat.objects, this.clock);
    this.liveCount = this.prop.count;
    this.liveObjects = cat.objects.slice();
    this.sats = new SatellitePoints(this.prop);
    scene.add(this.sats.points);
    this.skyLayer = new SkyViewLayer(this.prop, this.sats.points.geometry);
    scene.add(this.skyLayer.group);

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

    this.pairLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage)),
      new THREE.LineBasicMaterial({ color: 0xff8a7a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.pairLine.frustumCulled = false;
    this.pairLine.renderOrder = 5;
    this.pairLine.visible = false;
    scene.add(this.pairLine);
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
    void this.refreshWeather();
    setInterval(() => void this.refreshWeather(), 30 * 60e3);
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
    if (!fromSky) this.pushSkyLayer();
    this.emit(fromSky ? 'sky' : 'filters');
  }

  /** Objects that filters apply to: in orbit now, plus re-entered ones in history mode. */
  get universe(): SatObject[] {
    return this.history && this.historyLayer ? this.cat.objects : this.liveObjects;
  }

  isLiveObject(o: SatObject) {
    return o.idx < this.liveCount;
  }

  /** Open (or close) an owner's profile; it replaces the info panel. */
  setProfile(code: string | null) {
    if (code && this.selected) this.select(null);
    this.profile = code;
    document.body.classList.toggle('has-info', !!code || !!this.selected);
    this.emit('profile');
    this.updateViewOffset();
    if (code) void this.ensureHistory(); // fleet-over-time needs re-entered objects
  }

  /** Begin (or cancel) choosing an object to compare with the selected one. */
  setComparePicking(v: boolean) {
    this.comparePicking = v && !!this.selected;
    this.emit('compare');
  }

  setCompare(b: SatObject) {
    const a = this.selected;
    if (!a || a === b) return;
    this.compare = b;
    this.comparePicking = false;
    this.setPair({ a, b, label: 'Compare' });
    this.emit('compare');
  }

  clearCompare(emit = true) {
    this.compare = null;
    this.comparePicking = false;
    if (this.pair?.label === 'Compare') this.setPair(null);
    if (emit) this.emit('compare');
  }

  setPair(p: Encounter | null) {
    this.pair = p;
    this.emit('pair');
  }

  /** Current distance (km) between the encounter's two objects, or null. */
  pairDistanceKm(t = this.clock.now()) {
    const p = this.pair;
    if (!p || !this.hasPosition(p.a) || !this.hasPosition(p.b)) return null;
    const a = this.scenePosition(p.a, new THREE.Vector3(), t);
    const b = this.scenePosition(p.b, new THREE.Vector3(), t);
    return a.distanceTo(b) * 6371;
  }

  setWatchData(c: ConjunctionData | null, l: LaunchData | null) {
    this.conjunctions = c;
    this.launches = l;
    this.emit('watch');
  }

  setChanges(m: ManoeuvreData | null, b: BreakupData | null) {
    this.manoeuvres = m;
    this.breakups = b;
    this.emit('watch');
  }

  isWatched(o: SatObject | null | undefined) {
    return !!o && this.watchlist.has(o.norad);
  }
  /** Star or unstar an object; returns whether it is now watched. */
  toggleWatchlist(o: SatObject, on = !this.watchlist.has(o.norad)) {
    if (on) this.watchlist.add(o.norad);
    else this.watchlist.delete(o.norad);
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...this.watchlist]));
    } catch {
      /* private mode */
    }
    this.emit('watchlist');
    return on;
  }
  watchlistObjects() {
    return [...this.watchlist].map((n) => this.cat.byNorad.get(n)).filter((o): o is SatObject => !!o);
  }

  /** Show a close approach: live time just before TCA, both objects linked. */
  showEncounter(aNorad: number, bNorad: number, tca: number, missKm?: number) {
    const a = this.cat.byNorad.get(aNorad);
    const b = this.cat.byNorad.get(bNorad);
    if (!a || !b) return false;
    this.exitHistory();
    this.clock.setRate(1);
    this.clock.setPaused(false);
    this.clock.set(tca - 120e3);
    this.setPair({ a, b, label: 'Close approach', tca, missKm });
    this.select(a, { fly: true });
    return true;
  }

  /** Look down on a point on Earth (e.g. a launch pad). */
  flyToLatLon(lat: number, lon: number, dist = 3.2) {
    if (this.skyView.active) this.exitSkyView();
    const d = (Math.PI / 180) * lat;
    const g = this.earth.group.rotation.y + (Math.PI / 180) * lon;
    const dir = new THREE.Vector3(Math.cos(d) * Math.cos(g), Math.sin(d), -Math.cos(d) * Math.sin(g));
    const cam = this.stage.camera.position;
    this.flight = { from: cam.clone(), to: dir.multiplyScalar(dist), t0: performance.now(), dur: 1600 };
    this.idleSince = Infinity;
  }

  setReentries(d: ReentryData | null) {
    this.reentry = d;
    this.reentryByNorad.clear();
    for (const u of d?.upcoming ?? []) this.reentryByNorad.set(u.norad, u);
    this.emit('reentry');
  }

  setMagnitudes(d: MagnitudeData | null) {
    this.magnitudes = d;
    this.stdMags = null;
    this.refreshSky(true);
    this.emit('observer');
  }

  /** Standard magnitude of an object (published, or estimated from its size). */
  stdMag(o: SatObject) {
    return standardMagnitude(o, this.magnitudes);
  }

  private stdMagArray() {
    if (!this.stdMags) {
      const a = new Float32Array(this.cat.objects.length);
      for (const o of this.cat.objects) a[o.idx] = this.stdMag(o).mag;
      this.stdMags = a;
    }
    return this.stdMags;
  }

  /** Is the sky filter in effect (needs an observer)? */
  get skyActive() {
    return this.filters.sky !== 'off' && !!this.observer;
  }

  // ---------- observer ----------
  /** `persist: false` for a location that arrives in a shared link. */
  setObserver(o: Observer | null, persist = true) {
    this.observer = o;
    if (!o && this.skyView.active) this.exitSkyView();
    if (persist) saveObserver(o);
    this.pickingLocation = false;
    if (!o && this.filters.sky !== 'off') this.filters.sky = 'off';
    this.refreshSky(true, true);
    this.applyFilters();
    this.emit('observer');
    void this.refreshWeather();
  }

  // ---------- observing conditions ----------
  /** Cloud forecast for the observer (only when the user has turned it on). */
  weather: CloudForecast | null = null;
  weatherOn = weatherEnabled();
  setWeatherOn(on: boolean) {
    this.weatherOn = on;
    setWeatherEnabled(on);
    if (!on) this.weather = null;
    this.emit('weather');
    void this.refreshWeather();
  }
  async refreshWeather() {
    const o = this.observer;
    if (!this.weatherOn || !o) {
      if (this.weather) {
        this.weather = null;
        this.emit('weather');
      }
      return;
    }
    const f = await fetchClouds(o);
    if (o !== this.observer || !this.weatherOn) return;
    this.weather = f;
    this.emit('weather');
  }
  setSkyQuality(q: SkyQuality) {
    setSkyQuality(q);
    this.refreshSky(true);
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
    const std = this.stdMagArray();
    for (let i = 0; i < this.prop.count; i++) {
      if (!valid[i] || !this.launched(i)) {
        this.skyEl[i] = -90;
        this.skyOk[i] = 0;
        this.skyMag[i] = 99;
        continue;
      }
      this.prop.position(i, t, tmp);
      const la = lookAngles(f, tmp.x, tmp.y, tmp.z);
      this.skyEl[i] = la.el;
      this.skyAz[i] = la.az;
      const lit = la.el > 0 && sunlitScene(tmp.x, tmp.y, tmp.z, sun);
      const mag = lit ? apparentMagnitude(std[i], la.range, phaseAngle([tmp.x, tmp.y, tmp.z], f.p, sun), la.el) : 99;
      this.skyMag[i] = mag;
      let ok = la.el >= minEl;
      // Naked-eye: dark sky, sunlit and predicted bright enough.
      if (ok && naked) ok = dark && mag <= NAKED_EYE_MAG;
      this.skyOk[i] = ok ? 1 : 0;
    }
    this.pushSkyLayer();
    if (silent) return;
    if (this.filters.sky !== 'off') this.applyFilters(true);
    else this.emit('sky');
  }

  private updatePairLine(t: number) {
    const p = this.pair;
    const line = this.pairLine;
    if (!p || !this.hasPosition(p.a) || !this.hasPosition(p.b)) {
      line.visible = false;
      return;
    }
    const a = this.scenePosition(p.a, new THREE.Vector3(), t);
    const b = this.scenePosition(p.b, new THREE.Vector3(), t);
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, a.x, a.y, a.z);
    attr.setXYZ(1, b.x, b.y, b.z);
    attr.needsUpdate = true;
    line.visible = true;
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

  /** History mode with the orbit layer loaded: everything is drawn by that layer. */
  get keplerMode() {
    return !!this.history && !!this.historyLayer;
  }

  private pushVisibility() {
    const ghost = this.settings.ghosts ? 0.07 : 0;
    const all = this.visibleList.length === this.universe.length;
    const h = this.history;
    const sel = this.selected;
    const layer = this.historyLayer;

    if (this.keplerMode && layer) {
      // Date window and launch/re-entry flares are evaluated on the GPU, so
      // visibility only uploads when filters or the selection change.
      if (this.historyVisDirty) {
        const N = this.cat.objects.length;
        const hv = new Float32Array(N);
        for (let i = 0; i < N; i++) hv[i] = this.gated(i) ? 0 : this.visible[i] ? 1 : all ? 1 : ghost;
        if (sel) hv[sel.idx] = 1;
        layer.setVisibility(hv);
        layer.setSelected(sel ? sel.idx : null);
        this.historyVisDirty = false;
      }
      this.sats.setEmphasis(this.visibleList.length);
      this.countHistory();
      return;
    }

    // In orbit now, drawn with SGP4 (outside history mode, or while history data loads).
    const n = this.liveCount;
    const vis = new Float32Array(n);
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
    if (sel && sel.idx < n) vis[sel.idx] = Math.max(1, vis[sel.idx]);
    this.sats.setVisibility(vis);
    this.sats.setEmphasis(this.visibleList.length);
    this.historyShown = h ? shown : this.visibleList.length;
  }

  /** Objects passing the filters that are in orbit at the history date. */
  private countHistory() {
    const layer = this.historyLayer;
    const h = this.history;
    if (!layer || !h) return;
    let shown = 0;
    for (let i = 0; i < this.cat.objects.length; i++) if (this.visible[i] && !this.gated(i) && layer.aliveAt(i, h.cutoff)) shown++;
    this.historyShown = shown;
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
    this.historyLayer?.setColors(this.colorsLin);
    if (this.selected) this.setSelectionOverlay(this.selected);
    this.emit('colors');
  }

  private selectionColor(o: SatObject) {
    // Brighten toward white so the highlighted orbit reads above the point cloud.
    return new THREE.Color(this.colorsHex[o.idx]).lerp(new THREE.Color(1, 1, 1), 0.35);
  }

  // ---------- settings ----------
  /** False in the embed widget, so it never changes the full site's saved settings. */
  persistSettings = true;

  setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
    this.settings[k] = v;
    if (this.persistSettings) saveSettings(this.settings);
    this.applySettings();
    if (k === 'ghosts') this.pushVisibility();
  }

  applySettings() {
    const s = this.settings;
    this.earth.clouds.visible = s.clouds;
    this.earth.atmosphere.visible = s.atmosphere && !this.skyView?.active;
    this.earth.borders.visible = s.borders;
    this.earth.graticule.visible = s.graticule;
    this.stage.bloomEnabled = s.bloom;
    const c = this.celestial;
    c.sun.visible = s.sun;
    c.moon.visible = s.moon;
    c.stars.visible = c.milkyWay.visible = s.stars;
    c.figureLines.visible = s.constellations;
    c.planets.visible = s.planets;
    document.body.classList.toggle('night-red', s.nightRed);
    this.emit('settings');
  }

  // ---------- selection & camera ----------
  select(o: SatObject | null, opts: { fly?: boolean } = {}) {
    // While picking a comparison target, a selection becomes that target.
    if (this.comparePicking && o && this.selected && o !== this.selected) {
      this.setCompare(o);
      return;
    }
    if (o === this.selected) {
      if (o && opts.fly) this.flyTo(o);
      return;
    }
    if (this.compare || this.comparePicking) this.clearCompare(false);
    if (o && this.profile) this.setProfile(null);
    if (this.closeup.active) this.leaveCloseupNow();
    this.selected = o;
    this.skyTrailAt = -Infinity;
    const live = !!o && this.isLiveObject(o);
    this.sats.setSelected(live ? o!.idx : null);
    this.historyLayer?.setSelected(o ? o.idx : null);
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
    if (o && this.historyLayer && (this.keplerMode || !this.isLiveObject(o))) {
      this.selection.set(null);
      this.selection.setStatic(this.historyLayer.orbitPath(o.idx), this.selectionColor(o));
    } else this.selection.set(o, o ? this.selectionColor(o) : undefined);
  }

  /** Shift the projection so Earth is centred in the area not covered by panels. */
  updateViewOffset() {
    if (this.skyView.active) {
      // The sky view fills the screen; panels float over it.
      this.viewOffset.tx = this.viewOffset.ty = 0;
      this.free = { w: 1, h: 1 };
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    let left = 0;
    let right = W;
    let top = 0;
    let bottom = H;
    const ex = document.getElementById('explorer');
    // offsetParent is null for panels hidden by CSS as well as by [hidden].
    const info = [document.getElementById('info'), document.getElementById('profile')].find((el) => el && !el.hidden && el.offsetParent) ?? null;
    const mobile = W <= 760;
    // offset* ignore the panels' entrance transforms.
    const tourCard = document.querySelector<HTMLElement>('.tour-card:not([hidden])');
    const leftPanel = ex && ex.offsetParent ? ex : tourCard;
    if (!mobile && leftPanel) left = leftPanel.offsetLeft + leftPanel.offsetWidth;
    if (info && !info.hidden) {
      if (mobile) bottom = info.offsetTop;
      else right = info.offsetLeft;
    }
    const timebar = document.getElementById('timebar');
    if (timebar && timebar.offsetParent) bottom = Math.min(bottom, timebar.offsetTop + 30);
    top = document.body.classList.contains('embed') ? 0 : mobile ? 40 : 50;
    // On phones the close-up card sits over the top of the view.
    const cuHud = document.querySelector<HTMLElement>('.closeup-hud:not([hidden])');
    if (mobile && cuHud) top = Math.max(top, cuHud.offsetTop + cuHud.offsetHeight);
    this.free = { w: Math.max(0.2, (right - left) / W), h: Math.max(0.2, (bottom - top) / H) };
    this.viewOffset.tx = (left + right) / 2 - W / 2;
    this.viewOffset.ty = (top + bottom) / 2 - H / 2;
  }

  setHover(o: SatObject | null) {
    if (o === this.hovered) return;
    this.hovered = o;
    const live = !!o && this.isLiveObject(o);
    this.sats.setHover(live ? o!.idx : null);
    this.historyLayer?.setHover(o ? o.idx : null);
    this.emit('hover');
  }

  scenePosition(o: SatObject, out = new THREE.Vector3(), t = this.clock.now()) {
    const p = { x: 0, y: 0, z: 0 };
    if (this.historyLayer && (this.keplerMode || !this.isLiveObject(o))) this.historyLayer.positionAt(o.idx, t, p);
    else this.prop.position(o.idx, t, p);
    return out.set(p.x, p.y, p.z);
  }

  /** Does o have a drawable position right now (valid SGP4, or alive in history mode)? */
  hasPosition(o: SatObject) {
    if (this.keplerMode) return !this.gated(o.idx) && this.historyLayer!.aliveAt(o.idx, this.history!.cutoff);
    return this.isLiveObject(o) && !!this.prop.valid[o.idx] && this.launched(o.idx);
  }

  flyTo(o: SatObject) {
    if (this.closeup.active || this.skyView.active) return;
    const to = this.viewPositionFor(o);
    if (!to) return;
    this.flight = { from: this.stage.camera.position.clone(), to, t0: performance.now(), dur: 1600 };
    this.idleSince = Infinity;
  }

  /** A camera position that frames o and its orbit from the globe view. */
  viewPositionFor(o: SatObject) {
    const p = this.scenePosition(o);
    const r = p.length();
    if (!(r > 0.5)) return null;
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
    return dir.multiplyScalar(dist);
  }

  // ---------- sky view ----------
  /** Look at the sky from the observer's location, optionally toward a direction. */
  enterSkyView(look?: { az: number; el: number }) {
    if (!this.observer) return false;
    if (this.closeup.active) this.leaveCloseupNow();
    this.exitHistory();
    this.flight = null;
    this.following = false;
    const sv = this.skyView;
    if (look) {
      sv.az = look.az;
      sv.el = Math.max(5, Math.min(85, look.el));
    } else if (!sv.active) {
      // Face the selected object if it's up, else away from the Sun.
      const o = this.selected;
      if (o && this.skyEl[o.idx] > 0) {
        sv.az = this.skyAz[o.idx];
        sv.el = Math.max(10, this.skyEl[o.idx]);
      } else {
        const f = this.observerFrameAt(this.clock.now())!;
        const s = sunScene(this.clock.now());
        const e = s[0] * f.east[0] + s[1] * f.east[1] + s[2] * f.east[2];
        const nn = s[0] * f.north[0] + s[1] * f.north[1] + s[2] * f.north[2];
        sv.az = ((Math.atan2(e, nn) * 180) / Math.PI + 180 + 360) % 360;
        sv.el = 35;
      }
    }
    if (sv.active) {
      this.emit('skyview');
      return true;
    }
    sv.active = true;
    this.stage.controls.enabled = false;
    this.earth.group.visible = false;
    this.earth.atmosphere.visible = false;
    this.skyLayer.group.visible = true;
    this.celestial.starUniforms.uSize.value = 1.5;
    document.body.classList.add('skyview');
    this.refreshSky(true, true);
    this.pushSkyLayer();
    this.updateViewOffset();
    this.emit('skyview');
    return true;
  }

  exitSkyView() {
    const sv = this.skyView;
    if (!sv.active) return;
    sv.active = false;
    sv.ar = false;
    this.arDevice = this.arSmoothed = null;
    const { camera, controls } = this.stage;
    this.skyLayer.group.visible = false;
    this.earth.group.visible = true;
    this.applySettings();
    const cu = this.celestial;
    cu.starUniforms.uSize.value = 1;
    cu.starUniforms.uGain.value = 0.85;
    cu.starUniforms.uLimit.value = 7.5;
    cu.milkyUniforms.uGain.value = 0.022;
    camera.fov = 42;
    camera.updateProjectionMatrix();
    camera.up.set(0, 1, 0);
    // Back above the observer, looking down at Earth.
    const f = this.observerFrameAt(this.clock.now());
    camera.position.copy(f ? new THREE.Vector3(...f.up).multiplyScalar(3.4) : camera.position.clone().setLength(4.4));
    controls.target.set(0, 0, 0);
    controls.enabled = true;
    controls.update();
    document.body.classList.remove('skyview');
    this.updateViewOffset();
    this.emit('skyview');
  }

  /** Brightness and filter visibility for the sky view's point layer. */
  private pushSkyLayer() {
    if (!this.skyView.active) return;
    const n = this.liveCount;
    const vis = new Float32Array(n);
    const all = this.visibleList.length === this.universe.length;
    for (let i = 0; i < n; i++) vis[i] = (all || this.visible[i]) && this.skyEl[i] > -1 ? 1 : 0;
    if (this.selected && this.selected.idx < n) vis[this.selected.idx] = 1;
    this.skyLayer.setMagnitudes(this.skyMag, vis);
  }

  /** Faintest magnitude visible to the eye given the Sun's elevation. */
  skyLimit(sunEl = this.sunEl) {
    return THREE.MathUtils.lerp(NAKED_EYE_MAG + 1, -2, THREE.MathUtils.smoothstep(sunEl, -15, 2));
  }

  private frameSkyView(t: number, sun: THREE.Vector3) {
    const f = this.observerFrameAt(t);
    if (!f) {
      this.exitSkyView();
      return;
    }
    const { camera } = this.stage;
    const sv = this.skyView;
    const up = new THREE.Vector3(...f.up);
    const east = new THREE.Vector3(...f.east);
    const north = new THREE.Vector3(...f.north);
    // A couple of metres above the ground.
    camera.position.set(...f.p).addScaledVector(up, 2e-3 / 6371);
    if (sv.ar && this.arDevice) {
      const local = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().negate()));
      const target = local.multiply(this.arDevice);
      // Sensors are noisy: ease toward the reading (time-based, so slow frames don't lag).
      const now = performance.now();
      const k = 1 - Math.exp(-(now - this.arLast) / 70);
      this.arLast = now;
      this.arSmoothed = this.arSmoothed ? this.arSmoothed.slerp(target, Math.min(1, k)) : target;
      camera.quaternion.copy(this.arSmoothed);
      // Keep az/el in step, so turning AR off continues from here.
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      sv.az = ((THREE.MathUtils.radToDeg(Math.atan2(fwd.dot(east), fwd.dot(north))) % 360) + 360) % 360;
      sv.el = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(fwd.dot(up), -1, 1)));
    } else {
      const a = THREE.MathUtils.degToRad(sv.az);
      const e = THREE.MathUtils.degToRad(sv.el);
      const dir = east.clone().multiplyScalar(Math.cos(e) * Math.sin(a)).addScaledVector(north, Math.cos(e) * Math.cos(a)).addScaledVector(up, Math.sin(e));
      camera.up.copy(up);
      camera.lookAt(camera.position.clone().add(dir));
    }
    if (Math.abs(camera.fov - sv.fov) > 0.01) {
      camera.fov = sv.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    const sunEl = (Math.asin(THREE.MathUtils.clamp(sun.dot(up), -1, 1)) * 180) / Math.PI;
    const limit = this.skyLimit(sunEl);
    // Stars fade into the twilight; the Milky Way needs a properly dark sky.
    const cu = this.celestial;
    // A brighter (light-polluted) sky hides the fainter stars.
    cu.starUniforms.uLimit.value = THREE.MathUtils.lerp(Math.min(7.5, NAKED_EYE_MAG + 2), -1.5, THREE.MathUtils.smoothstep(sunEl, -18, -2));
    cu.starUniforms.uGain.value = 1.6 * (1.0 - 0.9 * THREE.MathUtils.smoothstep(sunEl, -8, 2));
    // The Milky Way needs a rural or darker sky.
    cu.milkyUniforms.uGain.value = 0.035 * (1 - THREE.MathUtils.smoothstep(sunEl, -18, -11)) * THREE.MathUtils.smoothstep(NAKED_EYE_MAG, 4.0, 5.5);
    this.skyLayer.update({
      t,
      frame: f,
      camera,
      sun,
      sunEl,
      pixelRatio: this.stage.renderer.getPixelRatio(),
      limit,
      showAll: sv.showAll,
      grid: sv.grid,
    });
    this.skyLayer.setHighlight(this.hovered?.idx ?? null, this.selected?.idx ?? null);
    // The selected object's path across the sky, ±10 minutes.
    const sel = this.selected;
    if (sel && this.isLiveObject(sel)) {
      if (Math.abs(t - this.skyTrailAt) > 5000) {
        this.skyTrailAt = t;
        const rec = satrecFor(sel);
        const pts: number[] = [];
        if (rec)
          for (let i = -40; i <= 40; i++) {
            const st = stateAt(rec, t + i * 15e3);
            if (st) pts.push(st.position.x / 6371, st.position.z / 6371, -st.position.y / 6371);
          }
        this.skyLayer.setTrail(pts);
      }
    } else this.skyLayer.setTrail(null);
  }

  // ---------- close-up models ----------
  canCloseup(o: SatObject | null = this.selected) {
    return !!o && hasModel(o.norad) && this.hasPosition(o);
  }

  /** Fly in to the selected object's 3D model. */
  enterCloseup(o: SatObject | null = this.selected) {
    if (!o || !this.canCloseup(o) || this.closeup.active) return;
    if (this.selected !== o) this.select(o, { fly: false });
    const t = this.clock.now();
    const s = sunDirectionEci(t);
    this.flight = null;
    this.following = false;
    if (!this.closeup.enter(o, this.objectState(o, t), eciToScene(s[0], s[1], s[2]).normalize(), this.stage.camera)) return;
    this.stage.controls.enabled = false;
    this.stage.setOverlayEnabled(true);
    this.emit('closeup');
  }

  /** Fly back out to the globe view. */
  exitCloseup() {
    const o = this.closeup.target;
    if (!o || this.closeup.phase === 'out') return;
    const to = this.viewPositionFor(o) ?? this.stage.camera.position.clone().setLength(4.4);
    this.closeup.exit(to, () => this.restoreGlobeCamera());
    this.emit('closeup');
  }

  /** Leave at once (another object was selected, or the object is gone). */
  private leaveCloseupNow() {
    const o = this.closeup.target;
    const to = (o && this.viewPositionFor(o)) || this.stage.camera.position.clone().setLength(4.4);
    this.closeup.stop();
    this.stage.camera.position.copy(to);
    this.restoreGlobeCamera();
  }

  private restoreGlobeCamera() {
    const { camera, controls } = this.stage;
    camera.up.set(0, 1, 0);
    controls.target.set(0, 0, 0);
    controls.enabled = true;
    controls.update();
    this.stage.setOverlayEnabled(false);
    this.emit('closeup');
  }

  /** Precise position and velocity direction (SGP4 for objects in orbit now). */
  objectState(o: SatObject, t: number): ObjectState {
    if (!this.keplerMode && this.isLiveObject(o)) {
      const rec = satrecFor(o);
      const st = rec && stateAt(rec, t);
      if (st) {
        const p = eciToScene(st.position.x, st.position.y, st.position.z);
        const v = new THREE.Vector3(st.velocity.x, st.velocity.z, -st.velocity.y);
        return { p, v };
      }
    }
    const p = this.scenePosition(o, new THREE.Vector3(), t);
    const q = this.scenePosition(o, new THREE.Vector3(), t + 1000);
    return { p, v: q.sub(p) };
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
    if (this.skyView.active) return;
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
    // The faint SGP4 orbit rings describe today's orbits, so not in history mode.
    return this.keplerMode ? [] : list.filter((o) => this.isLiveObject(o) && this.launched(o.idx));
  }

  // ---------- history ----------
  /** Is o in orbit at the current date (launched, not yet re-entered)? */
  inOrbit(o: SatObject) {
    if (!this.history) return !o.decay;
    if (this.historyLayer) return !this.gated(o.idx) && this.historyLayer.aliveAt(o.idx, this.history.cutoff);
    return this.launched(o.idx);
  }

  /** Filtered objects that are in orbit at the current date. */
  inOrbitList() {
    return this.history ? this.visibleList.filter((o) => this.inOrbit(o)) : this.visibleList;
  }

  /** Has object i launched by the history cutoff (always true outside history mode)? */
  launched(i: number) {
    return !this.history || this.launchMs[i] <= this.history.cutoff;
  }

  setHistory(patch: Partial<HistoryState>) {
    if (this.skyView.active) this.exitSkyView();
    const wasActive = !!this.history;
    this.history = { cutoff: SPACE_AGE_START, playing: false, speed: 2 * 365.25 * 86400e3 / 1000, ...this.history, ...patch };
    // Orbits animate in real time while the calendar is scrubbed.
    if (!wasActive) this.clock.resetToNow();
    this.history.cutoff = Math.max(SPACE_AGE_START, this.history.cutoff);
    if (this.history.cutoff >= Date.now()) return this.exitHistory();
    // A jump in history time: the snapshot propagator should catch up at once.
    if ('cutoff' in patch) this.historyClockListeners.forEach((fn) => fn());
    if (!wasActive) {
      void this.ensureHistory();
      if (this.historyLayer) {
        this.applyFilters();
        if (this.selected) this.setSelectionOverlay(this.selected);
      }
    }
    this.syncSnapshot();
    this.pushVisibility();
    this.emit('history');
  }

  /**
   * Put the orbit layer on the best snapshot for the history date: an event
   * snapshot within days, else the nearest quarterly/yearly one, else today's
   * elements. Then decide whether true (SGP4) positions can be drawn.
   */
  private syncSnapshot() {
    const layer = this.historyLayer;
    const h = this.history;
    if (!layer || !h) {
      this.snapWanted = undefined;
      return;
    }
    const info = pickEventSnapshot(this.snapshots, h.cutoff) ?? pickSnapshot(this.snapshots, h.cutoff, Date.now());
    const key = info?.key ?? null;
    if (key !== this.snapWanted) {
      this.snapWanted = key;
      const applied = () => {
        this.updateDebrisGate();
        if (this.selected) this.setSelectionOverlay(this.selected);
        this.emit('history');
      };
      if (!info) {
        layer.applySnapshot(null, this.indexOf);
        this.activeSnapshot = null;
        applied();
      } else {
        void loadSnapshot(info).then((snap) => {
          if (this.snapWanted !== info.key || !snap || !this.historyLayer) return;
          this.historyLayer.applySnapshot(snap, this.indexOf);
          this.activeSnapshot = snap;
          applied();
          this.syncTrue();
        });
        // Fetch the next snapshots ahead of playback.
        if (h.playing) {
          const ahead = this.snapshots.filter((x) => x.kind !== 'event' && x.t > info.t).slice(0, 2);
          for (const x of ahead) void loadSnapshot(x);
        }
      }
    }
    this.syncTrue();
  }

  private updateDebrisGate() {
    const layer = this.historyLayer;
    if (!layer || !this.activeSnapshot) this.debrisGate = null;
    else {
      const N = this.cat.objects.length;
      const g = new Uint8Array(N).fill(1);
      for (let i = 0; i < N; i++) if (this.cat.objects[i].type === 'D' && !layer.inSnapshot[i]) g[i] = 0;
      this.debrisGate = g;
    }
    this.historyVisDirty = true;
    this.pushVisibility();
  }

  /** Hidden by the debris gate (an untracked fragment at this date)? */
  gated(i: number) {
    return !!this.debrisGate && this.history !== null && this.debrisGate[i] === 0;
  }

  /** True positions when not fast-forwarding and close to an SGP4-ready snapshot. */
  private syncTrue() {
    const h = this.history;
    const snap = this.activeSnapshot;
    const layer = this.historyLayer;
    const window = (snap?.kind === 'event' ? 3 : 7) * 86400e3;
    const eligible = !!h && !!layer && !!snap && snap.sgp4 && !h.playing && Math.abs(h.cutoff - snap.t) <= window;
    if (eligible && this.trueProp?.key !== snap!.key) {
      this.trueProp?.prop.dispose();
      const omms = [];
      const idx: number[] = [];
      for (let k = 0; k < snap!.norad.length; k++) {
        const i = this.indexOf(snap!.norad[k]);
        if (i === undefined) continue;
        idx.push(i);
        omms.push({
          OBJECT_NAME: '',
          OBJECT_ID: '',
          EPOCH: new Date(snap!.epoch[k]).toISOString().replace('Z', ''),
          MEAN_MOTION: snap!.n[k],
          ECCENTRICITY: snap!.e[k],
          INCLINATION: snap!.i[k],
          RA_OF_ASC_NODE: snap!.raan[k],
          ARG_OF_PERICENTER: snap!.argp[k],
          MEAN_ANOMALY: snap!.ma[k],
          EPHEMERIS_TYPE: 0 as const,
          CLASSIFICATION_TYPE: 'U' as const,
          NORAD_CAT_ID: snap!.norad[k],
          ELEMENT_SET_NO: 0,
          REV_AT_EPOCH: 0,
          BSTAR: snap!.bstar[k],
          MEAN_MOTION_DOT: 0,
          MEAN_MOTION_DDOT: 0,
        });
      }
      const prop = new Propagator(omms, this.historyClock);
      const entry = { key: snap!.key, prop, indices: Int32Array.from(idx), ready: false };
      prop.onUpdate(() => {
        this.historyLayer?.setTruePositions(prop, entry.indices);
        if (!entry.ready) {
          entry.ready = true;
          this.emit('history');
        }
      });
      this.trueProp = entry;
    }
    if (!eligible && this.trueProp && this.trueProp.key !== snap?.key) {
      this.trueProp.prop.dispose();
      this.trueProp = null;
    }
    const was = this.trueMode;
    this.trueMode = eligible && !!this.trueProp?.ready;
    if (was !== this.trueMode) this.emit('history');
  }

  exitHistory() {
    if (!this.history) return;
    this.history = null;
    if (this.selected && !this.isLiveObject(this.selected)) this.select(null);
    this.snapWanted = undefined;
    this.activeSnapshot = null;
    this.debrisGate = null;
    this.trueProp?.prop.dispose();
    this.trueProp = null;
    this.trueMode = false;
    if (this.historyLayer) this.applyFilters();
    else this.pushVisibility();
    if (this.selected) this.setSelectionOverlay(this.selected);
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
      // One orbit layer for everything: index == catalogue index.
      this.historyLayer = new HistoryPoints(this.cat.objects, Date.now());
      this.stage.scene.add(this.historyLayer.points);
      this.historyInfo = { count: data.objects.length, approx: data.approx };
      this.snapshots = parseManifest(data.snapshots);
      this.historyStatus = 'ready';
      this.historyVisDirty = true;
      this.recolor();
      this.applyFilters();
      this.syncSnapshot();
      if (this.selected) this.setSelectionOverlay(this.selected);
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
    this.skyMag = grow(this.skyMag, n, 99);
    this.stdMags = null;
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

    // Advance history time: fast while playing, otherwise at real time.
    // Reaching the present hands back to live time.
    const h = this.history;
    if (h?.playing) {
      h.cutoff += realDt * h.speed;
      if (h.cutoff >= Date.now()) {
        this.exitHistory();
        this.clock.resetToNow();
      } else {
        if (this.keplerMode) this.countHistory();
        else this.pushVisibility();
        this.syncSnapshot();
        this.emit('history');
      }
    } else if (h) {
      h.cutoff += Math.min(2000, now - this.lastFrameRaw);
      if (now - this.lastHistoryCount > 1000) {
        this.lastHistoryCount = now;
        if (this.keplerMode) this.countHistory();
        this.syncSnapshot();
      }
    }
    this.lastFrameRaw = now;

    // Earth orientation & sun
    const g = gmst(t);
    this.earth.group.rotation.y = g;
    if (this.settings.earthFixed && !this.skyView.active) {
      const dg = g - this.lastGmst;
      if (Math.abs(dg) < 1) camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), dg);
    }
    this.lastGmst = g;
    const s = sunDirectionEci(t);
    const sun = eciToScene(s[0], s[1], s[2]).normalize();
    this.earth.setSun(sun);
    this.earth.setCloudDrift(((t / 86400000) * 0.004) % 1);

    // Ease the off-centre projection.
    const vo = this.viewOffset;
    if (Math.abs(vo.tx - vo.x) > 0.3 || Math.abs(vo.ty - vo.y) > 0.3 || camera.view === null) {
      vo.x += (vo.tx - vo.x) * 0.08;
      vo.y += (vo.ty - vo.y) * 0.08;
      const W = window.innerWidth;
      const H = window.innerHeight;
      camera.setViewOffset(W, H, -vo.x, -vo.y, W, H);
    }

    if (this.skyView.active) this.frameSkyView(t, sun);
    else if (this.closeup.active) {
      const o = this.closeup.target!;
      if (!this.hasPosition(o)) this.leaveCloseupNow();
      else {
        const st = this.objectState(o, t);
        const up = st.p.clone().normalize();
        const lit = sunlitScene(st.p.x, st.p.y, st.p.z, [sun.x, sun.y, sun.z]);
        const dayside = THREE.MathUtils.clamp(up.dot(sun) * 1.5 + 0.35, 0, 1);
        this.closeup.update(st, sun, lit, dayside, camera);
        if (!this.closeup.active) this.emit('closeup');
      }
    } else {
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
    }

    // Gentle auto-rotate when idle with nothing selected.
    if (!this.closeup.active && !this.skyView.active) {
      controls.autoRotate = this.settings.autoRotate && !this.selected && now - this.idleSince > 4000 && !this.flight;
      controls.autoRotateSpeed = 0.35;
      controls.update();
    }
    this.celestial.update(sun, moonPositionEci(t), camera);
    this.celestial.updatePlanets(t);

    const { renderer } = this.stage;
    this.sats.update(t, renderer.domElement.clientHeight, renderer.getPixelRatio());
    const layer = this.historyLayer;
    this.sats.points.visible = !this.keplerMode;
    if (layer) {
      layer.points.visible = this.keplerMode;
      if (this.history) {
        const fresh = this.history.playing ? this.history.speed * 900 : 0;
        layer.update(t, this.history.cutoff, fresh, renderer.domElement.clientHeight, renderer.getPixelRatio(), this.sats.material.uniforms.uMinSize.value);
        layer.setTrueMode(this.trueMode, this.history.cutoff, t);
      }
    }

    // In close-up, the model replaces the dot, and the orbit lines and other objects would only clutter it.
    const cu = this.closeup.active;
    if (cu || this.skyView.active) {
      this.sats.points.visible = false;
      if (layer) layer.points.visible = false;
    }
    // The sky view draws the selected object's track across the sky instead of its orbit.
    this.selection.setSuppressed(cu || this.skyView.active);
    this.selState = this.selection.update(t, this.settings.track, this.settings.footprint);
    if (this.observer) this.refreshSky();
    this.updateSightLines(t);
    this.updatePairLine(t);
    this.orbitSet.update(cu ? [] : this.orbitSetObjects(), this.colorsLin, t, this.settings.orbits);
    if (cu) this.sightLines.visible = this.pairLine.visible = false;
    if (this.skyView.active) this.sightLines.visible = false;

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
