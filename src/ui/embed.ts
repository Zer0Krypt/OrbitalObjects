import type { App } from '../app';
import { eciToGeodetic, gmst } from '../sim/astro';
import { fmt, fmtKm, h, icon, ICONS } from './dom';
import { describeView } from './export';
import { stateParams } from './share';

/**
 * Embeddable widget: the same app in an iframe with `?embed`, showing only
 * the globe, a small caption and a link back to the full site.
 *
 *   ?embed            the widget
 *   &info=0           hide the caption
 *   &rotate=0         don't auto-rotate
 *
 * The parent page can talk to it with postMessage:
 *   { type: 'orbital-objects:select', norad: 25544 }   (null to clear)
 *   { type: 'orbital-objects:search', query: 'starlink' }
 * and it announces { type: 'orbital-objects:selected', norad, name } back.
 */

export const isEmbed = () => new URLSearchParams(location.search).has('embed');

const SIZES: [string, string, string][] = [
  ['640 × 400', '640', '400'],
  ['480 × 320', '480', '320'],
  ['Full width', '100%', '460'],
];

/** "Embed" section of the share menu: builds the iframe snippet. */
export function mountEmbedBuilder(app: App) {
  let size = 0;
  let info = true;
  let rotate = true;
  const code = h('textarea', { class: 'embed-code', readonly: true, rows: 3, 'aria-label': 'Embed code', spellcheck: 'false' });
  const sizeBtns = SIZES.map(([l], i) => h('button', { class: 'chip', onclick: () => ((size = i), refresh()) }, l));
  const opt = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = h('button', { class: 'chip', onclick: () => (set(!get()), refresh()) }, label);
    return { b, sync: () => b.setAttribute('aria-pressed', String(get())) };
  };
  const optInfo = opt('Caption', () => info, (v) => (info = v));
  const optRot = opt('Auto-rotate', () => rotate, (v) => (rotate = v));
  const copy = h('button', { class: 'btn' }, icon(ICONS.link), 'Copy code');
  const preview = h('a', { class: 'btn', target: '_blank', rel: 'noopener' }, 'Preview ↗');
  const el = h(
    'div',
    { class: 'embed-box' },
    h('p', { class: 'share-sub' }, 'Put a live globe of this selection or filter on your own site.'),
    h('div', { class: 'chips' }, ...sizeBtns, optInfo.b, optRot.b),
    code,
    h('div', { class: 'share-actions' }, copy, preview),
  );

  function url() {
    const q = new URLSearchParams({ embed: '' });
    if (!info) q.set('info', '0');
    if (!rotate) q.set('rotate', '0');
    const hash = stateParams(app, { time: false, camera: !app.selected, location: false }).toString();
    return `${location.origin}${location.pathname}?${q.toString().replace(/^embed=/, 'embed')}${hash ? '#' + hash : ''}`;
  }
  function refresh() {
    sizeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === size)));
    optInfo.sync();
    optRot.sync();
    const [, w, hgt] = SIZES[size];
    const src = url();
    const title = `Orbital Objects: ${app.selected ? app.selected.name : 'objects in Earth orbit'}`;
    code.value = `<iframe src="${src.replace(/&/g, '&amp;')}" width="${w}" height="${hgt}" style="border:0;border-radius:12px;max-width:100%" loading="lazy" allow="fullscreen" title="${title.replace(/"/g, '&quot;')}"></iframe>`;
    preview.href = src;
  }
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(code.value);
    } catch {
      code.select();
      document.execCommand?.('copy');
    }
    copy.lastChild!.textContent = 'Copied';
    setTimeout(() => (copy.lastChild!.textContent = 'Copy code'), 1500);
  };
  refresh();
  return Object.assign(el, { refresh });
}

/** Runs inside the iframe: caption, link out, auto-rotate/follow and the postMessage API. */
export function mountEmbed(app: App) {
  const q = new URLSearchParams(location.search);
  document.body.classList.add('embed');
  app.persistSettings = false;
  const showInfo = q.get('info') !== '0';
  app.setSetting('autoRotate', q.get('rotate') !== '0');

  const title = h('b');
  const sub = h('span');
  const caption = h('div', { class: 'embed-caption', hidden: !showInfo }, title, sub);
  const open = h('a', { class: 'embed-open', target: '_blank', rel: 'noopener', title: 'Open in Orbital Objects' }, h('span', null, 'ORBITAL', h('b', null, 'OBJECTS')), '↗');
  document.getElementById('app')!.append(caption, open);

  // Scrolling the host page over the widget shouldn't zoom it until someone interacts.
  const controls = app.stage.controls;
  controls.enableZoom = false;
  app.stage.renderer.domElement.addEventListener('pointerdown', () => (controls.enableZoom = true), { once: true });

  const syncLink = () => {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    open.href = `${location.origin}${location.pathname}${p.toString() ? '#' + p.toString() : ''}`;
  };
  let last = 0;
  const syncCaption = (force = false) => {
    if (!showInfo || (!force && performance.now() - last < 500)) return;
    last = performance.now();
    const o = app.selected;
    if (!o) {
      title.textContent = describeView(app);
      sub.textContent = 'Live · drag to rotate, scroll to zoom, click an object';
      return;
    }
    title.textContent = o.name;
    if (!app.hasPosition(o)) {
      sub.textContent = o.decay ? `Re-entered ${o.decay}` : 'No current position';
      return;
    }
    const t = app.clock.now();
    const s = app.scenePosition(o, undefined, t);
    const g = eciToGeodetic(s.x * 6371, -s.z * 6371, s.y * 6371, gmst(t));
    sub.textContent = `${fmtKm(g.alt)} km up · ${fmt(Math.abs(g.lat), 1)}° ${g.lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(g.lon), 1)}° ${g.lon >= 0 ? 'E' : 'W'}`;
  };
  app.on('frame', () => syncCaption());
  app.on('filters', () => syncCaption(true));
  let announced: number | null | undefined;
  app.on('selection', () => {
    // 'selection' also fires when following changes; only act on real changes.
    const norad = app.selected?.norad ?? null;
    if (norad === announced) return;
    announced = norad;
    syncCaption(true);
    setTimeout(syncLink, 400);
    parent.postMessage({ type: 'orbital-objects:selected', norad, name: app.selected?.name ?? null }, '*');
    // Keep a single object in view as it moves.
    if (app.selected && !app.following) app.setFollowing(true);
  });
  window.addEventListener('hashchange', syncLink);
  syncLink();

  window.addEventListener('message', (e) => {
    const d = e.data as { type?: string; norad?: number | null; query?: string } | null;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'orbital-objects:select') {
      const o = typeof d.norad === 'number' ? app.cat.byNorad.get(d.norad) : null;
      app.select(o ?? null, { fly: true });
    } else if (d.type === 'orbital-objects:search' && typeof d.query === 'string') app.setFilters({ query: d.query.slice(0, 120) });
  });
}
