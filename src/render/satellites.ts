import * as THREE from 'three';
import type { Propagator } from '../sim/propagator';

const vert = /* glsl */ `
attribute vec3 aB;
attribute float aW;
attribute vec3 aColor;
attribute float aVis;
uniform float uDt;
uniform float uScale;
uniform float uSize;
uniform float uHover;
uniform float uSelected;
uniform float uMinSize;
uniform float uBoost;
varying vec3 vColor;
varying float vAlpha;
varying float vHot;
void main() {
  float a = aW * uDt;
  vec3 p = position * cos(a) + aB * sin(a);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float id = float(gl_VertexID);
  float hot = (abs(id - uHover) < 0.5 || abs(id - uSelected) < 0.5) ? 1.0 : 0.0;
  vHot = hot;
  float dist = -mv.z;
  float s = uSize * uScale / dist;
  // aVis > 1 marks a freshly launched object (history playback): flare it.
  float fresh = clamp(aVis - 1.0, 0.0, 1.6);
  gl_PointSize = clamp(s, uMinSize, 7.0) * (1.0 + hot * 1.6 + fresh * 1.1) * step(0.001, aVis) * uBoost;
  // Ghosts (filtered-out) stay small.
  if (aVis < 0.5) gl_PointSize = min(gl_PointSize, 2.0 * uBoost);
  // Farther points get slightly dimmer; filtered-out ones fade to a ghost.
  vAlpha = aVis * clamp(1.4 - dist * 0.05, 0.55, 1.0);
  vColor = aColor;
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

export class SatellitePoints {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private geom: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private bAttr: THREE.BufferAttribute;
  private wAttr: THREE.BufferAttribute;
  readonly colorAttr: THREE.BufferAttribute;
  readonly visAttr: THREE.BufferAttribute;

  constructor(private prop: Propagator) {
    const n = prop.count;
    this.geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(prop.r, 3).setUsage(THREE.DynamicDrawUsage);
    this.bAttr = new THREE.BufferAttribute(prop.b, 3).setUsage(THREE.DynamicDrawUsage);
    this.wAttr = new THREE.BufferAttribute(prop.w, 1).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.visAttr = new THREE.BufferAttribute(new Float32Array(n).fill(1), 1);
    this.geom.setAttribute('position', this.posAttr);
    this.geom.setAttribute('aB', this.bAttr);
    this.geom.setAttribute('aW', this.wAttr);
    this.geom.setAttribute('aColor', this.colorAttr);
    this.geom.setAttribute('aVis', this.visAttr);
    this.geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uDt: { value: 0 },
        uScale: { value: 1 },
        uSize: { value: 9 },
        uHover: { value: -1 },
        uSelected: { value: -1 },
        uMinSize: { value: 1.6 },
        // Scales every point, e.g. for a high-resolution poster.
        uBoost: { value: 1 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geom, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;

    prop.onUpdate(() => {
      this.posAttr.needsUpdate = true;
      this.bAttr.needsUpdate = true;
      this.wAttr.needsUpdate = true;
    });
  }

  update(simTime: number, viewportHeight: number, pixelRatio: number) {
    const u = this.material.uniforms;
    u.uDt.value = simTime - this.prop.snapshotTime;
    u.uScale.value = (viewportHeight * pixelRatio) / 900;
  }

  setHover(i: number | null) {
    this.material.uniforms.uHover.value = i ?? -1;
  }

  setSelected(i: number | null) {
    this.material.uniforms.uSelected.value = i ?? -1;
  }

  setColors(colors: Float32Array) {
    (this.colorAttr.array as Float32Array).set(colors);
    this.colorAttr.needsUpdate = true;
  }

  /** Small filtered sets get larger points so they stay findable. */
  setEmphasis(visibleCount: number) {
    this.material.uniforms.uMinSize.value = visibleCount < 300 ? 4 : visibleCount < 3000 ? 2.6 : 1.6;
  }

  setVisibility(vis: Float32Array) {
    (this.visAttr.array as Float32Array).set(vis);
    this.visAttr.needsUpdate = true;
  }
}
