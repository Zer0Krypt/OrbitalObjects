import * as THREE from 'three';
import { eciToScene, KM, MOON_RADIUS_KM, raDecToScene } from '../sim/astro';

const base = import.meta.env.BASE_URL;
/** Stars and constellation figures sit on a sphere this far out (scene units). */
export const STAR_RADIUS = 900;

export interface NamedStar {
  ra: number;
  dec: number;
  name: string;
  mag: number;
}
export interface Figure {
  id: string;
  name: string;
  label: [number, number] | null;
  rank: number;
}

/** B−V colour index -> linear RGB, via an approximate black-body temperature. */
function starColor(bv: number): [number, number, number] {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const k = t / 100;
  const r = k <= 66 ? 255 : 329.7 * (k - 60) ** -0.1332;
  const g = k <= 66 ? 99.47 * Math.log(k) - 161.12 : 288.12 * (k - 60) ** -0.0755;
  const b = k >= 66 ? 255 : k <= 19 ? 0 : 138.52 * Math.log(k - 10) - 305.04;
  const c = (v: number) => Math.min(1, Math.max(0, v / 255));
  // Desaturate: real star colours are subtle to the eye.
  const rgb = [c(r), c(g), c(b)].map((v) => 0.55 + 0.45 * v);
  return rgb.map((v) => v ** 2.2) as [number, number, number];
}

const starVert = /* glsl */ `
attribute float aMag;
attribute vec3 color;
uniform float uPx;
uniform float uLimit;
uniform float uGain;
uniform float uSize;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // 0 at the limiting magnitude, 1 for the brightest stars.
  float k = clamp((uLimit - aMag) / (uLimit + 1.5), 0.0, 1.0);
  gl_PointSize = (1.6 + 5.0 * k * k) * uPx * uSize;
  vAlpha = (0.2 + 0.8 * k) * uGain * smoothstep(uLimit + 0.4, uLimit - 0.6, aMag);
  vColor = color * (1.0 + 1.4 * k * k * k);
}`;

const starFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = exp(-r2 * 4.0) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const milkyFrag = /* glsl */ `
uniform float uGain;
varying vec3 vDir;
// Equatorial (J2000) -> galactic.
const mat3 EQ2GAL = mat3(-0.0548755604, 0.4941094279, -0.8676661490,
                         -0.8734370902, -0.4448296300, -0.1980763734,
                         -0.4838350155, 0.7469822445, 0.4559837762);
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 eq = vec3(d.x, -d.z, d.y); // scene -> inertial
  vec3 g = EQ2GAL * eq;
  float b = asin(clamp(g.z, -1.0, 1.0));
  float l = atan(g.y, g.x);
  // Thicker and brighter toward the galactic centre (l = 0).
  float centre = 0.5 + 0.5 * cos(l);
  float width = 0.08 + 0.07 * centre;
  float band = exp(-pow(b / width, 2.0));
  float bulge = exp(-(l * l) / 0.25 - (b * b) / 0.02);
  float n = fbm(d * 9.0);
  float clumps = pow(n, 1.8) * 2.2;
  // Dust lanes split the band along its middle.
  float rift = 1.0 - 0.7 * exp(-pow((b - 0.02) / 0.03, 2.0)) * smoothstep(0.45, 0.7, n) * centre;
  float v = (band * (0.25 + 0.75 * centre) * clumps + bulge * 0.7 * n) * rift;
  vec3 col = mix(vec3(0.6, 0.68, 0.95), vec3(1.0, 0.88, 0.74), centre * 0.5 + bulge * 0.4);
  gl_FragColor = vec4(col * v * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const moonVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const moonFrag = /* glsl */ `
