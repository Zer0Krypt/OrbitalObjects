import * as THREE from 'three';
import type { App } from '../app';
import { DIPOLE_AXIS, DIPOLE_CENTRE, RE_KM } from '../sim/belts';
import { shadow } from '../sim/eclipse';
import { eciToScene, sunDirectionEci } from '../sim/astro';

/**
 * Globe overlays: the aurora forecast, the Van Allen radiation belts and the
 * Moon's shadow during solar eclipses. Each is a shader on a sphere, so they
 * cost nothing while switched off.
 */

// ---------- aurora ----------
export function createAuroraLayer(app: App) {
  const tex = new THREE.DataTexture(new Uint8Array(360 * 181), 360, 181, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorldN;
      varying vec3 vView;
      void main() {
        vLocal = position;
        vWorldN = normalize(mat3(modelMatrix) * position);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vView = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform vec3 uSun;
      uniform float uTime;
      varying vec3 vLocal;
      varying vec3 vWorldN;
      varying vec3 vView;
      void main() {
        vec3 p = normalize(vLocal);
        float lat = degrees(asin(clamp(p.y, -1.0, 1.0)));
        float lon = degrees(atan(-p.z, p.x));
        vec2 uv = vec2(fract(lon / 360.0 + 1.0) + 0.5 / 360.0, (lat + 90.5) / 181.0);
        float v = texture2D(uTex, uv).r * 2.55; // bytes are percent, so 100% reads as 100/255
        float a = smoothstep(0.03, 0.6, v);
        // Shimmer along longitude, like curtains.
        a *= 0.75 + 0.25 * sin(lon * 1.7 + uTime * 0.6) * sin(lon * 0.37 - uTime * 0.23);
        // Daylight washes it out.
        float day = dot(vWorldN, uSun);
        a *= 1.0 - smoothstep(-0.12, 0.18, day);
        // Brighter seen edge-on near the limb.
        a *= 0.6 + 0.6 * (1.0 - abs(dot(vWorldN, vView)));
        vec3 green = vec3(0.25, 1.0, 0.45);
        vec3 red = vec3(0.95, 0.25, 0.4);
        vec3 col = mix(green, red, smoothstep(0.75, 1.0, v) * 0.35);
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.018, 192, 96), mat);
  mesh.renderOrder = 3;
  mesh.visible = false;
  app.earth.group.add(mesh);
  const sync = () => {
    mesh.visible = app.settings.aurora && !!app.aurora && !app.skyView.active;
    if (app.settings.aurora && !app.aurora) void app.refreshAurora();
  };
  app.on('aurora', () => {
    if (app.aurora) {
      (tex.image.data as Uint8Array).set(app.aurora.data);
      tex.needsUpdate = true;
    }
    sync();
  });
  app.on('settings', sync);
  app.on('skyview', sync);
  app.on('frame', () => {
    if (!mesh.visible) return;
    const s = sunDirectionEci(app.clock.now());
    mat.uniforms.uSun.value.copy(eciToScene(s[0], s[1], s[2]).normalize());
    mat.uniforms.uTime.value = performance.now() / 1000;
  });
  sync();
  return mesh;
}

// ---------- radiation belts ----------
export function createBeltsLayer(app: App) {
  // Dipole axis and centre in the Earth-fixed scene frame (x, y = north, z = −east).
  const axis = new THREE.Vector3(DIPOLE_AXIS[0], DIPOLE_AXIS[2], -DIPOLE_AXIS[1]);
  const centre = new THREE.Vector3(DIPOLE_CENTRE[0], DIPOLE_CENTRE[2], -DIPOLE_CENTRE[1]).divideScalar(RE_KM);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uAxis: { value: axis.clone() }, uCentre: { value: centre.clone() }, uCam: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uAxis;
      uniform vec3 uCentre;
      uniform vec3 uCam;
      varying vec3 vWorld;
      const float RMAX = 8.0;
      vec2 sphere(vec3 ro, vec3 rd, float r) {
        float b = dot(ro, rd);
        float c = dot(ro, ro) - r * r;
        float h = b * b - c;
        if (h < 0.0) return vec2(-1.0);
        h = sqrt(h);
        return vec2(-b - h, -b + h);
      }
      void main() {
        vec3 ro = uCam;
        vec3 rd = normalize(vWorld - uCam);
        vec2 t = sphere(ro, rd, RMAX);
        float t0 = max(t.x, 0.0);
        float t1 = t.y;
        // Stop at the Earth.
        vec2 e = sphere(ro, rd, 1.0);
        if (e.x > 0.0) t1 = min(t1, e.x);
        if (t1 <= t0) discard;
        const int N = 72;
        float dt = (t1 - t0) / float(N);
        vec3 acc = vec3(0.0);
        float alpha = 0.0;
        for (int i = 0; i < N; i++) {
          vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt) - uCentre;
          float r = length(p);
          float s = dot(p, uAxis) / r;
          float c2 = max(1e-4, 1.0 - s * s);
          float L = r / c2;
          // Particles only reach where the field is weak enough (see sim/belts.ts).
          float B = sqrt(1.0 + 3.0 * s * s) / (r * r * r);
          float mirror = 1.0 - smoothstep(0.7, 0.95, B);
          float inner = exp(-pow((L - 1.55) / (L < 1.55 ? 0.24 : 0.32), 2.0)) * mirror;
          float outer = 0.75 * exp(-pow((L - 4.5) / 0.9, 2.0)) * mirror;
          acc += (vec3(1.0, 0.55, 0.2) * inner * 2.2 + vec3(0.45, 0.4, 1.0) * outer) * dt;
          alpha += (inner * 2.2 + outer) * dt;
        }
        float a = 1.0 - exp(-alpha * 0.32);
        gl_FragColor = vec4(acc / max(alpha, 1e-4) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(8, 48, 32), mat);
  mesh.renderOrder = 2;
  mesh.visible = false;
  mesh.frustumCulled = false;
  app.stage.scene.add(mesh);
  const sync = () => (mesh.visible = app.settings.belts && !app.skyView.active && !app.closeup.active);
  app.on('settings', sync);
  app.on('skyview', sync);
  app.on('closeup', sync);
  const q = new THREE.Quaternion();
  mesh.onBeforeRender = (_r, _s, cam) => {
    // The dipole turns with the Earth.
    app.earth.group.getWorldQuaternion(q);
    mat.uniforms.uAxis.value.copy(axis).applyQuaternion(q);
    mat.uniforms.uCentre.value.copy(centre).applyQuaternion(q);
    mat.uniforms.uCam.value.copy(cam.position);
  };
  sync();
  return mesh;
}

// ---------- the Moon's shadow ----------
export function createEclipseShadow(app: App, nextEclipse: () => { max: number; start: number; end: number } | null) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3() }, uMoon: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform vec3 uMoon;
      varying vec3 vWorld;
      const float RS = 696000.0 / 6371.0;
      const float RM = 1737.4 / 6371.0;
      const float PI = 3.14159265;
      float overlap(float r1, float r2, float d) {
        if (d >= r1 + r2) return 0.0;
        if (d <= abs(r1 - r2)) return r2 >= r1 ? 1.0 : (r2 * r2) / (r1 * r1);
        float a = r1 * r1 * acos(clamp((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1), -1.0, 1.0));
        float b = r2 * r2 * acos(clamp((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2), -1.0, 1.0));
        float c = 0.5 * sqrt(max(0.0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
        return (a + b - c) / (PI * r1 * r1);
      }
      void main() {
        vec3 p = vWorld;
        vec3 ts = uSun - p;
        vec3 tm = uMoon - p;
        float ds = length(ts);
        float dm = length(tm);
        vec3 a = ts / ds;
        vec3 b = tm / dm;
        // Only where the Sun is up.
        float up = dot(normalize(p), a);
        if (up < -0.02) discard;
        float rs = RS / ds;
        float rm = RM / dm;
        float sep = atan(length(cross(a, b)), dot(a, b));
        float f = overlap(rs, rm, sep);
        if (f <= 0.001) discard;
        // Deep darkness in totality, a dimming in the partial phases.
        float dark = f >= 0.999 ? 0.93 : 0.88 * pow(f, 0.7);
        dark *= smoothstep(-0.02, 0.06, up);
        gl_FragColor = vec4(0.0, 0.0, 0.02, dark);
      }`,
    transparent: true,
    depthWrite: false,
  });
  // Above the cloud layer (1.0055), which writes depth.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.0075, 192, 128), mat);
  mesh.renderOrder = 2;
  mesh.visible = false;
  app.stage.scene.add(mesh);
  let lastT = NaN;
  app.on('frame', () => {
    const t = app.clock.now();
    const e = app.settings.eclipseShadow && !app.skyView.active ? nextEclipse() : null;
    const on = !!e && t > e.start - 30 * 60e3 && t < e.end + 30 * 60e3;
    mesh.visible = on;
    if (!on || Math.abs(t - lastT) < 500) return;
    lastT = t;
    const sh = shadow(t);
    mat.uniforms.uSun.value.copy(eciToScene(sh.sun[0], sh.sun[1], sh.sun[2]));
    mat.uniforms.uMoon.value.copy(eciToScene(sh.moon[0], sh.moon[1], sh.moon[2]));
  });
  return mesh;
}

// ---------- aurora in the sky view ----------
/** Bearing (deg from north) from one place toward another along a great circle. */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const D = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * D) * Math.cos(lat2 * D);
  const x = Math.cos(lat1 * D) * Math.sin(lat2 * D) - Math.sin(lat1 * D) * Math.cos(lat2 * D) * Math.cos((lon2 - lon1) * D);
  return ((Math.atan2(y, x) / D) + 360) % 360;
}

/** A glow low toward the geomagnetic pole when the forecast says the aurora may be visible. */
export function createSkyAurora(app: App, view: () => { overhead: number; horizon: number } | null) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uPole: { value: new THREE.Vector3(1, 0, 0) },
      uStrength: { value: 0 },
      uReach: { value: 12 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uUp;
      uniform vec3 uPole;
      uniform float uStrength;
      uniform float uReach;
      uniform float uTime;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float s = dot(d, uUp);
        float el = degrees(asin(clamp(s, -1.0, 1.0)));
        vec3 hz = normalize(d - uUp * s + 1e-5);
        float c = dot(hz, uPole);
        float side = pow(max(0.0, 0.5 + 0.5 * c), 2.2);
        float ang = atan(dot(cross(uPole, hz), uUp), c);
        float curtain = 0.55 + 0.45 * sin(ang * 31.0 + uTime * 0.35) * sin(ang * 13.0 - uTime * 0.21);
        float h = smoothstep(-1.0, 3.0, el) * exp(-max(el, 0.0) / uReach);
        float a = uStrength * side * curtain * h;
        vec3 col = mix(vec3(0.2, 1.0, 0.45), vec3(0.85, 0.25, 0.45), smoothstep(uReach * 0.7, uReach * 1.8, el));
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  // Well inside the near plane would clip it; depth testing is off, so its size doesn't matter.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.visible = false;
  app.stage.scene.add(mesh);
  mesh.onBeforeRender = (_r, _s, cam) => {
    mesh.position.copy(cam.position);
    mesh.updateMatrixWorld();
  };
  app.on('frame', () => {
    const o = app.observer;
    const v = app.skyView.active && o ? view() : null;
    const dark = 1 - THREE.MathUtils.smoothstep(app.sunEl, -14, -6);
    const strength = v ? Math.min(1, Math.max(v.horizon, v.overhead) / 55) * dark : 0;
    mesh.visible = strength > 0.02;
    if (!mesh.visible || !o) return;
    const f = app.observerFrameAt(app.clock.now());
    if (!f) return;
    const pole = o.lat >= 0 ? [80.8, -72.7] : [-80.8, 107.3];
    const b = (bearing(o.lat, o.lon, pole[0], pole[1]) * Math.PI) / 180;
    const u = mat.uniforms;
    u.uUp.value.set(...f.up);
    u.uPole.value.set(...f.north).multiplyScalar(Math.cos(b)).add(new THREE.Vector3(...f.east).multiplyScalar(Math.sin(b))).normalize();
    u.uStrength.value = strength;
    u.uReach.value = 9 + (v!.overhead / 100) * 70;
    u.uTime.value = performance.now() / 1000;
  });
  return mesh;
}
