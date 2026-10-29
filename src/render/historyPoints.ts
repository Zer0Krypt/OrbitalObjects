import * as THREE from 'three';
import type { SatObject } from '../data/catalog';
import type { Snapshot } from '../data/snapshots';
import { KM } from '../sim/astro';

const DEG = Math.PI / 180;
const DAY = 86400e3;
/** Reference for launch/decay "day" attributes (float32-friendly). */
const DAY0 = Date.UTC(1957, 0, 1);
export const toDay = (ms: number) => (ms - DAY0) / DAY;

const vert = /* glsl */ `
attribute vec3 aQ;
attribute float aE;
attribute float aM;
attribute float aN;
attribute vec2 aLife;
attribute vec3 aColor;
attribute float aVis;
uniform float uDt;
uniform float uCut;
uniform float uFresh;
uniform float uScale;
uniform float uSize;
uniform float uMinSize;
uniform float uHover;
uniform float uSelected;
varying vec3 vColor;
varying float vAlpha;
varying float vHot;
void main() {
  float alive = step(aLife.x, uCut) * step(uCut, aLife.y);
  float since = uCut - aLife.y;
  // A brief red flare where an object has just re-entered.
  float gone = (uFresh > 0.0 && since > 0.0 && since < uFresh) ? 1.0 - since / uFresh : 0.0;
  float fresh = uFresh > 0.0 ? alive * clamp(1.0 - (uCut - aLife.x) / uFresh, 0.0, 1.0) : 0.0;
  float vis = aVis * max(alive, gone);

  // Two-body orbit: solve Kepler's equation for the eccentric anomaly.
  float M = mod(aM + aN * uDt, 6.2831853);
  float E = aE < 0.8 ? M : 3.1415927;
  for (int k = 0; k < 10; k++) E -= (E - aE * sin(E) - M) / (1.0 - aE * cos(E));
  vec3 p = position * (cos(E) - aE) + aQ * sin(E);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float id = float(gl_VertexID);
  float hot = (abs(id - uHover) < 0.5 || abs(id - uSelected) < 0.5) ? 1.0 : 0.0;
  vHot = hot;
  float dist = -mv.z;
  float s = uSize * uScale / dist;
  gl_PointSize = clamp(s, uMinSize, 7.0) * (1.0 + hot * 1.6 + fresh * 1.1 + gone * 1.8) * step(0.001, vis);
  vAlpha = vis * clamp(1.4 - dist * 0.05, 0.55, 1.0) * (1.0 + gone);
  vColor = mix(aColor, vec3(1.0, 0.22, 0.12), gone);
}`;

