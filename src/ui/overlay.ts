import * as THREE from 'three';
import type { App } from '../app';
import { TYPE_LABEL, type SatObject } from '../data/catalog';
import { ownerName } from '../data/codes';
import { $, fmtKm, h } from './dom';
import { latLonToScene } from '../sim/astro';

const fmtCountdownShort = (ms: number) => {
  if (ms < 0) return 'launched';
  const h = ms / 3600e3;
  if (h < 1) return `in ${Math.ceil(ms / 60e3)} min`;
  if (h < 48) return `in ${Math.floor(h)} h ${Math.floor((ms % 3600e3) / 60e3)} m`;
  return `in ${Math.round(h / 24)} d`;
};

const fmtShort = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 120) return `${s} s`;
  if (s < 7200) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${(s / 3600).toFixed(1)} h`;
};

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

  // Observer pin and the "pick on globe" hint.
  const you = h('div', { class: 'you-pin' }, h('i'), h('span', null, 'You'));
  you.hidden = true;
  overlay.append(you);
  // Predicted re-entry location (TIP) for the selected object.
  const tipPin = h('div', { class: 'tip-pin' }, h('i'), h('span', null, 'Predicted re-entry'));
  tipPin.hidden = true;
  overlay.append(tipPin);
  const tipPos = new THREE.Vector3();

  // Encounter: second reticle on the other object and a distance label.
  const pairRet = h('div', { class: 'reticle pair' }, h('div', { class: 'ring' }), h('div', { class: 'tag' }));
  pairRet.hidden = true;
  const pairDist = h('b');
  const pairName = h('span');
  const pairLabel = h(
    'div',
    { class: 'pair-label' },
    pairName,
    pairDist,
    h(
      'button',
      {
        class: 'pair-geo',
        title: 'The encounter in 3D, with uncertainty ellipsoids',
        onclick: () => {
          const p = app.pair;
          if (p) app.openConjunction(p.a, p.b, p.tca ?? app.clock.now(), p.missKm);
        },
      },
      'Geometry ›',
    ),
    h('button', { class: 'pair-close', 'aria-label': 'Close encounter', onclick: () => app.setPair(null) }, '×'),
  );
  pairLabel.hidden = true;
  overlay.append(pairRet);
  document.getElementById('app')!.append(pairLabel);
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  let pairTag = '';

  // Upcoming launch pads (next 14 days, soonest launch per pad).
  type Pin = { el: HTMLElement; cd: HTMLElement; lat: number; lon: number; net: number };
  let pins: Pin[] = [];
  const padPos = new THREE.Vector3();
  function buildPins() {
    for (const p of pins) p.el.remove();
    pins = [];
    const soon = (app.launches?.upcoming ?? []).filter((l) => l.lat !== null && l.lon !== null && l.netMs > Date.now() - 3600e3 && l.netMs < Date.now() + 14 * 86400e3).sort((a, b) => a.netMs - b.netMs);
    // Pads within ~50 km (e.g. Cape Canaveral and Kennedy) share one pin.
    const groups: (typeof soon)[] = [];
    for (const l of soon) {
      const g = groups.find((x) => Math.abs(x[0].lat! - l.lat!) < 0.5 && Math.abs(x[0].lon! - l.lon!) < 0.5);
      if (g) g.push(l);
      else groups.push([l]);
    }
    for (const g of groups) {
      const l = g[0];
      const cd = h('small');
      const el = h(
        'button',
        { class: 'launch-pin', title: g.map((x) => `${x.name} — ${x.location ?? ''}`).join('\n'), onclick: () => app.openWatch('launches', l.id) },
        h('i'),
        h('span', null, h('b', null, (l.rocket ?? l.name).replace(/ Block \d+$/, ''), g.length > 1 ? ` +${g.length - 1}` : ''), cd),
      );
      el.hidden = true;
      overlay.append(el);
      pins.push({ el, cd, lat: l.lat!, lon: l.lon!, net: l.netMs });
    }
  }
  app.on('watch', buildPins);
  let lastPinText = 0;
  const pickHint = h('div', { class: 'pick-hint', hidden: true }, 'Click anywhere on Earth to set your location', h('kbd', null, 'Esc'), 'to cancel');
  document.getElementById('app')!.append(pickHint);
  app.on('observer', () => {
    pickHint.hidden = !app.pickingLocation;
    canvas.classList.toggle('picking', app.pickingLocation);
  });

  const raycaster = new THREE.Raycaster();
  const earthSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  /** Geodetic-ish lat/lon under the cursor, or null off the globe. */
  function latLonAt(mx: number, my: number) {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((mx - r.left) / r.width) * 2 - 1, -((my - r.top) / r.height) * 2 + 1), camera);
    const p = raycaster.ray.intersectSphere(earthSphere, new THREE.Vector3());
    if (!p) return null;
    // Undo Earth's rotation to get Earth-fixed coordinates.
    p.applyAxisAngle(new THREE.Vector3(0, 1, 0), -app.earth.group.rotation.y);
    const geocentric = Math.asin(p.y);
    // Geocentric -> geodetic latitude (WGS-84).
    const lat = (Math.atan(Math.tan(geocentric) / (1 - 0.00669437999014)) * 180) / Math.PI;
    const lon = (Math.atan2(-p.z, p.x) * 180) / Math.PI;
    return { lat, lon };
  }

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

  const pos3 = new THREE.Vector3();
  function project(o: SatObject, t: number) {
    app.scenePosition(o, pos3, t);
    tmp.x = pos3.x;
    tmp.y = pos3.y;
    tmp.z = pos3.z;
    v.copy(pos3).applyMatrix4(mvp);
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
    const all = app.visibleList.length === app.universe.length;
    const consider = (i: number, x: number, y: number, z: number) => {
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (cw <= 0) return;
      const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw * 0.5 + 0.5) * W;
      const sy = (1 - ((e[1] * x + e[5] * y + e[9] * z + e[13]) / cw * 0.5 + 0.5)) * H;
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d > bestD + 9) return;
      if (d < bestD - 9 || cw < bestZ) {
        if (occluded(x, y, z)) return;
        best = i;
        bestD = Math.min(d, bestD);
        bestZ = cw;
      }
    };
    // History mode: everything in orbit at the history date, on the orbit layer.
    const layer = app.historyLayer;
    if (layer && app.history && app.keplerMode) {
      const p = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < layer.objects.length; i++) {
        if ((!all && !vis[i]) || app.gated(i) || !layer.aliveAt(i, app.history.cutoff)) continue;
        layer.positionAt(i, t, p);
        consider(i, p.x, p.y, p.z);
      }
      return best >= 0 ? app.cat.objects[best] : null;
    }
    for (let i = 0; i < app.prop.count; i++) {
      if (!valid[i] || (!all && !vis[i]) || !app.launched(i)) continue;
      const k = i * 3;
      const a = w[i] * dt;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x = r[k] * ca + b[k] * sa;
      const y = r[k + 1] * ca + b[k + 1] * sa;
      const z = r[k + 2] * ca + b[k + 2] * sa;
      consider(i, x, y, z);
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
    // The close-up view handles its own drags; clicks don't pick through the model.
    if (app.closeup.active) {
      down = null;
      return;
    }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 400;
    down = null;
    if (moved > 5 || !quick) return;
    if (app.pickingLocation) {
      const ll = latLonAt(e.clientX, e.clientY);
      if (ll) {
        const first = !app.observer;
        app.setObserver({ lat: ll.lat, lon: ll.lon, alt: 0, source: 'globe' });
        if (first && app.filters.sky === 'off') app.setFilters({ sky: 'above' });
      }
      return;
    }
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

    if (pickDirty && mouse && !down && app.pickingLocation) {
      pickDirty = false;
      app.setHover(null);
      const ll = latLonAt(mouse.x, mouse.y);
      tooltip.hidden = !ll;
      if (ll) {
        tooltip.style.left = `${mouse.x}px`;
        tooltip.style.top = `${mouse.y}px`;
        tooltip.replaceChildren(h('b', null, `${Math.abs(ll.lat).toFixed(3)}° ${ll.lat >= 0 ? 'N' : 'S'}, ${Math.abs(ll.lon).toFixed(3)}° ${ll.lon >= 0 ? 'E' : 'W'}`), h('div', { class: 'tt-sub' }, 'Click to set your location'));
      }
    } else if (pickDirty && mouse && !down) {
      pickDirty = false;
      const hit = pick(mouse.x, mouse.y);
      app.setHover(hit);
      canvas.style.cursor = hit ? 'pointer' : '';
      showTooltip(hit && hit !== app.selected ? hit : null);
    } else if (!mouse) tooltip.hidden = true;

    const sel = app.selected;
    if (sel && app.hasPosition(sel) && !app.closeup.active) {
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

    // Observer pin
    const f = app.skyView.active ? null : app.observerFrameAt(t);
    if (f) {
      v.set(f.p[0], f.p[1], f.p[2]).applyMatrix4(mvp);
      // Hidden when the pin faces away from the camera.
      const c = camera.position;
      const facing = (c.x - f.p[0]) * f.up[0] + (c.y - f.p[1]) * f.up[1] + (c.z - f.p[2]) * f.up[2] > 0;
      you.hidden = v.z > 1 || !facing;
      if (!you.hidden) you.style.transform = `translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((1 - (v.y * 0.5 + 0.5)) * H).toFixed(1)}px)`;
    } else you.hidden = true;

    const pair = app.pair;
    if (pair && app.hasPosition(pair.a) && app.hasPosition(pair.b)) {
      const other = sel === pair.b ? pair.a : pair.b;
      place(pairRet, other, t, W, H);
      if (pairTag !== other.name) {
        pairTag = other.name;
        (pairRet.lastChild as HTMLElement).replaceChildren(other.name);
      }
      app.scenePosition(pair.a, pa, t);
      app.scenePosition(pair.b, pb, t);
      const km = pa.distanceTo(pb) * 6371;
      v.copy(pa).add(pb).multiplyScalar(0.5).applyMatrix4(mvp);
      pairLabel.hidden = v.z > 1;
      pairLabel.style.transform = `translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((1 - (v.y * 0.5 + 0.5)) * H).toFixed(1)}px)`;
      pairName.textContent = pair.label;
      // Current elements only describe encounters within a few days of now.
      (pairLabel.querySelector('.pair-geo') as HTMLElement).hidden = !!app.history || pair.tca === undefined || Math.abs(pair.tca - Date.now()) > 10 * 86400e3;
      const dt = pair.tca !== undefined ? pair.tca - (app.history ? app.history.cutoff : t) : null;
      pairDist.textContent = `${km < 10 ? km.toFixed(2) : km < 1000 ? km.toFixed(1) : fmtKm(km)} km${dt !== null && Math.abs(dt) < 86400e3 ? ` · ${dt >= 0 ? 'TCA in' : 'TCA'} ${fmtShort(Math.abs(dt))}${dt < 0 ? ' ago' : ''}` : ''}`;
    } else {
      pairRet.hidden = true;
      pairLabel.hidden = true;
    }

    // Pins only make sense near the globe (not in the zoomed-out cislunar view).
    const showPins = app.settings.launchSites && !app.history && !app.skyView.active && camera.position.length() < 20;
    const refreshText = performance.now() - lastPinText > 1000;
    if (refreshText) lastPinText = performance.now();
    for (const p of pins) {
      if (!showPins) {
        p.el.hidden = true;
        continue;
      }
      latLonToScene(p.lat, p.lon, 1.002, padPos).applyAxisAngle(new THREE.Vector3(0, 1, 0), app.earth.group.rotation.y);
      const facing = padPos.dot(camera.position.clone().sub(padPos)) > 0;
      v.copy(padPos).applyMatrix4(mvp);
      p.el.hidden = !facing || v.z > 1;
      if (p.el.hidden) continue;
      p.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((1 - (v.y * 0.5 + 0.5)) * H).toFixed(1)}px)`;
      if (refreshText) p.cd.textContent = fmtCountdownShort(p.net - Date.now());
    }

    const tip = sel ? app.reentryByNorad.get(sel.norad)?.tip : null;
    if (tip && tip.lat != null && tip.lon != null && !app.skyView.active) {
      latLonToScene(tip.lat, tip.lon, 1.003, tipPos).applyAxisAngle(new THREE.Vector3(0, 1, 0), app.earth.group.rotation.y);
      const facing = tipPos.dot(camera.position.clone().sub(tipPos)) > 0;
      v.copy(tipPos).applyMatrix4(mvp);
      tipPin.hidden = !facing || v.z > 1;
      if (!tipPin.hidden) tipPin.style.transform = `translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((1 - (v.y * 0.5 + 0.5)) * H).toFixed(1)}px)`;
    } else tipPin.hidden = true;

    const hov = app.hovered;
    if (hov && hov !== sel && app.hasPosition(hov)) place(hoverRet, hov, t, W, H);
    else hoverRet.hidden = true;

    // The sky view labels objects itself.
    const showLabels = app.settings.labels && !app.skyView.active;
    for (const { o, el } of labels) {
      if (!showLabels || o === sel || !app.hasPosition(o) || (!app.visible[o.idx] && app.visibleList.length !== app.universe.length)) {
        el.hidden = true;
        continue;
      }
      if (place(el, o, t, W, H) && el.classList.contains('behind')) el.hidden = true;
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') {
      if (app.pickingLocation) app.setPickingLocation(false);
      else if (app.closeup.active) app.exitCloseup();
      else if (app.skyView.active) {
        // Close an open panel first; a second Escape leaves the sky view.
        if (!document.querySelector('.identify-panel:not([hidden])')) app.exitSkyView();
      }
      else app.select(null);
    }
    if ((e.key === 'f' || e.key === 'F') && app.selected) app.setFollowing(!app.following);
  });
}
