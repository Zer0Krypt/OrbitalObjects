import * as THREE from 'three';

// How many satellites of a constellation can see each point on Earth: a
// 2°-grid heatmap wrapped around the globe (in the Earth-fixed frame).

export const COV_W = 180;
export const COV_H = 90;
const DEG = Math.PI / 180;
const RE = 6371;

export interface CoverageStats {
  max: number;
  /** Share of the grid (by area) seen by at least `need` satellites. */
  covered: number;
  mean: number;
}

/** Sequential palette (dark blue → cyan → yellow), with transparency for "none". */
const STOPS: [number, [number, number, number]][] = [
  [0, [16, 66, 129]],
  [0.35, [42, 120, 214]],
  [0.65, [64, 200, 210]],
  [0.85, [190, 230, 120]],
  [1, [255, 226, 110]],
];
export function rampColor(f: number): [number, number, number] {
  f = Math.max(0, Math.min(1, f));
  for (let i = 1; i < STOPS.length; i++) {
    if (f <= STOPS[i][0]) {
      const [f0, a] = STOPS[i - 1];
      const [f1, b] = STOPS[i];
      const k = (f - f0) / (f1 - f0);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export class CoverageLayer {
  readonly mesh: THREE.Mesh;
  readonly counts = new Uint16Array(COV_W * COV_H);
  private tex: THREE.DataTexture;
  private data = new Uint8Array(COV_W * COV_H * 4);
  // Unit vectors of each cell centre (Earth-fixed, scene axes).
  private cells = new Float32Array(COV_W * COV_H * 3);
  private cosLat = new Float32Array(COV_H);

  constructor() {
    for (let j = 0; j < COV_H; j++) {
      const lat = (90 - (j + 0.5) * 2) * DEG;
      this.cosLat[j] = Math.cos(lat);
      for (let i = 0; i < COV_W; i++) {
        const lon = (-180 + (i + 0.5) * 2) * DEG;
        const k = (j * COV_W + i) * 3;
        this.cells[k] = Math.cos(lat) * Math.cos(lon);
        this.cells[k + 1] = Math.sin(lat);
        this.cells[k + 2] = -Math.cos(lat) * Math.sin(lon);
      }
    }
    this.tex = new THREE.DataTexture(this.data, COV_W, COV_H, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.flipY = false;
    // Equirectangular lookup from the sphere's own position, matching latLonToScene.
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex }, opacity: { value: 0.62 } },
      vertexShader: /* glsl */ `
varying vec3 vP;
void main() {
  vP = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform sampler2D map;
uniform float opacity;
varying vec3 vP;
void main() {
  float lat = asin(clamp(vP.y, -1.0, 1.0));
  float lon = atan(-vP.z, vP.x);
  vec2 uv = vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.14159265);
  vec4 c = texture2D(map, uv);
  if (c.a < 0.02) discard;
  gl_FragColor = vec4(c.rgb, c.a * opacity);
  #include <colorspace_fragment>
}`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1.007, 128, 64), mat);
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  /**
   * Recount from satellite positions: `sats` holds Earth-fixed unit vectors
   * and altitudes (km); `minEl` is the lowest useful elevation (deg).
   */
  update(sats: { x: number; y: number; z: number; alt: number }[], minEl: number, need: number): CoverageStats {
    const c = this.counts;
    c.fill(0);
    const e = minEl * DEG;
    for (const s of sats) {
      // Footprint half-angle at the Earth's centre for this altitude and elevation.
      const lam = Math.acos((RE / (RE + s.alt)) * Math.cos(e)) - e;
      if (!(lam > 0)) continue;
      const cosLam = Math.cos(lam);
      const lat = Math.asin(Math.max(-1, Math.min(1, s.y)));
      const lon = Math.atan2(-s.z, s.x);
      const j0 = Math.max(0, Math.floor((90 - (lat + lam) / DEG) / 2));
      const j1 = Math.min(COV_H - 1, Math.floor((90 - (lat - lam) / DEG) / 2));
      for (let j = j0; j <= j1; j++) {
        // Longitude span at this row (the whole row near the poles).
        const cl = Math.max(this.cosLat[j], 1e-3);
        const span = Math.min(Math.PI, lam / cl + 2 * DEG) / DEG;
        const iMid = (lon / DEG + 180) / 2;
        const n = Math.ceil(span / 2);
        const all = n * 2 + 1 >= COV_W;
        const i0 = all ? 0 : Math.floor(iMid) - n;
        const i1 = all ? COV_W - 1 : Math.floor(iMid) + n;
        for (let ii = i0; ii <= i1; ii++) {
          const i = ((ii % COV_W) + COV_W) % COV_W;
          const k = j * COV_W + i;
          const kk = k * 3;
          if (this.cells[kk] * s.x + this.cells[kk + 1] * s.y + this.cells[kk + 2] * s.z >= cosLam) c[k]++;
        }
      }
    }
    let max = 0;
    let area = 0;
    let cov = 0;
    let sum = 0;
    for (let j = 0; j < COV_H; j++)
      for (let i = 0; i < COV_W; i++) {
        const v = c[j * COV_W + i];
        if (v > max) max = v;
        area += this.cosLat[j];
        sum += v * this.cosLat[j];
        if (v >= need) cov += this.cosLat[j];
      }
    const top = Math.max(need * 2, max);
    for (let k = 0; k < c.length; k++) {
      const v = c[k];
      const [r, g, b] = rampColor(v / top);
      this.data[k * 4] = r;
      this.data[k * 4 + 1] = g;
      this.data[k * 4 + 2] = b;
      // Below the useful count: faint, so the gaps read as gaps.
      this.data[k * 4 + 3] = v === 0 ? 0 : v < need ? 90 : 230;
    }
    this.tex.needsUpdate = true;
    return { max, covered: cov / area, mean: sum / area };
  }
}
