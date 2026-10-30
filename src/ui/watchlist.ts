import type { App } from '../app';
import { REGIME_LABEL, type SatObject } from '../data/catalog';
import { fmtMag } from '../sim/brightness';
import { compass, type Pass } from '../sim/observer';
import { visiblePasses } from './alerts';
import { fmtKm, h, icon, ICONS } from './dom';
import { BELL } from './passes';
import { cloudAt } from '../data/weather';

const timeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const DAYS = 3;

/**
 * "My satellites": objects starred in the info panel, with each one's next
 * visible pass from your location and one switch for alerts on all of them.
 */
export function mountWatchlist(app: App) {
  const list = h('div', { class: 'wl-list' });
  const alertAll = h('button', { class: 'chip' });
  const showAll = h('button', { class: 'chip', title: 'Show only these on the globe' }, 'Show on globe');
  const hint = h('p', { class: 'sky-hint', style: 'margin:0' });
  const el = h(
    'div',
    { class: 'section wl', hidden: true },
    h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, 'My satellites'), h('span', { class: 'wl-actions' }, showAll, alertAll)),
    list,
    hint,
  );

  const passes = new Map<number, Pass | null>();
  let computedFor = '';
  let job = 0;

  /** Next visible pass of each object, a few per tick so the page stays responsive. */
  function computePasses() {
    const key = app.observer ? `${app.observer.lat},${app.observer.lon},${[...app.watchlist].join()}` : '';
    if (key === computedFor) return;
    computedFor = key;
    passes.clear();
    if (!app.observer) return;
    const id = ++job;
    const queue = app.watchlistObjects().filter((o) => app.isLiveObject(o));
    const from = Date.now();
    const step = () => {
      if (id !== job) return;
      const until = performance.now() + 10;
      while (queue.length && performance.now() < until) {
        const o = queue.shift()!;
        passes.set(o.norad, visiblePasses(app, o, from, DAYS).find((p) => p.set > from) ?? null);
      }
      render();
      if (queue.length) setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  function row(o: SatObject) {
    const p = passes.get(o.norad);
    const alerted = !!app.alerts?.has(o.norad);
    const live = app.isLiveObject(o) && !o.decay;
    let detail: Node | string;
    if (!live) detail = o.decay ? `Re-entered ${o.decay}` : 'Not in the current catalogue';
    else if (!app.observer) detail = `${REGIME_LABEL[o.regime]} · ${fmtKm((o.perigee + o.apogee) / 2)} km`;
    else if (p === undefined) detail = 'Finding the next visible pass…';
    else if (p === null) detail = `No visible pass in the next ${DAYS} days`;
    else {
      const c = cloudAt(app.weather, p.peak);
      detail = h(
        'span',
        null,
        h('b', null, timeFmt.format(p.rise)),
        ` · ${compass(p.riseAz)} → ${compass(p.setAz)} · ${Math.round(p.maxEl)}° · mag ${fmtMag(p.peakMag)}${c !== null ? ` · ${Math.round(c)}% cloud` : ''}`,
      );
    }
    return h(
      'div',
      { class: 'wl-row' + (app.selected === o ? ' sel' : '') },
      h(
        'button',
        { class: 'wl-main', onclick: () => app.select(o, { fly: true }), title: 'Show on the globe' },
        h('i', { class: 'd', style: `background:${app.colorsHex[o.idx]};color:${app.colorsHex[o.idx]}` }),
        h('span', { class: 't' }, h('b', null, o.name), h('span', null, detail)),
      ),
      app.alerts && live
        ? h('button', { class: 'icon-mini', 'aria-pressed': String(alerted), title: alerted ? 'Alerts on' : 'Alert me before visible passes', 'aria-label': `Alerts for ${o.name}`, onclick: () => app.alerts?.toggle(o) }, icon(BELL))
        : null,
      h('button', { class: 'icon-mini', title: 'Remove from My satellites', 'aria-label': `Remove ${o.name}`, onclick: () => app.toggleWatchlist(o, false) }, icon(ICONS.close)),
    );
  }

  function render() {
    const objs = app.watchlistObjects();
    el.hidden = !objs.length;
    if (!objs.length) return;
    // Soonest visible pass first, then the rest by name.
    objs.sort((a, b) => (passes.get(a.norad)?.rise ?? Infinity) - (passes.get(b.norad)?.rise ?? Infinity) || a.name.localeCompare(b.name));
    list.replaceChildren(...objs.map(row));
    const live = objs.filter((o) => app.isLiveObject(o) && !o.decay);
    const allOn = !!app.alerts && live.length > 0 && live.every((o) => app.alerts!.has(o.norad));
    alertAll.hidden = !app.alerts || !app.observer || !live.length;
    alertAll.setAttribute('aria-pressed', String(allOn));
    alertAll.replaceChildren(icon(BELL), allOn ? 'Alerts on' : 'Alert all');
    alertAll.onclick = () => app.alerts?.setMany(live, !allOn);
    hint.textContent = app.observer ? '' : 'Set your location (Your sky, below) to see when each one next passes over.';
    hint.hidden = !!app.observer;
  }

  showAll.onclick = () => {
    app.exitHistory();
    app.select(null);
    app.setFilters({ ids: new Set(app.watchlist), idsLabel: 'My satellites' });
    app.flyHome();
  };
  app.on('watchlist', () => {
    computePasses();
    render();
  });
  app.on('observer', () => {
    computePasses();
    render();
  });
  app.on('weather', render);
  app.on('selection', render);
  app.on('colors', render);
  app.alerts?.onChange(render);
  // Refresh as passes go by.
  setInterval(() => {
    computedFor = '';
    computePasses();
  }, 10 * 60e3);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 's' || e.key === 'S') && app.selected && !app.selected.decay) app.toggleWatchlist(app.selected);
  });
  computePasses();
  render();
  return el;
}