uniform sampler2D map;
uniform vec3 sunDir;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPosW;
void main() {
  vec3 N = normalize(vN);
  float ndl = dot(N, sunDir);
  vec3 albedo = texture2D(map, vUv).rgb;
  // Lommel–Seeliger-ish: the full Moon looks flat, not like a shaded ball.
  vec3 V = normalize(cameraPosition - vPosW);
  float mu0 = max(ndl, 0.0);
  float mu = max(dot(N, V), 0.05);
  float lit = 2.0 * mu0 / (mu0 + mu);
  // Earth's shadow (lunar eclipses): umbra about 0.75 Earth radii wide at the Moon.
  float along = dot(vPosW, sunDir);
  float off = length(vPosW - along * sunDir);
  float umbra = along < 0.0 ? 1.0 - smoothstep(0.70, 0.78, off) : 0.0;
  float penumbra = along < 0.0 ? 1.0 - smoothstep(0.78, 1.30, off) : 0.0;
  vec3 col = albedo * lit * 1.35 * (1.0 - 0.45 * penumbra);
  col = mix(col, albedo * vec3(0.32, 0.09, 0.04) * mu0, umbra);
  // Earthshine on the dark side.
  col += albedo * 0.012;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createCelestial(renderer: THREE.WebGLRenderer) {
  // ---------- stars ----------
  const starGeo = new THREE.BufferGeometry();
  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uPx: { value: renderer.getPixelRatio() },
      uLimit: { value: 7.5 },
      uGain: { value: 0.85 },
      uSize: { value: 1 },
    },
    vertexShader: starVert,
    fragmentShader: starFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -9;

  const named: NamedStar[] = [];
  const figures: Figure[] = [];
  const figureLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x6f9bd8, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  figureLines.frustumCulled = false;
  figureLines.renderOrder = -8;

  const ready = Promise.all([
    fetch(base + 'sky/stars.bin')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`stars ${r.status}`))))
      .then((buf) => {
        const dv = new DataView(buf);
        const n = dv.getUint32(4, true);
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        const mag = new Float32Array(n);
        const v = new THREE.Vector3();
        for (let k = 0; k < n; k++) {
          const o = 8 + k * 6;
          const ra = (dv.getUint16(o, true) / 65536) * 360;
          const dec = (dv.getInt16(o + 2, true) / 32767) * 90;
          raDecToScene(ra, dec, STAR_RADIUS, v);
          pos.set([v.x, v.y, v.z], k * 3);
          mag[k] = dv.getInt8(o + 4) / 10;
          col.set(starColor(dv.getInt8(o + 5) / 40), k * 3);
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        starGeo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
      }),
    fetch(base + 'sky/constellations.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`constellations ${r.status}`))))
      .then((d: { stars: [number, number, string, number][]; figures: (Figure & { lines: number[][] })[] }) => {
        for (const [ra, dec, name, mag] of d.stars) named.push({ ra, dec, name, mag });
        const pts: number[] = [];
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        for (const f of d.figures) {
          figures.push({ id: f.id, name: f.name, label: f.label, rank: f.rank });
          for (const ln of f.lines)
            for (let i = 0; i + 3 < ln.length; i += 2) {
              raDecToScene(ln[i], ln[i + 1], STAR_RADIUS * 0.995, a);
              raDecToScene(ln[i + 2], ln[i + 3], STAR_RADIUS * 0.995, b);
              pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
            }
        }
        figureLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      }),
  ]).catch((err) => console.warn('Star data unavailable:', err));

  // ---------- Milky Way ----------
  const milkyWay = new THREE.Mesh(
    new THREE.SphereGeometry(STAR_RADIUS * 1.05, 96, 64),
    new THREE.ShaderMaterial({
      uniforms: { uGain: { value: 0.022 } },
      vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: milkyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    }),
  );
  milkyWay.renderOrder = -10;

  // ---------- Moon ----------
  const moonTex = new THREE.TextureLoader().load(base + 'textures/moon.jpg');
  moonTex.colorSpace = THREE.SRGBColorSpace;
  moonTex.anisotropy = 4;
  const sunDir = { value: new THREE.Vector3(1, 0, 0) };
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS_KM * KM, 96, 64),
    new THREE.ShaderMaterial({ uniforms: { map: { value: moonTex }, sunDir }, vertexShader: moonVert, fragmentShader: moonFrag }),
  );
  moon.name = 'moon';

  // ---------- Sun ----------
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.06, 'rgba(255,250,235,1)');
  grd.addColorStop(0.16, 'rgba(255,214,150,0.45)');
  grd.addColorStop(0.4, 'rgba(255,170,90,0.08)');
  grd.addColorStop(1, 'rgba(255,150,80,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const sunTex = new THREE.CanvasTexture(c);
  sunTex.colorSpace = THREE.SRGBColorSpace;
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sun.scale.setScalar(90);
  sun.renderOrder = -5;

  const tmp = new THREE.Vector3();
  const eclN = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  return {
    stars,
    milkyWay,
    figureLines,
    moon,
    sun,
    named,
    figures,
    ready,
    starUniforms: starMat.uniforms,
    milkyUniforms: (milkyWay.material as THREE.ShaderMaterial).uniforms,
    /** Place the Sun and Moon; `moonEci` in km. Sun direction is a unit scene vector. */
    update(sunScene: THREE.Vector3, moonEci: [number, number, number], camera: THREE.Camera) {
      // The Sun glow stays at a fixed distance from the camera so it reads the same in every view.
      sun.position.copy(camera.position).addScaledVector(sunScene, 800);
      sunDir.value.copy(sunScene);
      eciToScene(moonEci[0], moonEci[1], moonEci[2], moon.position);
      // Tidally locked: the near side (texture centre, local +X) faces Earth, north toward the ecliptic pole.
      const toEarth = tmp.copy(moon.position).negate().normalize();
      eclN.set(0, Math.cos(0.4091), Math.sin(0.4091));
      const z = new THREE.Vector3().crossVectors(toEarth, eclN).normalize();
      const y = new THREE.Vector3().crossVectors(z, toEarth).normalize();
      basis.makeBasis(toEarth, y, z);
      moon.quaternion.setFromRotationMatrix(basis);
    },
  };
}

export type Celestial = ReturnType<typeof createCelestial>;
