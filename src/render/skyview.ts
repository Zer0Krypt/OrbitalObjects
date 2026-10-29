import * as THREE from 'three';
import type { Propagator } from '../sim/propagator';
import type { ObserverFrame } from '../sim/observer';

/**
 * First-person sky from the observer's location: a sky dome coloured by the
 * Sun's elevation, a ground that hides everything below the horizon, an
 * alt-azimuth grid, and satellites drawn by predicted brightness.
 */

const skyVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uUp;
varying vec3 vWorld;
void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  float h = dot(d, uUp);
  float s = dot(uSun, uUp);
  float mu = dot(d, uSun);
  float hz = pow(1.0 - clamp(h, 0.0, 1.0), 4.0);
  float day = smoothstep(-0.10, 0.25, s);
  // Twilight runs from the Sun 18° below the horizon to just above it.
  float tw = smoothstep(-0.31, -0.02, s) * (1.0 - smoothstep(0.05, 0.3, s));
  vec3 col = mix(vec3(0.10, 0.27, 0.66), vec3(0.52, 0.68, 0.88), hz) * day;
  float sunSide = 0.5 + 0.5 * mu;
  vec3 twZen = vec3(0.03, 0.055, 0.15);
  vec3 twHor = mix(vec3(0.16, 0.15, 0.28), vec3(1.0, 0.42, 0.14), pow(sunSide, 3.0));
  col += mix(twZen, twHor, hz) * tw * (1.0 - day);
  // Glow around the Sun.
  float m = max(mu, 0.0);
  col += vec3(1.0, 0.85, 0.62) * (pow(m, 28.0) * 0.7 + pow(m, 5.0) * 0.12) * smoothstep(-0.12, 0.05, s);
  col += vec3(0.003, 0.0045, 0.009) + vec3(0.006, 0.008, 0.014) * hz;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const groundVert = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Local frame: +Y up, −Z north, +X east.
const groundFrag = /* glsl */ `
uniform float uLight;
uniform vec3 uHaze;
varying vec3 vLocal;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
void main() {
  vec3 d = normalize(vLocal);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.x, -d.z);
  // A low, irregular skyline of hills and trees.
  float sil = 0.004 + 0.012 * noise(az * 9.0) + 0.006 * noise(az * 41.0) + 0.0025 * noise(az * 160.0);
  if (el > sil) discard;
  float depth = clamp(-el / 0.35, 0.0, 1.0);
  vec3 col = mix(uHaze * 0.55, vec3(0.012, 0.014, 0.016), smoothstep(0.0, 0.08, depth));
  col *= 0.35 + uLight;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ptsVert = /* glsl */ `
attribute vec3 aB;
attribute float aW;
attribute vec3 aColor;
attribute float aMag;
attribute float aVis;
uniform float uDt;
uniform float uPx;
uniform float uLimit;
uniform float uAll;
uniform float uHover;
uniform float uSelected;
uniform float uZoom;
varying vec3 vColor;
varying float vAlpha;
varying float vHot;
void main() {
  float a = aW * uDt;
  vec3 p = position * cos(a) + aB * sin(a);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  float id = float(gl_VertexID);
  float hot = (abs(id - uHover) < 0.5 || abs(id - uSelected) < 0.5) ? 1.0 : 0.0;
  vHot = hot;
  bool lit = aMag < 50.0;
  // Bright ones big, faint ones small; in Earth's shadow, a dim dot (or nothing).
  float k = lit ? clamp((uLimit - aMag) / (uLimit + 2.0), 0.0, 1.0) : 0.0;
  float seen = lit ? smoothstep(uLimit + 1.0, uLimit - 0.5, aMag) : 0.0;
  float size = lit ? 2.4 + 7.0 * k * k : 2.2;
  float alpha = lit ? mix(0.55 * uAll, 1.0, seen) : 0.4 * uAll;
  gl_PointSize = (size + hot * 6.0) * uPx * uZoom * step(0.5, aVis);
  vAlpha = max(alpha, hot) * step(0.5, aVis);
  vColor = lit ? mix(aColor, vec3(1.0, 0.97, 0.9), 0.35 + 0.4 * seen) * (0.8 + 1.6 * k) : aColor * 0.75;
}`;

const ptsFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHot;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float core = exp(-d * d * 18.0);
  float ring = vHot * smoothstep(0.08, 0.0, abs(d - 0.38));
  gl_FragColor = vec4(vColor * core + vec3(1.0) * ring, (core + ring) * vAlpha);
  #include <colorspace_fragment>
}`;

export class SkyViewLayer {
  readonly group = new THREE.Group();
  readonly dome: THREE.Mesh;
  readonly ground: THREE.Mesh;
  readonly grid: THREE.LineSegments;
  readonly points: THREE.Points;
  readonly trail: THREE.Line;
  readonly magAttr: THREE.BufferAttribute;
  readonly visAttr: THREE.BufferAttribute;
  private domeMat: THREE.ShaderMaterial;
  private groundMat: THREE.ShaderMaterial;
  private ptsMat: THREE.ShaderMaterial;
  private local = new THREE.Group(); // oriented to the observer's horizon

  constructor(private prop: Propagator, satGeometry: THREE.BufferGeometry) {
    this.group.visible = false;
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(850, 64, 32), this.domeMat);
    this.dome.renderOrder = -20;
    this.dome.frustumCulled = false;

