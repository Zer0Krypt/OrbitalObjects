import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { satrecFor, stateAt } from '../render/orbits';
import { fmt, fmtUtc, h, icon, ICONS } from './dom';

/**
 * Close-approach geometry: the encounter seen from the first object, in its
 * radial / in-track / cross-track frame, with the second object's path past
 * it and rough uncertainty ellipsoids grown from each element set's age.
 */

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const vec = (p: { x: number; y: number; z: number }): V => [p.x, p.y, p.z];

/** Radial, in-track, cross-track unit vectors from a position and velocity. */
function ric(r: V, v: V) {
  const R = norm(r);
  const C = norm(cross(r, v));
  return { R, I: cross(C, R), C };
}

/** Rough 1σ position uncertainty (km) for public elements of a given age (days). */
export function sigmaFor(ageDays: number) {
  const d = Math.min(Math.abs(ageDays), 14);
  return { R: 0.1 + 0.08 * d, I: 0.3 + 1.0 * d, C: 0.1 + 0.08 * d };
}

export interface EncounterGeometry {
  tca: number;
  missKm: number;
  relSpeed: number;
  /** Angle between the two velocity vectors, degrees. */
  angle: number;
  /** Miss vector at TCA in the first object's frame (km): radial, in-track, cross-track. */
  miss: V;
  window: number;
  path: V[];
  times: number[];
  sigA: ReturnType<typeof sigmaFor>;
  sigB: ReturnType<typeof sigmaFor>;
  /** The second object's R, I, C axes in the first object's frame. */
  axesB: { R: V; I: V; C: V };
}

export function encounterGeometry(a: SatObject, b: SatObject, guess: number): EncounterGeometry | null {
  const ra = satrecFor(a);
  const rb = satrecFor(b);
  if (!ra || !rb) return null;
  const dist = (t: number) => {
    const sa = stateAt(ra, t);
    const sb = stateAt(rb, t);
    return sa && sb ? Math.hypot(...sub(vec(sb.position), vec(sa.position))) : Infinity;
  };
  // Coarse search ±15 min, then golden-section to the millisecond.
  let best = guess;
  let bd = Infinity;
  for (let t = guess - 15 * 60e3; t <= guess + 15 * 60e3; t += 5e3) {
    const d = dist(t);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  let lo = best - 5e3;
  let hi = best + 5e3;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 40 && hi - lo > 1; k++) {
    const m1 = hi - g * (hi - lo);
    const m2 = lo + g * (hi - lo);
    if (dist(m1) < dist(m2)) hi = m2;
    else lo = m1;
  }
  const tca = (lo + hi) / 2;
  const sa = stateAt(ra, tca);
  const sb = stateAt(rb, tca);
  if (!sa || !sb) return null;
  const A = ric(vec(sa.position), vec(sa.velocity));
  const toA = (p: V): V => [dot(p, A.R), dot(p, A.I), dot(p, A.C)];
  const vRel = sub(vec(sb.velocity), vec(sa.velocity));
  const relSpeed = Math.hypot(...vRel);
  const miss = toA(sub(vec(sb.position), vec(sa.position)));
  const missKm = Math.hypot(...miss);
  const sigA = sigmaFor((tca - a.epochMs) / 86400e3);
  const sigB = sigmaFor((tca - b.epochMs) / 86400e3);
  // Long enough for the path to cross the picture (seconds either side).
  const window = Math.min(120, Math.max(0.5, (4 * Math.max(missKm, sigA.I, sigB.I, 0.5)) / Math.max(relSpeed, 0.01)));
  const path: V[] = [];
  const times: number[] = [];
  for (let i = 0; i <= 240; i++) {
    const t = tca + ((i / 240) * 2 - 1) * window * 1000;
    const pa = stateAt(ra, t);
    const pb = stateAt(rb, t);
    if (!pa || !pb) continue;
    // Relative to A, in A's frame at that moment.
    const Ai = ric(vec(pa.position), vec(pa.velocity));
    const d = sub(vec(pb.position), vec(pa.position));
    path.push([dot(d, Ai.R), dot(d, Ai.I), dot(d, Ai.C)]);
    times.push(t);
  }
  const B = ric(vec(sb.position), vec(sb.velocity));
  const cosAng = dot(norm(vec(sa.velocity)), norm(vec(sb.velocity)));
  return {
    tca,
    missKm,
    relSpeed,
    angle: (Math.acos(Math.max(-1, Math.min(1, cosAng))) * 180) / Math.PI,
    miss,
    window,
    path,
    times,
    sigA,
    sigB,
    axesB: { R: toA(B.R), I: toA(B.I), C: toA(B.C) },
  };
}