const frag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHot;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);
  float hot = smoothstep(0.18, 0.0, d);
  vec3 col = mix(vColor, vec3(1.0), hot * (0.45 + 0.5 * vHot));
  gl_FragColor = vec4(col * (0.55 + core), core * vAlpha);
  #include <colorspace_fragment>
}`;

const FAR_FUTURE = 1e7; // "never re-enters", in days

/**
 * Every object drawn with a two-body orbit for history mode: those still in
 * orbit on today's elements, re-entered ones on their final elements — or,
 * when a yearly snapshot is applied, everyone on the orbit they had that year.
 * Visibility by date is evaluated on the GPU: launch <= cutoff < re-entry.
 * Layer index == catalogue index.
 */
export class HistoryPoints {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  /** CPU copies for picking: a·P, a·√(1−e²)·Q (scene units), e, M at t0, n (rad/s). */
  private P: Float32Array;
  private Q: Float32Array;
  private e: Float32Array;
  private m0: Float64Array;
  private n: Float64Array;
  private m0f: Float32Array;
  private nf: Float32Array;
  /** Pristine copies of the catalogue elements, restored before each snapshot. */
  private base: { P: Float32Array; Q: Float32Array; e: Float32Array; m0: Float64Array; n: Float64Array };
  readonly launchDay: Float32Array;
  readonly decayDay: Float32Array;
  private colorAttr: THREE.BufferAttribute;
  private visAttr: THREE.BufferAttribute;
  private orbitAttrs: THREE.BufferAttribute[];
  /** Year of the applied snapshot, or null for catalogue elements. */
  snapshotYear: number | null = null;

  constructor(readonly objects: SatObject[], private t0: number) {
    const N = objects.length;
    this.P = new Float32Array(N * 3);
    this.Q = new Float32Array(N * 3);
    this.e = new Float32Array(N);
    this.m0 = new Float64Array(N);
    this.n = new Float64Array(N);
    this.m0f = new Float32Array(N);
    this.nf = new Float32Array(N);
    this.launchDay = new Float32Array(N);
    this.decayDay = new Float32Array(N);
    const life = new Float32Array(N * 2);
    objects.forEach((o, i) => {
      const epoch = Number.isFinite(o.epochMs) ? o.epochMs : Date.parse(o.launch);
      this.setOrbit(i, o.meanMotion, o.ecc, o.incl, o.raan, o.argp, o.ma, epoch);
      const launch = Date.parse(o.launch + 'T00:00:00Z');
      this.launchDay[i] = Number.isFinite(launch) ? toDay(launch) : FAR_FUTURE;
      this.decayDay[i] = o.decay ? toDay(Date.parse(o.decay + 'T00:00:00Z') + DAY / 2) : FAR_FUTURE;
      life[i * 2] = this.launchDay[i];
      life[i * 2 + 1] = this.decayDay[i];
    });
    this.base = { P: this.P.slice(), Q: this.Q.slice(), e: this.e.slice(), m0: this.m0.slice(), n: this.n.slice() };

    const g = new THREE.BufferGeometry();
    this.orbitAttrs = [
      new THREE.BufferAttribute(this.P, 3),
      new THREE.BufferAttribute(this.Q, 3),
      new THREE.BufferAttribute(this.e, 1),
      new THREE.BufferAttribute(this.m0f, 1),
      new THREE.BufferAttribute(this.nf, 1),
    ];
    g.setAttribute('position', this.orbitAttrs[0]);
    g.setAttribute('aQ', this.orbitAttrs[1]);
    g.setAttribute('aE', this.orbitAttrs[2]);
    g.setAttribute('aM', this.orbitAttrs[3]);
    g.setAttribute('aN', this.orbitAttrs[4]);
    g.setAttribute('aLife', new THREE.BufferAttribute(life, 2));
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
    this.visAttr = new THREE.BufferAttribute(new Float32Array(N), 1);
    g.setAttribute('aColor', this.colorAttr);
    g.setAttribute('aVis', this.visAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uDt: { value: 0 },
        uCut: { value: 0 },
        uFresh: { value: 0 },
        uScale: { value: 1 },
        uSize: { value: 9 },
        uMinSize: { value: 1.6 },
        uHover: { value: -1 },
        uSelected: { value: -1 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
  }

  /** Write object i's orbit from mean elements (deg, rev/day) with mean anomaly `ma` at `epoch`. */
  private setOrbit(i: number, revPerDay: number, ecc: number, incl: number, raan: number, argp: number, ma: number, epoch: number) {
    const W = raan * DEG;
    const w = argp * DEG;
    const inc = incl * DEG;
    const cW = Math.cos(W);
    const sW = Math.sin(W);
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const ci = Math.cos(inc);
    const si = Math.sin(inc);
    // Perifocal unit vectors in the inertial frame.
    const px = cW * cw - sW * sw * ci;
    const py = sW * cw + cW * sw * ci;
    const pz = sw * si;
    const qx = -cW * sw - sW * cw * ci;
    const qy = -sW * sw + cW * cw * ci;
    const qz = cw * si;
    const n = (revPerDay * 2 * Math.PI) / 86400; // rad/s
    const a = Math.cbrt(398600.4418 / (n * n)) * KM;
    const b = a * Math.sqrt(1 - ecc * ecc);
    const k = i * 3;
    // inertial (x, y, z) -> scene (x, z, -y)
    this.P[k] = a * px;
    this.P[k + 1] = a * pz;
    this.P[k + 2] = -a * py;
    this.Q[k] = b * qx;
    this.Q[k + 1] = b * qz;
    this.Q[k + 2] = -b * qy;
    this.e[i] = ecc;
    this.n[i] = n;
    let m = (ma * DEG + n * ((this.t0 - epoch) / 1000)) % (2 * Math.PI);
    if (m < 0) m += 2 * Math.PI;
    this.m0[i] = m;
    this.m0f[i] = m;
    this.nf[i] = n;
  }

  /**
   * Put every object on the orbit it had in `snap`'s year (objects missing
   * from the snapshot keep their catalogue elements), or restore the
   * catalogue elements with null.
   */
  applySnapshot(snap: Snapshot | null, indexOf: (norad: number) => number | undefined) {
    this.P.set(this.base.P);
    this.Q.set(this.base.Q);
    this.e.set(this.base.e);
    this.m0.set(this.base.m0);
    this.n.set(this.base.n);
    for (let i = 0; i < this.n.length; i++) {
      this.m0f[i] = this.m0[i];
      this.nf[i] = this.n[i];
    }
    if (snap) {
      for (let k = 0; k < snap.norad.length; k++) {
        const i = indexOf(snap.norad[k]);
        if (i === undefined || !(snap.n[k] > 0)) continue;
        this.setOrbit(i, snap.n[k], snap.e[k], snap.i[k], snap.raan[k], snap.argp[k], snap.ma[k], snap.date);
      }
    }
    this.snapshotYear = snap ? snap.year : null;
    for (const a of this.orbitAttrs) a.needsUpdate = true;
  }

  update(simTime: number, cutoffMs: number, freshMs: number, viewportHeight: number, pixelRatio: number, minSize: number) {
    const u = this.material.uniforms;
    u.uDt.value = (simTime - this.t0) / 1000;
    u.uCut.value = toDay(cutoffMs);
    u.uFresh.value = freshMs / DAY;
    u.uScale.value = (viewportHeight * pixelRatio) / 900;
    u.uMinSize.value = minSize;
  }

  setColors(lin: Float32Array) {
    (this.colorAttr.array as Float32Array).set(lin);
    this.colorAttr.needsUpdate = true;
  }

  setVisibility(vis: Float32Array) {
    (this.visAttr.array as Float32Array).set(vis);
    this.visAttr.needsUpdate = true;
  }

  setHover(i: number | null) {
    this.material.uniforms.uHover.value = i ?? -1;
  }

  setSelected(i: number | null) {
    this.material.uniforms.uSelected.value = i ?? -1;
  }

  /** Is local object i in orbit at time ms? */
  aliveAt(i: number, ms: number) {
    const d = toDay(ms);
    return this.launchDay[i] <= d && d <= this.decayDay[i];
  }

  /** Scene position of local object i at sim time t (same model as the shader). */
  positionAt(i: number, t: number, out: { x: number; y: number; z: number }) {
    const e = this.e[i];
    const M = (this.m0[i] + this.n[i] * ((t - this.t0) / 1000)) % (2 * Math.PI);
    let E = e < 0.8 ? M : Math.PI;
    for (let k = 0; k < 12; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const c = Math.cos(E) - e;
    const s = Math.sin(E);
    const k3 = i * 3;
    out.x = this.P[k3] * c + this.Q[k3] * s;
    out.y = this.P[k3 + 1] * c + this.Q[k3 + 1] * s;
    out.z = this.P[k3 + 2] * c + this.Q[k3 + 2] * s;
    return out;
  }

  /** One full orbit as a closed polyline (scene units). */
  orbitPath(i: number, samples = 240) {
    const out: number[] = [];
    const k3 = i * 3;
    const e = this.e[i];
    for (let j = 0; j <= samples; j++) {
      const E = (j / samples) * Math.PI * 2;
      const c = Math.cos(E) - e;
      const s = Math.sin(E);
      out.push(this.P[k3] * c + this.Q[k3] * s, this.P[k3 + 1] * c + this.Q[k3 + 1] * s, this.P[k3 + 2] * c + this.Q[k3 + 2] * s);
    }
    return out;
  }
}
