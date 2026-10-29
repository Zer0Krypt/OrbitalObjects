import type { App } from '../app';
import { modelFor } from '../render/models';
import { fmt, fmtInt, h } from './dom';

export const ICON_CUBE = '<path d="M12 2.5 3.5 7v10l8.5 4.5 8.5-4.5V7z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/>';

const NAMES: Record<number, string> = { 25544: 'International Space Station', 20580: 'Hubble Space Telescope', 48274: 'Tiangong' };

/** Drag / wheel / pinch for the close-up view, plus its heads-up card. */
export function mountCloseup(app: App) {
  const canvas = app.stage.renderer.domElement;
  const cu = app.closeup;

  // ---------- input ----------
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (!cu.active) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!cu.active || !p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 1) cu.rotate(dx, dy);
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0 && cu.zoom(pinch / d)) app.exitCloseup();
      pinch = d;
    }
  });
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!cu.active) return;
      e.preventDefault();
      if (cu.zoom(Math.exp(e.deltaY * 0.0015))) app.exitCloseup();
    },
    { passive: false },
  );

  // ---------- heads-up card ----------
  const title = h('div', { class: 'cu-title' });
  const facts = h('p', { class: 'cu-facts' });
  const dist = h('b', null, '—');
  const light = h('span', { class: 'cu-light' });
  const card = h(
    'div',
    { class: 'closeup-hud', hidden: true, role: 'region', 'aria-label': 'Close-up view' },
    h('div', { class: 'eyebrow' }, 'True-scale model'),
    title,
    facts,
    h('div', { class: 'cu-row' }, h('span', null, 'Camera ', dist, ' away'), light),
    h('div', { class: 'cu-row cu-hint' }, h('span', null, 'Drag to look around · scroll or pinch to zoom'), h('button', { class: 'btn', onclick: () => app.exitCloseup() }, 'Back to globe')),
  );
  document.getElementById('app')!.append(card);

  const sync = () => {
    const on = cu.active && cu.phase !== 'out';
    card.hidden = !on;
    document.body.classList.toggle('closeup', cu.active);
    app.updateViewOffset();
    if (!on || !cu.target) return;
    title.textContent = NAMES[cu.target.norad] ?? cu.target.name;
    facts.textContent = modelFor(cu.target.norad)?.facts ?? '';
    app.updateViewOffset();
  };
  app.on('closeup', sync);
  let last = 0;
  app.on('frame', () => {
    if (card.hidden || performance.now() - last < 200) return;
    last = performance.now();
    const t = cu.target;
    if (!t) return;
    const m = app.stage.camera.position.distanceTo(app.objectState(t, app.clock.now()).p) * 6371e3;
    dist.textContent = m < 10000 ? `${fmtInt(m)} m` : `${fmt(m / 1000, 0)} km`;
    light.textContent = cu.sunlit ? 'In sunlight' : "In Earth's shadow";
    light.classList.toggle('dark', !cu.sunlit);
  });
  sync();
}
