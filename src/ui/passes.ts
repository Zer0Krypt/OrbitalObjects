import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { satrecFor } from '../render/orbits';
import { compass, findPasses, lookAt, type Pass } from '../sim/observer';
import { fmt, fmtKm, h, icon } from './dom';
import { fmtObserver } from './sky';

const EYE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
// Times are shown in the browser's zone, which may differ from the observer's.
const tzLabel = (Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time').replace(/_/g, ' ');

/** "From your location" section of the info panel: live look angles and upcoming passes. */
export function observerSection(app: App, o: SatObject) {
  const body = h('div');
  const el = h('div', { class: 'isec' }, h('h3', null, 'From your location', h('span', null, app.observer ? fmtObserver(app.observer) : '')), body);

  if (!app.observer) {
    body.append(
      h('p', { class: 'sky-hint', style: 'margin:0 0 10px' }, 'Set your location to see where this object is in your sky and when it next passes over.'),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            document.body.classList.add('explorer-open');
            document.getElementById('sky-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        },
        'Set my location',
      ),
    );
    return { el, update: () => {} };
  }

  const cells: Record<string, HTMLElement> = {};
  const cell = (k: string, label: string) => {
    const v = h('div', { class: 'v' }, '—');
    cells[k] = v;
    return h('div', null, h('div', { class: 'l' }, label), v);
  };
  const badge = h('span', { class: 'badge' });
  const live = h('div', { class: 'live live-sky' }, cell('az', 'Azimuth'), cell('el', 'Elevation'), cell('range', 'Range'));
  const passBox = h('div', { class: 'passes' });
  body.append(h('div', { class: 'badges', style: 'margin:0 0 10px' }, badge), live, h('div', { class: 'pass-head' }, 'Next passes', h('span', null, `next 48 h · ${tzLabel}`)), passBox);

  const rec = satrecFor(o);
  let passes: Pass[] | 'always' | 'never' | null = null;
  let computedAt = -Infinity;

  function renderPasses(t: number) {
    if (!rec || !app.observer) return;
    passes = findPasses(rec, app.observer, t - 15 * 60e3, 48, 0, o.period);
    computedAt = t;
    if (passes === 'always') {
      passBox.replaceChildren(h('p', { class: 'sky-hint' }, 'Always above your horizon for the next 48 hours — typical of a geostationary object in view.'));
      return;
    }
    if (passes === 'never') {
      passBox.replaceChildren(h('p', { class: 'sky-hint' }, "Doesn't rise above your horizon in the next 48 hours."));
      return;
    }
    const upcoming = passes.filter((p) => p.set > t).slice(0, 6);
    if (!upcoming.length) {
      passBox.replaceChildren(h('p', { class: 'sky-hint' }, 'No more passes in the next 48 hours.'));
      return;
    }
    passBox.replaceChildren(
      ...upcoming.map((p) => {
        const now = p.rise <= t && p.set > t;
        return h(
          'button',
          {
            class: 'pass' + (now ? ' now' : '') + (p.visible ? ' vis' : ''),
            title: 'Jump to this pass',
            onclick: () => {
              app.exitHistory();
              app.clock.set(p.rise - 60e3);
              app.setFollowing(false);
            },
          },
          h('div', { class: 'pass-day' }, now ? 'Now' : dayFmt.format(p.rise), h('small', null, `${timeFmt.format(p.rise)} – ${timeFmt.format(p.set)}`)),
          h('div', { class: 'pass-dir' }, `${compass(p.riseAz)} → ${compass(p.setAz)}`, h('small', null, `${Math.round((p.set - p.rise) / 60e3)} min`)),
          h('div', { class: 'pass-max' }, `${Math.round(p.maxEl)}°`, h('small', null, 'max')),
          h('div', { class: 'pass-vis', title: p.visible ? 'Sunlit against a dark sky: may be visible to the eye' : 'Not visible to the eye (daylight or in Earth\'s shadow)' }, p.visible ? icon(EYE) : ''),
        );
      }),
    );
  }

  function update(t: number) {
    if (!rec || !app.observer) return;
    const la = lookAt(rec, app.observer, t);
    if (!la) return;
    cells.az.replaceChildren(`${fmt(la.az, 1)}°`, h('small', null, compass(la.az)));
    cells.el.replaceChildren(`${fmt(la.el, 1)}°`);
    cells.range.replaceChildren(fmtKm(la.range), h('small', null, 'km'));
    const up = la.el > 0;
    const visible = up && la.sunlit && la.sunEl < -6;
    badge.className = 'badge ' + (visible ? 'good' : up ? 'warn' : '');
    badge.textContent = visible ? 'Visible now — sunlit in a dark sky' : up ? (la.sunlit ? 'Above horizon · sky too bright' : "Above horizon · in Earth's shadow") : 'Below your horizon';
    const stale = Math.abs(t - computedAt) > 3600e3 || (Array.isArray(passes) && passes.length > 0 && passes[0].set < t && passes.filter((p) => p.set > t).length < 3);
    if (passes === null || stale) renderPasses(t);
  }

  return { el, update };
}
