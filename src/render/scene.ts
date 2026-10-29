import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  bloomEnabled = true;
  private resizeFns: ((w: number, h: number) => void)[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x010208, 1);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 4000);
    this.camera.position.set(2.2, 1.6, 3.4).multiplyScalar(1.05);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 1.18;
    this.controls.maxDistance = 60;
    this.controls.enablePan = false;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  onResize(fn: (w: number, h: number) => void) {
    this.resizeFns.push(fn);
    fn(window.innerWidth, window.innerHeight);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    if (this.camera.view) this.camera.setViewOffset(w, h, this.camera.view.offsetX, this.camera.view.offsetY, w, h);
    this.camera.updateProjectionMatrix();
    for (const fn of this.resizeFns) fn(w, h);
  }

  render() {
    if (this.bloomEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