    // Lower hemisphere plus a sliver above the horizon for the skyline.
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: { uLight: { value: 0 }, uHaze: { value: new THREE.Color(0.2, 0.25, 0.35) } },
      vertexShader: groundVert,
      fragmentShader: groundFrag,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.ground = new THREE.Mesh(new THREE.SphereGeometry(0.4, 192, 24, 0, Math.PI * 2, Math.PI / 2 - 0.05, Math.PI / 2 + 0.05), this.groundMat);
    this.ground.renderOrder = 60;
    this.ground.frustumCulled = false;

    // Alt-azimuth grid: altitude rings every 30°, azimuth spokes every 45°.
    const g: number[] = [];
    const R = 600;
    const pt = (az: number, el: number) => {
      const a = (az * Math.PI) / 180;
      const e = (el * Math.PI) / 180;
      return [R * Math.cos(e) * Math.sin(a), R * Math.sin(e), -R * Math.cos(e) * Math.cos(a)];
    };
    for (const el of [0, 30, 60])
      for (let az = 0; az < 360; az += 3) g.push(...pt(az, el), ...pt(az + 3, el));
    for (let az = 0; az < 360; az += 45) for (let el = 0; el < 88; el += 3) g.push(...pt(az, el), ...pt(az, el + 3));
    this.grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(g, 3)),
      new THREE.LineBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    this.grid.renderOrder = -7;
    this.grid.frustumCulled = false;

    // Satellites, sharing the propagator's buffers with the globe's point layer.
    const n = prop.count;
    const geo = new THREE.BufferGeometry();
    for (const k of ['position', 'aB', 'aW', 'aColor']) geo.setAttribute(k, satGeometry.getAttribute(k));
    this.magAttr = new THREE.BufferAttribute(new Float32Array(n).fill(99), 1).setUsage(THREE.DynamicDrawUsage);
    this.visAttr = new THREE.BufferAttribute(new Float32Array(n).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aMag', this.magAttr);
    geo.setAttribute('aVis', this.visAttr);
    this.ptsMat = new THREE.ShaderMaterial({
      uniforms: {
        uDt: { value: 0 },
        uPx: { value: 1 },
        uLimit: { value: 6 },
        uAll: { value: 1 },
        uHover: { value: -1 },
        uSelected: { value: -1 },
        uZoom: { value: 1 },
      },
      vertexShader: ptsVert,
      fragmentShader: ptsFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.ptsMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;

    this.trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x9fd0ff, dashSize: 0.004, gapSize: 0.004, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 4;

    this.local.add(this.ground, this.grid);
    this.group.add(this.dome, this.local, this.points, this.trail);
  }

  /** Per-object magnitude and visibility (refreshed about once a second). */
  setMagnitudes(mag: Float32Array, vis: Float32Array) {
    (this.magAttr.array as Float32Array).set(mag.subarray(0, this.prop.count));
    (this.visAttr.array as Float32Array).set(vis.subarray(0, this.prop.count));
    this.magAttr.needsUpdate = this.visAttr.needsUpdate = true;
  }

  setHighlight(hover: number | null, selected: number | null) {
    this.ptsMat.uniforms.uHover.value = hover ?? -1;
    this.ptsMat.uniforms.uSelected.value = selected ?? -1;
  }

  /** Track across the sky (scene points), or null to hide. */
  setTrail(pts: number[] | null) {
    if (!pts || pts.length < 6) {
      this.trail.visible = false;
      return;
    }
    this.trail.geometry.dispose();
    this.trail.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.trail.computeLineDistances();
    this.trail.visible = true;
  }

  update(opts: {
    t: number;
    frame: ObserverFrame;
    camera: THREE.PerspectiveCamera;
    sun: THREE.Vector3;
    sunEl: number;
    pixelRatio: number;
    limit: number;
    showAll: boolean;
    grid: boolean;
  }) {
    const { frame: f, camera, sun } = opts;
    const up = new THREE.Vector3(...f.up);
    const east = new THREE.Vector3(...f.east);
    const north = new THREE.Vector3(...f.north);
    this.dome.position.copy(camera.position);
    this.domeMat.uniforms.uSun.value.copy(sun);
    this.domeMat.uniforms.uUp.value.copy(up);
    // Local frame: X east, Y up, −Z north.
    const m = new THREE.Matrix4().makeBasis(east, up, north.clone().negate());
    this.local.position.copy(camera.position);
    this.local.quaternion.setFromRotationMatrix(m);
    this.grid.visible = opts.grid;
    const day = THREE.MathUtils.smoothstep(opts.sunEl, -12, 8);
    this.groundMat.uniforms.uLight.value = 0.02 + 0.6 * day;
    (this.groundMat.uniforms.uHaze.value as THREE.Color).setRGB(0.05 + 0.45 * day, 0.07 + 0.55 * day, 0.12 + 0.7 * day);
    const u = this.ptsMat.uniforms;
    u.uDt.value = opts.t - this.prop.snapshotTime;
    u.uPx.value = opts.pixelRatio;
    u.uLimit.value = opts.limit;
    u.uAll.value = opts.showAll ? 1 : 0;
    // Zoomed in: points grow a little, as they would through binoculars.
    u.uZoom.value = THREE.MathUtils.clamp(Math.sqrt(60 / camera.fov), 0.8, 1.8);
  }
}
