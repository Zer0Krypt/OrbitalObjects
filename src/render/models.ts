import * as THREE from 'three';

/**
 * Procedural models of a few famous objects, built in metres in the
 * object's own frame: +X along the velocity (or the telescope's aperture),
 * +Y to starboard, +Z toward Earth (nadir). Solar arrays are tagged so they
 * can be turned toward the Sun.
 */

export interface SatModel {
  group: THREE.Group;
  /** Largest dimension (m), for framing the camera. */
  size: number;
  /**
   * Pivots that turn about their local Y axis to face the Sun; `normalAngle`
   * is the panels' normal direction in the pivot's X–Z plane, atan2(−z, x).
   */
  trackers: { obj: THREE.Object3D; normalAngle: number }[];
  /** Attitude: 'lvlh' flies nose-forward, belly down; 'inertial' holds a fixed sky direction. */
  attitude: 'lvlh' | 'inertial';
  facts: string;
}

// ---------- textures ----------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function cells(cell: string, line: string, cols: number, rows: number) {
  return canvasTex(256, 512, (g) => {
    g.fillStyle = line;
    g.fillRect(0, 0, 256, 512);
    const cw = 256 / cols;
    const ch = 512 / rows;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const v = 0.9 + Math.random() * 0.2;
        g.fillStyle = cell;
        g.globalAlpha = v;
        g.fillRect(i * cw + 1.5, j * ch + 1.5, cw - 3, ch - 3);
      }
    g.globalAlpha = 1;
  });
}

const lattice = () =>
  canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = '#fff';
    g.lineWidth = 9;
    g.strokeRect(4, 4, 120, 120);
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(4, 4);
    g.lineTo(124, 124);
    g.moveTo(124, 4);
    g.lineTo(4, 124);
    g.stroke();
  });

const blanket = () =>
  canvasTex(256, 256, (g) => {
    g.fillStyle = '#dcdad4';
    g.fillRect(0, 0, 256, 256);
    // Quilted multi-layer insulation: faint stitched patches.
    g.strokeStyle = 'rgba(120,118,110,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(0, (i * 256) / 6 + 8);
      g.lineTo(256, (i * 256) / 6 + 8);
      g.stroke();
    }
    for (let k = 0; k < 400; k++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 30, 4 + Math.random() * 10);
    }
  });

