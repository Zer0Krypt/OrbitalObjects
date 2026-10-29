import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { json2satrec, sgp4, type SatRec } from 'satellite.js';
import { toOMM, type SatObject } from '../data/catalog';
import { gmst, KM } from '../sim/astro';

const recCache = new Map<number, SatRec | null>();
export function satrecFor(o: SatObject): SatRec | null {
  if (!recCache.has(o.norad)) {
    try {
      const r = json2satrec(toOMM(o));
      recCache.set(o.norad, r.error ? null : r);
    } catch {
      recCache.set(o.norad, null);
    }
  }
  return recCache.get(o.norad)!;
}

/** SGP4 state at sim time (ms): TEME km, km/s. */
export function stateAt(rec: SatRec, ms: number) {
  const jd = ms / 86400000 + 2440587.5;
  const r = sgp4(rec, (jd - rec.jdsatepoch) * 1440);
  if (!r || !r.position || !Number.isFinite(r.position.x)) return null;
  return r as { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } };
}

const fade = (s: number) => (s < 0 ? 0.08 + 0.92 * (1 + s) ** 2.2 : 1 - 0.6 * s);

/** Highlighted orbit, ground track, footprint and nadir line for the selected object. */
export class SelectionOverlay {
  readonly orbit: Line2;
  readonly track: Line2;
  readonly footprint: THREE.LineLoop;
  readonly footFill: THREE.Mesh;
  readonly nadir: THREE.Line;
  private orbitMat: LineMaterial;
  private trackMat: LineMaterial;
  private obj: SatObject | null = null;
  private rec: SatRec | null = null;
  private lastBuild = -Infinity;
  private color = new THREE.Color();

