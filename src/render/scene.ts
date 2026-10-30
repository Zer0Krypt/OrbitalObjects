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
  /** A second scene drawn over the first with its own depth range (close-up models). */
  private overlay: { scene: THREE.Scene; camera: THREE.Camera; pass: RenderPass; enabled: boolean } | null = null;
  private resizeFns: ((w: number, h: number) => void)[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 1);
    this.scene.background = new THREE.Color(0x010208);

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

  /** Largest square-ish image the GPU can render in one pass. */
  get maxRenderSize() {
    return Math.min(this.renderer.capabilities.maxTextureSize, 8192);
  }

  /**
   * Render one frame at a given size (e.g. a poster) and return it as a 2D
   * canvas, then put the on-screen canvas back as it was. `prepare` runs once
   * the size is set, to scale point sizes and the like.
   */
  renderOffscreen(w: number, h: number, prepare?: () => void, restore?: () => void, shiftX = 0) {
    const pr = this.renderer.getPixelRatio();
    const view = this.camera.view ? { ...this.camera.view } : null;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(1);
    this.composer.setSize(w, h);
    for (const fn of this.resizeFns) fn(w, h);
    // Centred, whatever panels the screen view makes room for.
    this.camera.clearViewOffset();
    // shiftX moves the picture right by that share of the width (room for text on the left).
    if (shiftX) this.camera.setViewOffset(w, h, -shiftX * w, 0, w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    prepare?.();
    this.render();
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    restore?.();
    this.renderer.setPixelRatio(pr);
    if (view) this.camera.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
    this.resize();
    return out;
  }

  setOverlay(scene: THREE.Scene, camera: THREE.Camera) {
    const pass = new RenderPass(scene, camera);
    pass.clear = false;
    pass.clearDepth = true;
    pass.enabled = false;
    this.composer.insertPass(pass, 1);
    this.overlay = { scene, camera, pass, enabled: false };
  }

  setOverlayEnabled(on: boolean) {
    if (!this.overlay) return;
    this.overlay.enabled = on;
    this.overlay.pass.enabled = on;
  }

  render() {
    if (this.bloomEnabled) this.composer.render();
    else {
      this.renderer.render(this.scene, this.camera);
      const o = this.overlay;
      if (o?.enabled) {
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(o.scene, o.camera);
        this.renderer.autoClear = true;
      }
    }
  }
}