const foil = () =>
  canvasTex(256, 256, (g) => {
    g.fillStyle = '#c9ccd1';
    g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 60; k++) {
      const s = 160 + Math.random() * 70;
      g.fillStyle = `rgb(${s},${s + 2},${s + 6})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 30 + Math.random() * 60, 20 + Math.random() * 50);
    }
    g.strokeStyle = 'rgba(80,84,90,0.5)';
    g.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      g.beginPath();
      g.moveTo((i * 256) / 8, 0);
      g.lineTo((i * 256) / 8, 256);
      g.stroke();
    }
  });

/** Solar cells on the front, plain (Kapton or white) backing behind. */
interface ArrayMat {
  front: THREE.Material;
  back: THREE.Material;
}
function array(cellsTex: THREE.Texture, backColor: number): ArrayMat {
  return {
    front: new THREE.MeshStandardMaterial({ map: cellsTex, color: 0xffffff, roughness: 0.42, metalness: 0.25, side: THREE.FrontSide }),
    back: new THREE.MeshStandardMaterial({ color: backColor, roughness: 0.7, metalness: 0.05, side: THREE.BackSide }),
  };
}

let mats: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...o });
  const issCells = cells('#5a3d22', '#2a2119', 4, 16);
  const blueCells = cells('#1c2c5c', '#9aa4b8', 6, 14);
  const hstCells = cells('#2a2660', '#b9b2a0', 6, 10);
  return {
    white: std({ map: blanket(), color: 0xf2f0ea, roughness: 0.78, metalness: 0.02 }),
    grey: std({ color: 0xb8bcc2, roughness: 0.55, metalness: 0.35 }),
    dark: std({ color: 0x3b3f46, roughness: 0.6, metalness: 0.3 }),
    gold: std({ color: 0xd9a441, roughness: 0.32, metalness: 0.85 }),
    silver: std({ map: foil(), color: 0xffffff, roughness: 0.3, metalness: 0.75 }),
    radiator: std({ color: 0xf7f7f4, roughness: 0.4, metalness: 0.05 }),
    truss: std({ map: lattice(), alphaTest: 0.5, color: 0xc4c7cc, roughness: 0.5, metalness: 0.5 }),
    issArray: array(issCells, 0xc08a52),
    blueArray: array(blueCells, 0xd8d8d2),
    hstArray: array(hstCells, 0xcfd2d6),
    black: std({ color: 0x111214, roughness: 0.9, metalness: 0 }),
  };
}
const M = () => (mats ??= makeMaterials());

// ---------- primitives ----------
/** Cylinder along an axis ('x' | 'y' | 'z') from a to b (a < b); radius r at a, r2 at b. */
function cyl(axis: 'x' | 'y' | 'z', a: number, b: number, r: number, mat: THREE.Material, at: [number, number, number] = [0, 0, 0], r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, Math.abs(b - a), 40, 1);
  const m = new THREE.Mesh(g, mat);
  const mid = (a + b) / 2;
  if (axis === 'x') {
    m.rotation.z = -Math.PI / 2;
    m.position.set(mid, at[1], at[2]);
  } else if (axis === 'z') {
    m.rotation.x = Math.PI / 2;
    m.position.set(at[0], at[1], mid);
  } else m.position.set(at[0], mid, at[2]);
  return m;
}
function box(sx: number, sy: number, sz: number, mat: THREE.Material, at: [number, number, number], vRepeat = 1) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (vRepeat !== 1) {
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * vRepeat);
  }
  const m = new THREE.Mesh(g, mat);
  m.position.set(...at);
  return m;
}
function plate(w: number, h: number, mat: THREE.Material | ArrayMat, repeat: [number, number] = [1, 1]) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat[0], uv.getY(i) * repeat[1]);
  if (mat instanceof THREE.Material) return new THREE.Mesh(g, mat);
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, mat.front), new THREE.Mesh(g, mat.back));
  return grp;
}
function dish(r: number, mat: THREE.Material) {
  const g = new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, 0.7);
  return new THREE.Mesh(g, mat);
}

/**
 * A solar wing that turns about the local Y axis: two blankets either side
 * of it. 'across' blankets extend along ±Z with their width along Y (ISS);
 * 'along' blankets extend along ±Y with their width along X (Tianhe).
 * Either way they face ±X until turned.
 */
function wing(len: number, width: number, gap: number, mat: THREE.Material | ArrayMat, repeat: [number, number], mode: 'across' | 'along' = 'across') {
  const w = new THREE.Group();
  for (const s of [1, -1]) {
    const p = plate(width, len, mat, repeat);
    if (mode === 'across') {
      p.rotation.set(Math.PI / 2, 0, Math.PI / 2, 'ZYX');
      p.position.z = s * (gap + len / 2);
    } else {
      p.rotation.y = Math.PI / 2;
      p.position.y = s * (gap + len / 2);
    }
    w.add(p);
  }
  return w;
}

// ---------- ISS ----------
function buildISS(): SatModel {
  const m = M();
  const g = new THREE.Group();
  const trackers: SatModel['trackers'] = [];
  // Pressurised stack along X (forward = +X).
  g.add(
    cyl('x', 13, 20, 2.2, m.white), // Harmony
    cyl('x', 20, 22.5, 0.9, m.grey), // PMA-2 / docking adapter
    cyl('x', 4.5, 13, 2.15, m.white), // Destiny
    cyl('x', -1.5, 4.5, 2.3, m.white), // Unity
    cyl('x', -3, -1.5, 1.0, m.grey),
    cyl('x', -16, -3, 2.05, m.white), // Zarya
    cyl('x', -24, -16, 2.1, m.white), // Zvezda, large section
    cyl('x', -29, -24, 1.4, m.white), // Zvezda, small section
    cyl('y', 2.2, 9, 2.2, m.white, [17, 0, 0]), // Columbus
    cyl('y', -13.4, -2.2, 2.2, m.white, [17, 0, 0]), // Kibo
    box(5, 5.6, 1, m.grey, [17, -16.5, 0]), // Kibo exposed facility
    cyl('z', -6.4, -2.2, 2.1, m.white, [17, -7, 0]), // Kibo logistics module
    cyl('y', -9, -2.3, 2.2, m.white, [1.5, 0, 0]), // Tranquility
    cyl('z', 2.2, 3.6, 1.5, m.grey, [1.5, -6, 0], 1.0), // Cupola
    cyl('y', 2.3, 7, 2.0, m.white, [1.5, 0, 0]), // Quest
    cyl('z', 2.1, 15, 2.1, m.white, [-17, 0, 0]), // Nauka (nadir)
    cyl('z', 2.1, 8, 1.3, m.white, [-9, 0, 0]), // Rassvet
  );
  // Visiting vehicles: Crew Dragon forward, Progress aft, Soyuz below Rassvet.
  const dragon = new THREE.Group();
  dragon.add(cyl('x', 22.5, 26, 1.1, m.white, [0, 0, 0], 1.95), cyl('x', 26, 30.5, 1.95, m.dark));
  g.add(dragon);
  g.add(cyl('x', -36, -29, 1.35, m.white), cyl('z', 8, 15, 1.35, m.white, [-9, 0, 0]));
  for (const [x, z] of [[-33, 0], [-9, 12]] as const)
    for (const s of [1, -1]) {
      const p = box(0.1, 4.5, 1.2, m.blueArray.front, [x, s * 4, z]);
      g.add(p);
    }
  // Zvezda's own arrays.
  for (const s of [1, -1]) {
    const p = plate(3.2, 12, m.blueArray, [1, 3]);
    p.position.set(-22, s * 8.6, 0);
    p.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    g.add(p);
  }

  // Integrated truss along Y, over the lab (zenith side, −Z).
  const truss = new THREE.Group();
  const tz = -5.2;
  const tl = 109;
  truss.add(box(4.5, tl, 4.5, m.truss, [6, 0, tz], tl / 4.5));
  // Thermal radiators on S1/P1, edge-on to the Sun in practice; here pointing aft-down.
  for (const s of [1, -1])
    for (let k = 0; k < 3; k++) {
      const r = box(0.15, 3.2, 22, m.radiator, [6 - 2.5, s * (9 + k * 3.6), tz + 13]);
      r.rotation.x = s * 0.12;
      truss.add(r);
    }
  // Solar wings: two per photovoltaic module, four modules (P4, P6, S4, S6).
  for (const s of [1, -1])
    for (const y of [38, 51.5]) {
      const pivot = new THREE.Group();
      pivot.position.set(6, s * y, tz);
      const wg = wing(34, 11.5, 2.5, m.issArray, [1, 8]);
      pivot.add(wg, box(1.2, 1.2, 5, m.grey, [0, 0, 0]));
      truss.add(pivot);
      trackers.push({ obj: pivot, normalAngle: 0 });
      // Each module's own radiator, at right angles to the arrays.
      truss.add(box(0.15, 4, 13, m.radiator, [6 + 3, s * (y - 6.5), tz + 7]));
    }
  g.add(truss);
  return { group: g, size: 110, trackers, attitude: 'lvlh', facts: '109 m across the truss, about 420 t. Shown with a Crew Dragon, a Soyuz and a Progress docked.' };
}

// ---------- Hubble ----------
function buildHubble(): SatModel {
  const m = M();
  const g = new THREE.Group();
  const trackers: SatModel['trackers'] = [];
  // Aperture toward +X.
  g.add(
    cyl('x', -6.6, -3.2, 2.15, m.silver), // aft shroud
    cyl('x', -3.2, -1.6, 2.15, m.silver), // equipment section
    cyl('x', -1.6, 5.4, 1.55, m.silver), // optical telescope assembly / light shield
    cyl('x', 5.4, 5.8, 1.6, m.black), // baffle rim
    cyl('x', -6.75, -6.6, 1.9, m.dark),
  );
  // Open aperture door, hinged on the +Z side of the light shield.
  const hinge = new THREE.Group();
  hinge.position.set(5.85, 0, 1.6);
  hinge.rotation.y = -1.85;
  const door = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 40), m.silver);
  door.rotation.z = Math.PI / 2;
  door.position.z = -1.6;
  hinge.add(door);
  g.add(hinge);
  // Two rigid solar arrays on masts at ±Y, long axis along X.
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(-1.0, s * 2.15, 0);
    pivot.add(cyl('y', Math.min(0, s * 1.1), Math.max(0, s * 1.1), 0.1, m.grey));
    // Panel in the X–Y plane, long axis along the telescope.
    const p = plate(7.1, 2.6, m.hstArray, [1, 1]);
    p.position.set(0, s * 2.4, 0);
    const frame = box(7.2, 0.06, 0.06, m.grey, [0, s * 1.1, 0]);
    pivot.add(p, frame);
    g.add(pivot);
    trackers.push({ obj: pivot, normalAngle: -Math.PI / 2 });
  }
  // High-gain antennas on booms, above and below.
  for (const s of [1, -1]) {
    const boom = cyl('z', Math.min(s * 1.6, s * 5.0), Math.max(s * 1.6, s * 5.0), 0.07, m.grey, [1.5, 0, 0]);
    const d = dish(0.65, m.white);
    d.rotation.x = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    d.position.set(1.5, 0, s * 5.2);
    g.add(boom, d);
  }
  return { group: g, size: 14, trackers, attitude: 'inertial', facts: '13.2 m long, 11 t. Arrays and antennas as after the 2009 servicing mission.' };
}

// ---------- Tiangong ----------
function buildTiangong(): SatModel {
  const m = M();
  const g = new THREE.Group();
  const trackers: SatModel['trackers'] = [];
  g.add(
    cyl('x', -9, -3, 2.1, m.white), // Tianhe: life-support section
    cyl('x', -3, 4, 1.4, m.white), // Tianhe: small-diameter section
    cyl('x', -9.8, -9, 1.6, m.grey),
  );
  const node = new THREE.Mesh(new THREE.SphereGeometry(1.45, 32, 24), m.white);
  node.position.set(5.4, 0, 0);
  g.add(node);
  // Wentian (+Y) and Mengtian (−Y) laboratory modules form the T.
  for (const s of [1, -1]) {
    const span = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)] as const;
    g.add(cyl('y', ...span(s * 1.4, s * 3.2), 1.2, m.grey, [5.4, 0, 0]), cyl('y', ...span(s * 3.2, s * 19.5), 2.1, m.white, [5.4, 0, 0]));
    const pivot = new THREE.Group();
    pivot.position.set(5.4, s * 17.5, 0);
    // Large flexible arrays: two wings per lab, about 27 m each.
    pivot.add(wing(27, 4.2, 2.4, m.blueArray, [1, 6]));
    g.add(pivot);
    trackers.push({ obj: pivot, normalAngle: 0 });
  }
  // Tianhe's own arrays near the aft end, along ±Y.
  const tp = new THREE.Group();
  tp.position.set(-6.5, 0, 0);
  tp.add(wing(12, 3, 2.3, m.blueArray, [1, 3], 'along'));
  g.add(tp);
  trackers.push({ obj: tp, normalAngle: 0 });
  // Tianzhou cargo ship aft, Shenzhou below the node.
  g.add(cyl('x', -20, -9.8, 1.7, m.white));
  g.add(cyl('z', 1.45, 9.5, 1.4, m.white, [5.4, 0, 0], 1.1));
  for (const s of [1, -1]) {
    const p = plate(2.2, 6, m.blueArray, [1, 2]);
    p.position.set(-15, s * 5, 0);
    p.rotation.set(Math.PI / 2, 0, 0);
    const q = plate(1.6, 4, m.blueArray, [1, 1]);
    q.position.set(5.4, s * 3.4, 7);
    q.rotation.set(Math.PI / 2, 0, 0);
    g.add(p, q);
  }
  return { group: g, size: 55, trackers, attitude: 'lvlh', facts: 'T-shaped, about 55 m across the arrays and 100 t. Shown with a Tianzhou and a Shenzhou docked.' };
}

const BUILDERS: Record<number, { name: string; build: () => SatModel }> = {
  25544: { name: 'ISS', build: buildISS },
  20580: { name: 'Hubble', build: buildHubble },
  48274: { name: 'Tiangong', build: buildTiangong },
};

export const hasModel = (norad: number) => norad in BUILDERS;

const cache = new Map<number, SatModel>();
export function modelFor(norad: number): SatModel | null {
  const b = BUILDERS[norad];
  if (!b) return null;
  if (!cache.has(norad)) cache.set(norad, b.build());
  return cache.get(norad)!;
}
