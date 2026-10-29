import * as THREE from 'three';
import type { SatObject } from '../data/catalog';
import { KM } from '../sim/astro';
import { modelFor, type SatModel } from './models';

/** Scene units per metre. */
const UNIT = KM / 1000;
const smooth = (k: number) => k * k * (3 - 2 * k);
const IN_MS = 2600;
const OUT_MS = 1700;

export interface ObjectState {
  /** Position, scene units. */
  p: THREE.Vector3;
  /** Velocity direction (any length). */
  v: THREE.Vector3;
}

/**
 * Close-up view of an object with a 3D model, at true scale. The model is
 * drawn in its own scene and depth range (metres, not Earth radii) on top of
 * the main scene. The camera orbits the object in its local frame, so the
 * view stays steady as it races around Earth.
 */
export class CloseUp {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera();
  target: SatObject | null = null;
  model: SatModel | null = null;
  phase: 'off' | 'in' | 'on' | 'out' = 'off';
  /** Camera position around the object: azimuth from the velocity direction, elevation above its local horizon (rad), distance (m). */
  az = 0.75;
  el = 0.32;
  dist = 160;
  /** Sunlit at the object? */
  sunlit = true;

  private t0 = 0;
  private from = { az: 0, el: 0, dist: 0, look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  private outTo = new THREE.Vector3();
  private onExit: (() => void) | null = null;
  private readonly sun = new THREE.DirectionalLight(0xfff6ea, 3.4);
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.07);
  private readonly earthLight = new THREE.DirectionalLight(0x7fa2d6, 0.8);
  private readonly basis = new THREE.Matrix4();
  private readonly X = new THREE.Vector3();
  private readonly Y = new THREE.Vector3();
  private readonly Z = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();

  constructor(renderer: THREE.WebGLRenderer) {
    this.scene.add(this.sun, this.sun.target, this.earthLight, this.earthLight.target, this.ambient);
    this.scene.environment = gradientEnvironment(renderer);
    this.scene.environmentIntensity = 0.55;
  }

  get active() {
    return this.phase !== 'off';
  }

  /** Model size (m) for framing. */
  get size() {
    return this.model?.size ?? 50;
  }
  get minDist() {
    return this.size * 0.35;
  }
  get maxDist() {
    return Math.max(4000, this.size * 80);
  }

  enter(o: SatObject, s: ObjectState, sunDir: THREE.Vector3, camera: THREE.PerspectiveCamera) {
    const model = modelFor(o.norad);
    if (!model) return false;
    if (this.model && this.model !== model) this.scene.remove(this.model.group);
    this.model = model;
    this.target = o;
    this.scene.add(model.group);
    this.frameAxes(s, sunDir);
    // Start from wherever the camera is now, expressed around the object.
    const off = camera.position.clone().sub(s.p).divideScalar(UNIT);
    const d = off.length();
    this.from.dist = d;
    this.from.az = Math.atan2(off.dot(this.Y), off.dot(this.X));
    this.from.el = Math.asin(THREE.MathUtils.clamp(-off.dot(this.Z) / d, -1, 1));
    this.from.look.set(0, 0, 0);
    this.from.up.copy(camera.up);
    this.az = this.from.az + 0.9;
    this.el = 0.32;
    // Fit the model in the narrower field of view (portrait phones are narrow).
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    const narrow = Math.min(Math.tan(half), Math.tan(half) * camera.aspect);
    this.dist = Math.max(model.size * 1.2, ((model.size * 0.55) / narrow) * 1.15);
    this.phase = 'in';
    this.t0 = performance.now();
    return true;
  }

  /** Fly back out; `to` is where the globe camera should end up; `done` runs on arrival. */
  exit(to: THREE.Vector3, done: () => void) {
    if (this.phase === 'off' || this.phase === 'out') return;
    this.from.az = this.az;
    this.from.el = this.el;
    this.from.dist = this.dist;
    this.outTo.copy(to);
    this.onExit = done;
    this.phase = 'out';
    this.t0 = performance.now();
  }

  /** Remove immediately (e.g. the object went away). */
  stop() {
    if (this.model) this.scene.remove(this.model.group);
    this.model = null;
    this.target = null;
    this.phase = 'off';
  }

  rotate(dx: number, dy: number) {
    if (this.phase !== 'on') return;
    this.az -= dx * 0.006;
    this.el = THREE.MathUtils.clamp(this.el + dy * 0.006, -1.45, 1.45);
  }

  /** Returns true when zoomed out past the limit (the caller then exits). */
  zoom(factor: number) {
    if (this.phase !== 'on') return false;
    const d = this.dist * factor;
    if (d > this.maxDist) return true;
    this.dist = Math.max(this.minDist, d);
    return false;
  }

  private frameAxes(s: ObjectState, sun: THREE.Vector3) {
    const up = this.pos.copy(s.p).normalize();
    if (this.model?.attitude === 'inertial') {
      // Point at a patch of sky well away from the Sun, arrays able to face it.
      this.X.crossVectors(sun, new THREE.Vector3(0, 1, 0)).normalize();
      if (!(this.X.lengthSq() > 0.5)) this.X.set(1, 0, 0);
      this.Y.crossVectors(this.X, sun).normalize();
      this.Z.crossVectors(this.X, this.Y);
    } else {
      // Local vertical / local horizontal: nose along the velocity, belly to Earth.
      this.Z.copy(up).negate();
      this.X.copy(s.v).addScaledVector(up, -s.v.dot(up)).normalize();
      this.Y.crossVectors(this.Z, this.X);
    }
  }