// RIC -> three.js: in-track along +x, radial up (+y), cross-track toward the viewer (+z).
const toThree = (p: V) => new THREE.Vector3(p[1], p[0], p[2]);

export function mountConjunction(app: App) {
  const canvas = h('canvas', { class: 'cj-canvas', 'aria-label': 'The encounter in 3D: drag to turn, scroll to zoom' });
  const labels = h('div', { class: 'cj-labels' });
  const title = h('h3');
  const sub2 = h('p', { class: 'cj-sub' });
  const stats = h('div', { class: 'cj-stats' });
  const slider = h('input', { type: 'range', min: -1000, max: 1000, value: 0, step: 1, 'aria-label': 'Time around closest approach' });
  const tLabel = h('span', { class: 'mono' });
  const play = h('button', { class: 'btn' }, 'Play');
  const panel = h(
    'div',
    { class: 'modal cj-modal', hidden: true, role: 'dialog', 'aria-label': 'Close approach geometry' },
    h(
      'div',
      { class: 'cj-card' },
      h('button', { class: 'icon-btn close', 'aria-label': 'Close', onclick: () => close() }, icon(ICONS.close)),
      h('div', { class: 'eyebrow' }, 'Close approach geometry'),
      title,
      sub2,
      stats,
      h('div', { class: 'cj-view' }, canvas, labels),
      h('div', { class: 'cj-time' }, play, slider, tLabel),
      h(
        'p',
        { class: 'cj-foot' },
        'Seen from the first object: up is away from Earth (radial), right is its direction of travel (in-track), toward you is cross-track. Ellipsoids show a rough 1σ position uncertainty that grows with each element set’s age; operators use far better data to decide whether to manoeuvre.',
      ),
    ),
  );
  document.getElementById('app')!.append(panel);

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let geo: EncounterGeometry | null = null;
  let markerB: THREE.Mesh;
  let ellB: THREE.Mesh;
  let raf = 0;
  let playing = false;
  const axisLabels: { el: HTMLElement; p: THREE.Vector3 }[] = [];

  function ellipsoid(sig: { R: number; I: number; C: number }, color: number) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, shininess: 40, emissive: color, emissiveIntensity: 0.25 }),
    );
    m.scale.set(sig.I, sig.R, sig.C);
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 16, 8), 1), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 }));
    m.add(wire);
    return m;
  }

  function build(a: SatObject, b: SatObject) {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1e5);
      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
    }
    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 3, 4);
    scene.add(sun);
    const g = geo!;
    const colA = new THREE.Color(app.colorsHex[a.idx] ?? '#3987e5');
    const colB = new THREE.Color(app.colorsHex[b.idx] ?? '#d95926');
    if (colA.equals(colB)) colB.set('#ff8a7a');
    const ext = Math.max(g.missKm * 1.6, g.sigA.I * 2.2, g.sigB.I * 2.2, 0.6);
    // Object A at the centre with its ellipsoid.
    scene.add(ellipsoid(g.sigA, colA.getHex()));
    const dotR = ext * 0.018;
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(dotR, 20, 12), new THREE.MeshBasicMaterial({ color: colA })));
    // B's path, its ellipsoid at TCA (in its own orientation), and a moving marker.
    const pts = g.path.map(toThree);
    const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: colB, transparent: true, opacity: 0.9 }));
    scene.add(path);
    ellB = ellipsoid(g.sigB, colB.getHex());
    const basis = new THREE.Matrix4().makeBasis(toThree(g.axesB.I), toThree(g.axesB.R), toThree(g.axesB.C));
    ellB.quaternion.setFromRotationMatrix(basis);
    ellB.position.copy(toThree(g.miss));
    scene.add(ellB);
    markerB = new THREE.Mesh(new THREE.SphereGeometry(dotR, 20, 12), new THREE.MeshBasicMaterial({ color: colB }));
    scene.add(markerB);
    // Miss vector at closest approach.
    const mv = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), toThree(g.miss)]),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: ext * 0.04, gapSize: ext * 0.03, transparent: true, opacity: 0.7 }),
    );
    mv.computeLineDistances();
    scene.add(mv);
    // Axes and a faint grid in the in-track / cross-track plane.
    const L = ext * 1.1;
    const axes: [V, string, number][] = [
      [[0, 1, 0], 'In-track', 0x7cc4ff],
      [[1, 0, 0], 'Radial (up)', 0x9fe89f],
      [[0, 0, 1], 'Cross-track', 0xffd27a],
    ];
    labels.replaceChildren();
    axisLabels.length = 0;
    for (const [d, name, c] of axes) {
      const dir = toThree(d);
      scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), L, c, L * 0.06, L * 0.03));
      const el = h('span', { style: `color:#${c.toString(16).padStart(6, '0')}` }, name);
      labels.append(el);
      axisLabels.push({ el, p: dir.clone().multiplyScalar(L * 1.08) });
    }
    for (const [o, p, cls] of [
      [a, new THREE.Vector3(), 'a'],
      [b, toThree(g.miss), 'b'],
    ] as [SatObject, THREE.Vector3, string][]) {
      const el = h('span', { class: `cj-obj ${cls}` }, o.name);
      labels.append(el);
      axisLabels.push({ el, p });
    }
    const grid = new THREE.GridHelper(L * 2, 10, 0x334155, 0x1e293b);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.y = -L * 0.6;
    scene.add(grid);
    camera.position.set(ext * 2.0, ext * 1.3, ext * 3.1);
    camera.near = ext / 500;
    camera.far = ext * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, L * 0.15, 0);
    controls.update();
  }

  function setTime(f: number) {
    const g = geo;
    if (!g || !g.path.length) return;
    const i = Math.round(((f + 1) / 2) * (g.path.length - 1));
    markerB.position.copy(toThree(g.path[i]));
    const dt = (g.times[i] - g.tca) / 1000;
    const d = Math.hypot(...g.path[i]);
    tLabel.textContent = `${dt >= 0 ? '+' : '−'}${fmt(Math.abs(dt), Math.abs(dt) < 10 ? 2 : 1)} s · ${d < 10 ? fmt(d, 3) : fmt(d, 1)} km`;
  }

  function loop() {
    if (panel.hidden || !renderer) return;
    raf = requestAnimationFrame(loop);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * renderer.getPixelRatio()) || canvas.height !== Math.round(H * renderer.getPixelRatio())) {
      renderer.setSize(W, H, false);
      camera.aspect = W / Math.max(1, H);
      camera.updateProjectionMatrix();
    }
    if (playing) {
      let v = Number(slider.value) + 8;
      if (v > 1000) v = -1000;
      slider.value = String(v);
      setTime(v / 1000);
    }
    controls.update();
    renderer.render(scene, camera);
    const p = new THREE.Vector3();
    for (const l of axisLabels) {
      p.copy(l.p).project(camera);
      l.el.style.transform = `translate(${((p.x * 0.5 + 0.5) * W).toFixed(0)}px, ${((1 - (p.y * 0.5 + 0.5)) * H).toFixed(0)}px)`;
      l.el.hidden = p.z > 1;
    }
  }

  function close() {
    panel.hidden = true;
    playing = false;
    cancelAnimationFrame(raf);
  }

  function open(a: SatObject, b: SatObject, guess: number, published?: number) {
    geo = encounterGeometry(a, b, guess);
    panel.hidden = false;
    if (!geo) {
      title.textContent = `${a.name} × ${b.name}`;
      sub2.textContent = 'The geometry could not be computed from these element sets.';
      return;
    }
    const g = geo;
    title.textContent = `${a.name} × ${b.name}`;
    const differs = published !== undefined && Math.abs(g.missKm - published) > Math.max(5, published * 3);
    sub2.textContent = `Closest approach ${fmtUtc(g.tca, true)} UTC, computed here from the public element sets.${
      differs ? ` The published prediction was ${published! < 1 ? `${Math.round(published! * 1000)} m` : `${fmt(published!, 2)} km`}; the orbits have been updated since, so the two disagree.` : ''
    }`;
    const ageA = (g.tca - a.epochMs) / 86400e3;
    const ageB = (g.tca - b.epochMs) / 86400e3;
    stats.replaceChildren(
      ...([
        ['Miss distance', g.missKm < 1 ? `${Math.round(g.missKm * 1000)} m` : `${fmt(g.missKm, 2)} km`],
        ['Relative speed', `${fmt(g.relSpeed, 2)} km/s`],
        ['Crossing angle', `${Math.round(g.angle)}°`],
        ['Radial · in-track · cross', g.miss.map((x) => fmt(x, 2)).join(' · ') + ' km'],
        ['Element age at TCA', `${fmt(Math.abs(ageA), 1)} d · ${fmt(Math.abs(ageB), 1)} d`],
      ] as [string, string][]).map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v))),
    );
    build(a, b);
    slider.value = '0';
    setTime(0);
    cancelAnimationFrame(raf);
    loop();
  }

  slider.addEventListener('input', () => {
    playing = false;
    play.textContent = 'Play';
    setTime(Number(slider.value) / 1000);
  });
  play.onclick = () => {
    playing = !playing;
    play.textContent = playing ? 'Pause' : 'Play';
  };
  panel.addEventListener('pointerdown', (e) => e.target === panel && close());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) close();
  });
  app.openConjunction = (a, b, tca, published) => open(a, b, tca, published);
}
