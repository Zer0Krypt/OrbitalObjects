import * as THREE from 'three';

// Debris density drawn as a glowing haze around Earth. Debris is close to
// symmetric about Earth's axis when averaged over orbits, so density is kept
// on an (altitude, latitude) grid and ray-marched through a shell.

const ALT_MIN = 150;
const ALT_MAX = 2150;
const NA = 80; // 25 km bins
const NL = 45; // 4° bins
const R_OUT = 1 + ALT_MAX / 6371;

const vert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
uniform sampler2D dens;
uniform float gain;
uniform float rOut;
varying vec3 vWorld;

// Ray–sphere (centred at the origin): returns entry/exit distances, or (1, 0) on a miss.
vec2 hit(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1.0, 0.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

vec3 ramp(float x) {
  vec3 a = vec3(0.55, 0.08, 0.05);
  vec3 b = vec3(1.0, 0.45, 0.12);
  vec3 c = vec3(1.0, 0.9, 0.55);
  return x < 0.5 ? mix(a, b, x * 2.0) : mix(b, c, x * 2.0 - 1.0);
}

void main() {
  vec3 o = cameraPosition;
  vec3 d = normalize(vWorld - o);
  vec2 sh = hit(o, d, rOut);
  if (sh.x > sh.y) discard;
  float t0 = max(sh.x, 0.0);
  float t1 = sh.y;
  vec2 e = hit(o, d, 1.0);
  if (e.x <= e.y && e.x > 0.0) t1 = min(t1, e.x);
  if (t1 <= t0) discard;
  const int N = 36;
  float dt = (t1 - t0) / float(N);
  vec3 acc = vec3(0.0);
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < N; i++) {
    vec3 p = o + d * (t0 + (float(i) + jitter) * dt);
    float r = length(p);
    float alt = (r - 1.0) * 6371.0;
    float u = (alt - ${ALT_MIN.toFixed(1)}) / ${(ALT_MAX - ALT_MIN).toFixed(1)};
    if (u < 0.0 || u > 1.0) continue;
    float v = asin(clamp(p.y / r, -1.0, 1.0)) / 3.14159265 + 0.5;
    float k = texture2D(dens, vec2(u, v)).r;
    acc += ramp(k) * k * k * k;
  }
  acc *= dt * gain;
  float a = clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0);
  gl_FragColor = vec4(acc, a);
}`;

export class DebrisCloud {
  readonly mesh: THREE.Mesh;
  private data = new Uint8Array(NA * NL * 4);
  private tex: THREE.DataTexture;
  /** Peak spatial density (objects per million km³) in the last update. */
  peak = 0;
  peakAlt = 0;

  constructor() {
    this.tex = new THREE.DataTexture(this.data, NA, NL, THREE.RGBAFormat);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(R_OUT, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: { dens: { value: this.tex }, gain: { value: 1.6 }, rOut: { value: R_OUT } },
        vertexShader: vert,
        fragmentShader: frag,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Rebuild from scene positions (Earth radii) of the objects to count. */
  update(points: ArrayLike<number>, n: number) {
    const grid = new Float32Array(NA * NL);
    for (let k = 0; k < n; k++) {
      const x = points[k * 3];
      const y = points[k * 3 + 1];
      const z = points[k * 3 + 2];
      const r = Math.hypot(x, y, z);
      const alt = (r - 1) * 6371;
      if (alt < ALT_MIN || alt >= ALT_MAX) continue;
      const i = Math.floor(((alt - ALT_MIN) / (ALT_MAX - ALT_MIN)) * NA);
      const j = Math.min(NL - 1, Math.floor((Math.asin(y / r) / Math.PI + 0.5) * NL));
      grid[j * NA + i]++;
    }
    // Counts -> objects per million km³ (each cell is a ring around the axis).
    const dr = (ALT_MAX - ALT_MIN) / NA;
    const dLat = Math.PI / NL;
    for (let j = 0; j < NL; j++) {
      const lat = -Math.PI / 2 + (j + 0.5) * dLat;
      for (let i = 0; i < NA; i++) {
        const r = 6371 + ALT_MIN + (i + 0.5) * dr;
        const vol = 2 * Math.PI * r * r * Math.cos(lat) * dLat * dr;
        grid[j * NA + i] = (grid[j * NA + i] / vol) * 1e6;
      }
    }
    // Light blur so a few hundred objects still read as a smooth haze.
    const blur = new Float32Array(grid.length);
    for (let j = 0; j < NL; j++)
      for (let i = 0; i < NA; i++) {
        let s = 0;
        let w = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -2; di <= 2; di++) {
            const jj = j + dj;
            const ii = i + di;
            if (jj < 0 || jj >= NL || ii < 0 || ii >= NA) continue;
            const ww = (dj ? 0.5 : 1) * (di ? 1 / (1 + Math.abs(di)) : 1);
            s += grid[jj * NA + ii] * ww;
            w += ww;
          }
        blur[j * NA + i] = s / w;
      }
    let max = 0;
    let at = 0;
    for (let k = 0; k < blur.length; k++)
      if (blur[k] > max) {
        max = blur[k];
        at = k;
      }
    this.peak = max;
    this.peakAlt = ALT_MIN + ((at % NA) + 0.5) * dr;
    // Log scale: the dense bands stand out without hiding the sparse ones.
    const ref = Math.max(max / 40, 1e-9);
    const norm = Math.log(1 + max / ref) || 1;
    for (let k = 0; k < blur.length; k++) {
      const v = Math.round((Math.log(1 + blur[k] / ref) / norm) * 255);
      this.data[k * 4] = this.data[k * 4 + 1] = this.data[k * 4 + 2] = v;
      this.data[k * 4 + 3] = 255;
    }
    this.tex.needsUpdate = true;
  }
}