  /** Per frame: place the model and the camera. `sunDir` is a unit scene vector. */
  update(s: ObjectState, sunDir: THREE.Vector3, sunlit: boolean, dayside: number, camera: THREE.PerspectiveCamera) {
    const model = this.model;
    if (!model || this.phase === 'off') return;
    this.frameAxes(s, sunDir);
    this.basis.makeBasis(this.X, this.Y, this.Z);
    const g = model.group;
    g.position.copy(s.p);
    g.quaternion.setFromRotationMatrix(this.basis);
    g.scale.setScalar(UNIT);
    g.updateMatrixWorld(true);

    // Solar arrays turn about their axis to face the Sun.
    const inv = new THREE.Quaternion();
    for (const tr of model.trackers) {
      const parent = tr.obj.parent!;
      inv.copy(parent.getWorldQuaternion(new THREE.Quaternion())).invert();
      const sl = sunDir.clone().applyQuaternion(inv);
      tr.obj.rotation.y = Math.atan2(-sl.z, sl.x) - tr.normalAngle;
    }

    // Lighting: the Sun (unless in Earth's shadow) and blue light from Earth below.
    this.sunlit = sunlit;
    this.sun.intensity = sunlit ? 3.4 : 0;
    // A little fill in Earth's shadow, so the shape still reads.
    this.ambient.intensity = sunlit ? 0.07 : 0.16;
    this.sun.position.copy(sunDir);
    this.sun.target.position.set(0, 0, 0);
    const up = this.pos.copy(s.p).normalize();
    this.earthLight.position.copy(up).negate();
    this.earthLight.intensity = 0.06 + 0.9 * dayside;
    this.scene.environmentRotation.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up));
    this.scene.environmentIntensity = 0.12 + 0.45 * dayside;

    // Camera
    const now = performance.now();
    let az = this.az;
    let el = this.el;
    let dist = this.dist;
    const look = s.p.clone();
    const camUp = up.clone();
    if (this.phase === 'in') {
      const k = Math.min(1, (now - this.t0) / IN_MS);
      const e = smooth(k);
      // Distance shrinks geometrically; the view turns toward the object early on.
      dist = Math.exp(THREE.MathUtils.lerp(Math.log(this.from.dist), Math.log(this.dist), e));
      az = THREE.MathUtils.lerp(this.from.az, this.az, e);
      el = THREE.MathUtils.lerp(this.from.el, this.el, e);
      const turn = smooth(Math.min(1, k / 0.45));
      look.lerpVectors(this.from.look, s.p, turn);
      camUp.lerpVectors(this.from.up, up, turn).normalize();
      if (k >= 1) this.phase = 'on';
    }
    const offset = new THREE.Vector3()
      .addScaledVector(this.X, Math.cos(el) * Math.cos(az))
      .addScaledVector(this.Y, Math.cos(el) * Math.sin(az))
      .addScaledVector(this.Z, -Math.sin(el));
    camera.position.copy(s.p).addScaledVector(offset, dist * UNIT);
    if (this.phase === 'out') {
      const k = Math.min(1, (now - this.t0) / OUT_MS);
      const e = smooth(k);
      // From around the object to the globe camera's spot, looking back at Earth's centre.
      const near = camera.position.clone();
      const d0 = this.from.dist * UNIT;
      const d1 = this.outTo.distanceTo(s.p);
      const dir = new THREE.Vector3().lerpVectors(near.clone().sub(s.p).normalize(), this.outTo.clone().sub(s.p).normalize(), e).normalize();
      const d = Math.exp(THREE.MathUtils.lerp(Math.log(d0), Math.log(d1), e));
      camera.position.copy(s.p).addScaledVector(dir, d);
      look.lerpVectors(s.p, new THREE.Vector3(), smooth(Math.max(0, (k - 0.25) / 0.75)));
      camUp.lerpVectors(up, new THREE.Vector3(0, 1, 0), e).normalize();
      if (k >= 1) {
        camera.position.copy(this.outTo);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
        const done = this.onExit;
        this.stop();
        done?.();
        return;
      }
    }
    camera.up.copy(camUp);
    camera.lookAt(look);
    camera.updateMatrixWorld();

    // Model camera: same view, depth range in metres around the object.
    const cd = camera.position.distanceTo(s.p) / UNIT;
    this.camera.copy(camera);
    this.camera.near = Math.max(0.02, cd * 0.002) * UNIT;
    this.camera.far = (cd + model.size * 2) * UNIT;
    this.camera.updateProjectionMatrix();
    model.group.visible = cd < 200_000;
  }
}

/** A dim environment for reflections: black space above, Earth's blue glow below. */
function gradientEnvironment(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float y = normalize(vP).y;
          vec3 earth = mix(vec3(0.10, 0.22, 0.42), vec3(0.30, 0.45, 0.65), smoothstep(-1.0, -0.15, y));
          vec3 col = y < -0.12 ? earth : mix(vec3(0.35, 0.55, 0.9), vec3(0.0), smoothstep(-0.12, 0.08, y));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  scene.add(sphere);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  return rt.texture;
}

export const MODEL_UNIT = UNIT;
