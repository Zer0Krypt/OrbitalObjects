import * as THREE from 'three';
import { latLonToScene } from '../sim/astro';

const base = import.meta.env.BASE_URL;

function tex(loader: THREE.TextureLoader, url: string, srgb: boolean, renderer: THREE.WebGLRenderer) {
  const t = loader.load(base + url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const earthVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vEast;
varying vec3 vNorth;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  mat3 m = mat3(modelMatrix);
  vNormalW = normalize(m * normal);
  // Tangent frame on the sphere (east, north) for bump mapping.
  vec3 eastL = normalize(cross(vec3(0.0, 1.0, 0.0), position) + vec3(1e-5, 0.0, 0.0));
  vEast = normalize(m * eastL);
  vNorth = normalize(m * cross(position, eastL));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const earthFrag = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D specTopo;
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float cloudOffset;
uniform float nightBoost;
uniform vec2 texel;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vEast;
varying vec3 vNorth;

void main() {
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 N0 = normalize(vNormalW);
  vec3 east = normalize(vEast);
  vec3 north = normalize(vNorth);
  float hL = texture2D(specTopo, vUv - vec2(texel.x, 0.0)).g;
  float hR = texture2D(specTopo, vUv + vec2(texel.x, 0.0)).g;
  float hD = texture2D(specTopo, vUv - vec2(0.0, texel.y)).g;
  float hU = texture2D(specTopo, vUv + vec2(0.0, texel.y)).g;
  vec3 N = normalize(N0 - 1.6 * ((hR - hL) * east + (hU - hD) * north));

  float ndl = dot(N0, sunDir);
  float ndlB = dot(N, sunDir);
  float day = smoothstep(-0.12, 0.22, ndl);

  vec3 dayCol = texture2D(dayMap, vUv).rgb;
  vec3 nightCol = texture2D(nightMap, vUv).rgb;
  float water = texture2D(specTopo, vUv).r;

  // Cloud shadows, offset slightly toward the sun.
  float cloud = texture2D(cloudMap, vUv + vec2(cloudOffset, 0.0)).r;
  float shadow = texture2D(cloudMap, vUv + vec2(cloudOffset - 0.0012, 0.0006)).r;

  vec3 lit = dayCol * (0.08 + 1.05 * max(ndlB, 0.0)) * (1.0 - 0.45 * shadow);

  // Ocean sun glint.
  vec3 H = normalize(sunDir + V);
  float spec = pow(max(dot(N0, H), 0.0), 60.0) * water * (1.0 - cloud) * day;
  vec3 glintCol = mix(vec3(1.0, 0.55, 0.3), vec3(1.0, 0.95, 0.85), smoothstep(0.0, 0.4, ndl));
  lit += glintCol * spec * 0.9;

  // City lights only where it is dark, warm-tinted, dimmed under clouds.
  float nightMask = 1.0 - smoothstep(-0.25, 0.08, ndl);
  vec3 cities = pow(nightCol, vec3(1.6)) * vec3(1.0, 0.78, 0.52) * nightBoost * (1.0 - 0.7 * cloud);

  // Faint "moonlit" base so the night hemisphere still reads as a globe.
  vec3 nightBase = dayCol * vec3(0.05, 0.065, 0.1) + vec3(0.004, 0.007, 0.016);
  vec3 col = mix(nightBase + cities, lit, day);
  col += cities * nightMask * (1.0 - day) * 0.6;
  // Thin cool rim on the night side.
  col += vec3(0.08, 0.16, 0.35) * pow(1.0 - max(dot(N0, V), 0.0), 4.0) * (1.0 - day) * 0.6;

  // Atmospheric haze toward the limb, colored by sun angle.
  float fres = pow(1.0 - max(dot(N0, V), 0.0), 3.0);
  vec3 dayHaze = vec3(0.32, 0.58, 1.0);
  vec3 duskHaze = vec3(1.0, 0.45, 0.2);
  float dusk = smoothstep(0.35, 0.0, abs(ndl)) * smoothstep(-0.3, 0.0, ndl);
  vec3 haze = mix(dayHaze, duskHaze, dusk);
  col = mix(col, haze, clamp(fres * (day * 0.85 + dusk * 0.4), 0.0, 0.85));

  // Terminator warm band.
  col += duskHaze * dusk * 0.06;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const cloudFrag = /* glsl */ `
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float cloudOffset;
uniform float opacity;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  float c = texture2D(cloudMap, vUv + vec2(cloudOffset, 0.0)).r;
  float ndl = dot(normalize(vNormalW), sunDir);
  float day = smoothstep(-0.15, 0.3, ndl);
  vec3 dusk = vec3(1.0, 0.62, 0.42);
  vec3 col = mix(vec3(0.05, 0.06, 0.08), mix(dusk, vec3(1.0), smoothstep(0.0, 0.35, ndl)), day);
  vec3 V = normalize(cameraPosition - vPosW);
  float limb = smoothstep(0.0, 0.25, dot(normalize(vNormalW), V));
  gl_FragColor = vec4(col * (0.85 + 0.15 * day), c * opacity * (0.35 + 0.65 * day) * limb);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const atmoVert = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Outer glow shell rendered from the inside (BackSide) with additive blending.
const atmoFrag = /* glsl */ `
uniform vec3 sunDir;
uniform float intensity;
varying vec3 vNormalW;
varying vec3 vPosW;
uniform float shell;
void main() {
  // Density from the view ray's closest approach to Earth's centre.
  vec3 D = normalize(vPosW - cameraPosition);
  float t = -dot(cameraPosition, D);
  vec3 C = cameraPosition + D * t;
  float b = length(C);
  float h = clamp((b - 1.0) / (shell - 1.0), 0.0, 1.0);
  float dens = exp(-h * 5.0) * (1.0 - smoothstep(0.75, 1.0, h));
  float ndl = dot(normalize(C), sunDir);
  float lit = smoothstep(-0.35, 0.3, ndl);
  float dusk = smoothstep(0.4, 0.0, abs(ndl + 0.02));
  vec3 col = mix(vec3(0.25, 0.52, 1.0), vec3(1.0, 0.48, 0.22), dusk * 0.6);
  float a = dens * (0.03 + 1.2 * lit) * intensity;
  gl_FragColor = vec4(col * a, a);
}`;

export interface EarthLayers {
  group: THREE.Group; // rotates with GMST
  earth: THREE.Mesh;
  clouds: THREE.Mesh;
  atmosphere: THREE.Mesh;
  borders: THREE.LineSegments;
  graticule: THREE.LineSegments;
  setSun(dirWorld: THREE.Vector3): void;
  setCloudDrift(t: number): void;
  ready: Promise<void>;
}

/**
 * Small (1024 px) textures load first so the globe appears quickly; the
 * full-resolution set replaces them a moment later unless `fullRes` is off
 * (slow or metered connections).
 */
export function createEarth(renderer: THREE.WebGLRenderer, fullRes = true): EarthLayers {
  const manager = new THREE.LoadingManager();
  const ready = new Promise<void>((resolve) => {
    manager.onLoad = () => resolve();
    manager.onError = () => resolve();
  });
  const loader = new THREE.TextureLoader(manager);
  const maps = {
    dayMap: { value: tex(loader, 'textures/earth-day-1k.jpg', true, renderer) },
    nightMap: { value: tex(loader, 'textures/earth-night-1k.jpg', true, renderer) },
    specTopo: { value: tex(loader, 'textures/earth-spec-topo-1k.jpg', false, renderer) },
    cloudMap: { value: tex(loader, 'textures/earth-clouds-1k.jpg', false, renderer) },
  };
  const texel = { value: new THREE.Vector2(1 / 1024, 1 / 512) };
  if (fullRes)
    void ready.then(() =>
      setTimeout(() => {
        // Swap each map in as it arrives.
        const full = new THREE.TextureLoader();
        const swap = (k: keyof typeof maps, url: string, srgb: boolean, onSwap?: () => void) =>
          full.load(base + url, (t) => {
            t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            t.wrapS = THREE.RepeatWrapping;
            const old = maps[k].value;
            maps[k].value = t;
            old.dispose();
            onSwap?.();
          });
        swap('dayMap', 'textures/earth-day.jpg', true);
        swap('nightMap', 'textures/earth-night.jpg', true);
        swap('specTopo', 'textures/earth-spec-topo.png', false, () => texel.value.set(1 / 2048, 1 / 1024));
        swap('cloudMap', 'textures/earth-clouds.jpg', false);
      }, 1200),
    );

  const sunDir = { value: new THREE.Vector3(1, 0, 0) };
  const cloudOffset = { value: 0 };

  const group = new THREE.Group();
  group.name = 'earth-fixed';

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 256, 160),
    new THREE.ShaderMaterial({
      uniforms: {
        ...maps,
        sunDir,
        cloudOffset,
        nightBoost: { value: 3.2 },
        texel,
      },
      vertexShader: earthVert,
      fragmentShader: earthFrag,
    }),
  );
  earth.name = 'earth';
  group.add(earth);

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.0055, 192, 128),
    new THREE.ShaderMaterial({
      uniforms: { cloudMap: maps.cloudMap, sunDir, cloudOffset, opacity: { value: 0.92 } },
      vertexShader: earthVert,
      fragmentShader: cloudFrag,
      transparent: true,
      depthWrite: false,
    }),
  );
  clouds.renderOrder = 1;
  group.add(clouds);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.06, 128, 96),
    new THREE.ShaderMaterial({
      uniforms: { sunDir, intensity: { value: 1.25 }, shell: { value: 1.06 } },
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  atmosphere.renderOrder = 2;

  // Graticule every 15°.
  const gPts: number[] = [];
  const v = new THREE.Vector3();
  const R = 1.0015;
  for (let lat = -75; lat <= 75; lat += 15)
    for (let lon = -180; lon < 180; lon += 2) {
      latLonToScene(lat, lon, R, v);
      gPts.push(v.x, v.y, v.z);
      latLonToScene(lat, lon + 2, R, v);
      gPts.push(v.x, v.y, v.z);
    }
  for (let lon = -180; lon < 180; lon += 15)
    for (let lat = -88; lat < 88; lat += 2) {
      latLonToScene(lat, lon, R, v);
      gPts.push(v.x, v.y, v.z);
      latLonToScene(lat + 2, lon, R, v);
      gPts.push(v.x, v.y, v.z);
    }
  const graticule = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(gPts, 3)),
    new THREE.LineBasicMaterial({ color: 0x7fb6ff, transparent: true, opacity: 0.07, depthWrite: false }),
  );
  graticule.visible = false;
  group.add(graticule);

  const borders = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xa8d0ff, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  borders.renderOrder = 1;
  group.add(borders);
  fetch(base + 'geo/borders.json')
    .then((r) => r.json())
    .then((rings: number[][]) => {
      const pts: number[] = [];
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      for (const ring of rings)
        for (let i = 0; i + 3 < ring.length; i += 2) {
          latLonToScene(ring[i + 1], ring[i], 1.0012, a);
          latLonToScene(ring[i + 3], ring[i + 2], 1.0012, b);
          pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      borders.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    })
    .catch(() => {});

  return {
    group,
    earth,
    clouds,
    atmosphere,
    borders,
    graticule,
    ready,
    setSun(d) {
      sunDir.value.copy(d).normalize();
    },
    setCloudDrift(t) {
      cloudOffset.value = t;
    },
  };
}