  constructor(scene: THREE.Scene, earthGroup: THREE.Group) {
    this.orbitMat = new LineMaterial({
      linewidth: 2.2,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.orbit = new Line2(new LineGeometry(), this.orbitMat);
    this.orbit.renderOrder = 4;
    this.orbit.frustumCulled = false;
    scene.add(this.orbit);

    this.trackMat = new LineMaterial({
      linewidth: 1.25,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.track = new Line2(new LineGeometry(), this.trackMat);
    this.track.renderOrder = 4;
    this.track.frustumCulled = false;
    earthGroup.add(this.track);

    const fpGeom = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(129 * 3), 3));
    this.footprint = new THREE.LineLoop(
      fpGeom,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false }),
    );
    this.footprint.frustumCulled = false;
    this.footprint.renderOrder = 4;
    scene.add(this.footprint);

    // Translucent cap over the visibility footprint (triangle fan).
    const fan = new THREE.BufferGeometry();
    fan.setAttribute('position', new THREE.BufferAttribute(new Float32Array(130 * 3), 3));
    const idx: number[] = [];
    for (let i = 1; i <= 128; i++) idx.push(0, i, i + 1);
    fan.setIndex(idx);
    this.footFill = new THREE.Mesh(
      fan,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.footFill.frustumCulled = false;
    this.footFill.renderOrder = 4;
    scene.add(this.footFill);

    this.nadir = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.012, gapSize: 0.01, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.nadir.frustumCulled = false;
    scene.add(this.nadir);
    this.setVisible(false);
  }

  /** Show a fixed orbit path (re-entered objects) without track, footprint or nadir. */
  setStatic(path: number[], color: THREE.Color) {
    const col: number[] = [];
    const n = path.length / 3;
    for (let i = 0; i < n; i++) {
      const f = 0.35 + 0.65 * Math.abs(Math.sin((i / n) * Math.PI));
      col.push(color.r * f, color.g * f, color.b * f);
    }
    const g = new LineGeometry();
    g.setPositions(path);
    g.setColors(col);
    this.orbit.geometry.dispose();
    this.orbit.geometry = g;
    this.orbit.computeLineDistances();
    if (this.saved) this.saved[0] = true;
    else this.orbit.visible = true;
  }

  setResolution(w: number, h: number) {
    this.orbitMat.resolution.set(w, h);
    this.trackMat.resolution.set(w, h);
  }

  private saved: boolean[] | null = null;
  /** Hide everything temporarily (close-up view), restoring it afterwards. */
  setSuppressed(v: boolean) {
    const parts = [this.orbit, this.track, this.footprint, this.footFill, this.nadir];
    if (v && !this.saved) {
      this.saved = parts.map((p) => p.visible);
      for (const p of parts) p.visible = false;
    } else if (!v && this.saved) {
      parts.forEach((p, i) => (p.visible = this.saved![i]));
      this.saved = null;
    }
  }

  private setVisible(v: boolean) {
    this.orbit.visible = this.track.visible = this.footprint.visible = this.footFill.visible = this.nadir.visible = v;
  }

  set(obj: SatObject | null, color?: THREE.Color) {
    this.obj = obj;
    this.rec = obj ? satrecFor(obj) : null;
    this.lastBuild = -Infinity;
    if (color) this.color.copy(color);
    this.setVisible(!!this.rec);
    if (this.saved) {
      this.saved = null;
      this.setSuppressed(true);
    }
  }

  /** Rebuild the orbit & ground track when time has moved enough. */
  update(t: number, showTrack: boolean, showFootprint: boolean) {
    const o = this.obj;
    const rec = this.rec;
    if (!o || !rec) return null;
    const periodMs = o.period * 60000;
    if (Math.abs(t - this.lastBuild) > Math.min(periodMs / 90, 120000)) {
      this.build(t, o, rec, periodMs);
      this.lastBuild = t;
    }
    this.track.visible = showTrack && !this.saved;
    const st = stateAt(rec, t);
    if (!st) return null;
    const p = st.position;
    const sx = p.x * KM;
    const sy = p.z * KM;
    const sz = -p.y * KM;
    const r = Math.hypot(sx, sy, sz);

    // Nadir
    const na = this.nadir.geometry.getAttribute('position') as THREE.BufferAttribute;
    na.setXYZ(0, sx, sy, sz);
    na.setXYZ(1, (sx / r) * 1.001, (sy / r) * 1.001, (sz / r) * 1.001);
    na.needsUpdate = true;
    this.nadir.computeLineDistances();

    // Footprint (horizon circle, 0° elevation)
    this.footprint.visible = this.footFill.visible = showFootprint && !this.saved;
    if (showFootprint) {
      const lam = Math.acos(Math.min(1, 1 / r));
      const n = new THREE.Vector3(sx, sy, sz).divideScalar(r);
      const u = new THREE.Vector3(0, 1, 0).cross(n);
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
      u.normalize();
      const v = n.clone().cross(u);
      const fp = this.footprint.geometry.getAttribute('position') as THREE.BufferAttribute;
      const ff = this.footFill.geometry.getAttribute('position') as THREE.BufferAttribute;
      const R = 1.003;
      ff.setXYZ(0, n.x * R, n.y * R, n.z * R);
      const cl = Math.cos(lam);
      const sl = Math.sin(lam);
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        const ca = Math.cos(a) * sl;
        const sa = Math.sin(a) * sl;
        const x = (n.x * cl + u.x * ca + v.x * sa) * R;
        const y = (n.y * cl + u.y * ca + v.y * sa) * R;
        const z = (n.z * cl + u.z * ca + v.z * sa) * R;
        if (i < 129) fp.setXYZ(i, x, y, z);
        ff.setXYZ(i + 1, x, y, z);
      }
      fp.needsUpdate = ff.needsUpdate = true;
    }
    return st;
  }

