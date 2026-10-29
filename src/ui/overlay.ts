import * as THREE from 'three';
import type { App } from '../app';
import { TYPE_LABEL, type SatObject } from '../data/catalog';
import { ownerName } from '../data/codes';
import { $, fmtKm, h } from './dom';

const PICK_RADIUS = 14; // CSS px

/** Screen-space picking, the selection reticle, hover tag and station labels. */
export function mountOverlay(app: App) {
  const overlay = $('#overlay');
  const tooltip = $('#tooltip');
  const canvas = app.stage.canvas;
  const camera = app.stage.camera;

  const reticle = h('div', { class: 'reticle' }, h('div', { class: 'ring' }), h('div', { class: 'tag' }));
  const hoverRet = h('div', { class: 'reticle hover' }, h('div', { class: 'ring' }));
  reticle.hidden = hoverRet.hidden = true;
  overlay.append(reticle, hoverRet);

  // Labels for crewed stations (plus anything in the stations group).
  const stationsIdx = app.cat.groups.findIndex((g) => g.key === 'stations');
  const labelled = app.cat.objects.filter((o) => (stationsIdx >= 0 && o.groups.includes(stationsIdx) && o.type === 'P') || [25544, 48274, 20580].includes(o.norad)).slice(0, 24);
  const labels = labelled.map((o) => {
    const el = h('div', { class: 'label' }, o.name.replace(/\s*\(.*\)$/, ''));
    el.hidden = true;
    overlay.append(el);
    return { o, el };
  });

  const v = new THREE.Vector3();
  const mvp = new THREE.Matrix4();
  const tmp = { x: 0, y: 0, z: 0 };

  function project(o: SatObject, t: number) {
    app.prop.position(o.idx, t, tmp);
    v.set(tmp.x, tmp.y, tmp.z).applyMatrix4(mvp);
    return v;
  }

  /** Is the scene point hidden behind Earth from the camera? */
  function occluded(px: number, py: number, pz: number) {
    const c = camera.position;
    const dx = px - c.x;
    const dy = py - c.y;
    const dz = pz - c.z;
    const len = Math.hypot(dx, dy, dz);
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    const b = c.x * ux + c.y * uy + c.z * uz;
    const cc = c.x * c.x + c.y * c.y + c.z * c.z - 1;
    const disc = b * b - cc;
    if (disc < 0) return false;
    const t0 = -b - Math.sqrt(disc);
    return t0 > 0 && t0 < len;
  }

  function pick(mx: number, my: number): SatObject | null {
    const t = app.clock.now();
    mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const e = mvp.elements;
    const { r, b, w, valid } = app.prop;
    const dt = t - app.prop.snapshotTime;
    let best = -1;
    let bestD = PICK_RADIUS * PICK_RADIUS;
    let bestZ = Infinity;
    const vis = app.visible;
    const all = app.visibleList.length === app.cat.objects.length;
    for (let i = 0; i < app.prop.count; i++) {
      if (!valid[i] || (!all && !vis[i]) || !app.launched(i)) continue;
      const k = i * 3;
      const a = w[i] * dt;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x = r[k] * ca + b[k] * sa;
      const y = r[k + 1] * ca + b[k + 1] * sa;
      const z = r[k + 2] * ca + b[k + 2] * sa;
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (cw <= 0) continue;
      const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw * 0.5 + 0.5) * W;
      const sy = (1 - ((e[1] * x + e[5] * y + e[9] * z + e[13]) / cw * 0.5 + 0.5)) * H;
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d > bestD + 9) continue;
      if (d < bestD - 9 || cw < bestZ) {
        if (occluded(x, y, z)) continue;
        best = i;
        bestD = Math.min(d, bestD);
        bestZ = cw;
      }
    }
    return best >= 0 ? app.cat.objects[best] : null;
  }

  // ---------- pointer ----------
  let mouse: { x: number; y: number } | null = null;
  let down: { x: number; y: number; t: number } | null = null;
  let pickDirty = false;
  canvas.addEventListener('pointermove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    pickDirty = true;
  });
  canvas.addEventListener('pointerleave', () => {
    mouse = null;
    app.setHover(null);
  });
  canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 400;
    down = null;
    if (moved > 5 || !quick) return;
    const hit = pick(e.clientX, e.clientY);
    if (hit) app.select(hit, { fly: false });
    else if (e.pointerType === 'mouse') app.select(null);
  });
  canvas.addEventListener('dblclick', () => {
    if (app.selected) app.flyTo(app.selected);
  });

  function showTooltip(o: SatObject | null) {
    if (!o || !mouse) {
      tooltip.hidden = true;
      return;
    }
    tooltip.hidden = false;
    tooltip.style.left = `${mouse.x}px`;
    tooltip.style.top = `${mouse.y}px`;
    const alt = (o.perigee + o.apogee) / 2;
    tooltip.replaceChildren(
      h('b', null, o.name),
      h('div', { class: 'tt-sub' }, `${o.norad} · ${TYPE_LABEL[o.type]} · ${o.regime}`),
      h('div', { class: 'tt-row' }, h('span', null, ownerName(o.owner)), h('span', null, `${fmtKm(alt)} km`)),
    );
  }

  function place(el: HTMLElement, o: SatObject, t: number, W: number, H: number) {
    const p = project(o, t);
    if (p.z > 1 || p.x < -1.2 || p.x > 1.2 || p.y < -1.2 || p.y > 1.2) {
      el.hidden = true;
      return false;
    }
    app.prop.position(o.idx, t, tmp);
    el.hidden = false;
    el.classList.toggle('behind', occluded(tmp.x, tmp.y, tmp.z));
    const sx = (p.x * 0.5 + 0.5) * W;
    const sy = (1 - (p.y * 0.5 + 0.5)) * H;
    el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    return true;
  }

  let lastTag = '';
  app.on('frame', () => {
    const t = app.clock.now();
    camera.updateMatrixWorld();
    mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;

    if (pickDirty && mouse && !down) {
      pickDirty = false;
      const hit = pick(mouse.x, mouse.y);
      app.setHover(hit);
      canvas.style.cursor = hit ? 'pointer' : '';
      showTooltip(hit && hit !== app.selected ? hit : null);
    } else if (!mouse) tooltip.hidden = true;

    const sel = app.selected;
    if (sel && app.prop.valid[sel.idx]) {
      place(reticle, sel, t, W, H);
      const tag = reticle.lastChild as HTMLElement;
      const st = app.selState;
      const alt = st ? Math.hypot(st.position.x, st.position.y, st.position.z) - 6371 : (sel.perigee + sel.apogee) / 2;
      const key = `${sel.idx}:${Math.round(alt)}`;
      if (key !== lastTag) {
        lastTag = key;
        tag.replaceChildren(sel.name, h('small', null, `${fmtKm(alt)} km`));
      }
    } else reticle.hidden = true;

    const hov = app.hovered;
    if (hov && hov !== sel && app.prop.valid[hov.idx]) place(hoverRet, hov, t, W, H);
    else hoverRet.hidden = true;

    const showLabels = app.settings.labels;
    for (const { o, el } of labels) {
      if (!showLabels || o === sel || !app.prop.valid[o.idx] || !app.launched(o.idx) || (!app.visible[o.idx] && app.visibleList.length !== app.cat.objects.length)) {
        el.hidden = true;
        continue;
      }
      if (place(el, o, t, W, H) && el.classList.contains('behind')) el.hidden = true;
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') app.select(null);
    if ((e.key === 'f' || e.key === 'F') && app.selected) app.setFollowing(!app.following);
  });
}