  private build(t: number, o: SatObject, rec: SatRec, periodMs: number) {
    // Orbit: one revolution centred on now, in the inertial scene frame.
    const N = Math.min(720, Math.max(240, Math.round(o.period)));
    const pos: number[] = [];
    const col: number[] = [];
    const c = this.color;
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * 2 - 1;
      const st = stateAt(rec, t + s * periodMs * 0.5);
      if (!st) continue;
      const p = st.position;
      pos.push(p.x * KM, p.z * KM, -p.y * KM);
      const f = fade(s);
      col.push(c.r * f, c.g * f, c.b * f);
    }
    if (pos.length >= 6) {
      const g = new LineGeometry();
      g.setPositions(pos);
      g.setColors(col);
      this.orbit.geometry.dispose();
      this.orbit.geometry = g;
      this.orbit.computeLineDistances();
    }

    // Ground track: ±1.5 revs (capped at ±12h), Earth-fixed.
    const span = Math.min(periodMs * 1.5, 12 * 3600e3);
    const M = 600;
    const tp: number[] = [];
    const tc: number[] = [];
    for (let i = 0; i <= M; i++) {
      const s = (i / M) * 2 - 1;
      const ts = t + s * span;
      const st = stateAt(rec, ts);
      if (!st) continue;
      const p = st.position;
      const g = gmst(ts);
      const cg = Math.cos(g);
      const sg = Math.sin(g);
      // ECI -> ECEF
      const ex = p.x * cg + p.y * sg;
      const ey = -p.x * sg + p.y * cg;
      const ez = p.z;
      const l = Math.hypot(ex, ey, ez);
      const R = 1.0025;
      tp.push((ex / l) * R, (ez / l) * R, (-ey / l) * R);
      const f = fade(s) * 0.55;
      tc.push(c.r * f, c.g * f, c.b * f);
    }
    if (tp.length >= 6) {
      const g = new LineGeometry();
      g.setPositions(tp);
      g.setColors(tc);
      this.track.geometry.dispose();
      this.track.geometry = g;
      this.track.computeLineDistances();
    }
  }
}

/** Faint orbit rings for a (small) filtered set of objects. */
export class OrbitSet {
  readonly lines: THREE.LineSegments;
  private key = '';
  private builtAt = -Infinity;

  constructor(scene: THREE.Scene) {
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;
    scene.add(this.lines);
  }

  update(objs: SatObject[], colors: Float32Array, t: number, enabled: boolean) {
    this.lines.visible = enabled && objs.length > 0;
    if (!this.lines.visible) {
      this.key = '';
      return;
    }
    const key = objs.length + ':' + objs.slice(0, 50).map((o) => o.idx).join(',') + ':' + colors[objs[0].idx * 3];
    if (key === this.key && Math.abs(t - this.builtAt) < 30 * 60e3) return;
    this.key = key;
    this.builtAt = t;
    const S = objs.length > 200 ? 64 : 128;
    const pos = new Float32Array(objs.length * S * 6);
    const col = new Float32Array(objs.length * S * 6);
    let k = 0;
    for (const o of objs) {
      const rec = satrecFor(o);
      if (!rec) continue;
      const pm = o.period * 60000;
      let prev: number[] | null = null;
      const cr = colors[o.idx * 3] * 0.55;
      const cg = colors[o.idx * 3 + 1] * 0.55;
      const cb = colors[o.idx * 3 + 2] * 0.55;
      for (let i = 0; i <= S; i++) {
        const st = stateAt(rec, t + (i / S) * pm);
        if (!st) {
          prev = null;
          continue;
        }
        const p = [st.position.x * KM, st.position.z * KM, -st.position.y * KM];
        if (prev && k + 6 <= pos.length) {
          pos.set(prev, k);
          pos.set(p, k + 3);
          col[k] = col[k + 3] = cr;
          col[k + 1] = col[k + 4] = cg;
          col[k + 2] = col[k + 5] = cb;
          k += 6;
        }
        prev = p;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, k), 3));
    this.lines.geometry.dispose();
    this.lines.geometry = g;
  }
}
