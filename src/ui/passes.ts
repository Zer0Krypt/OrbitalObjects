import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { satrecFor } from '../render/orbits';
import { compass, findPasses, lookAt, magnitudeOf, type Pass } from '../sim/observer';
import { describeMag, fmtMag, NAKED_EYE_MAG } from '../sim/brightness';
import { fmt, fmtKm, h, icon } from './dom';
import { downloadIcs, visiblePasses } from './alerts';
import { ICON_SKY } from './skyview';
import { fmtObserver } from './sky';

export const BELL = '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>';
export const CAL = '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';
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
    return { el, update: () => {}, dispose: () => {} };
  }

  const cells: Record<string, HTMLElement> = {};
  const cell = (k: string, label: string) => {
    const v = h('div', { class: 'v' }, '—');
    cells[k] = v;
    return h('div', null, h('div', { class: 'l' }, label), v);
  };
  const badge = h('span', { class: 'badge' });
  const live = h('div', { class: 'live live-sky four' }, cell('az', 'Azimuth'), cell('el', 'Elevation'), cell('range', 'Range'), cell('mag', 'Brightness'));
  const std = app.stdMag(o);
  const passBox = h('div', { class: 'passes' });
  // Alerts and calendar export.
  const alerts = app.alerts;
  const bell = h('button', { class: 'btn', onclick: () => alerts?.toggle(o) });
  const cal = h('button', { class: 'btn', title: 'Download visible passes for the next 7 days' }, icon(CAL), 'Add to calendar');
  cal.onclick = () => {
    if (!app.observer) return;
    const list = visiblePasses(app, o, Date.now(), 7);
    if (!list.length) {
      cal.textContent = 'No visible passes in 7 days';
      cal.disabled = true;
      return;
    }
    downloadIcs(list.map((p) => ({ o, p })), app.observer, `${o.name.replace(/\W+/g, '-').toLowerCase()}-passes.ics`);
  };
  const syncBell = () => {
    const on = !!alerts?.has(o.norad);
    bell.setAttribute('aria-pressed', String(on));
    bell.title = on ? 'Alerts on: you will be notified 5 minutes before each visible pass while this tab is open' : 'Notify me 5 minutes before each visible pass (while this tab is open)';
    bell.replaceChildren(icon(BELL), on ? 'Alerts on' : 'Alert me');
  };
  const offAlerts = alerts?.onChange(syncBell);
  syncBell();
  const look = h('button', { class: 'btn', title: 'Look up at it from your location', onclick: () => app.enterSkyView() }, icon(ICON_SKY), 'Sky view');
  const passActions = h('div', { class: 'sky-actions pass-actions' }, bell, cal, look);

  body.append(h('div', { class: 'badges', style: 'margin:0 0 10px' }, badge), live, h('div', { class: 'pass-head' }, 'Next passes', h('span', null, `next 48 h · ${tzLabel}`)), passBox, passActions);

  const rec = satrecFor(o);
  let passes: Pass[] | 'always' | 'never' | null = null;
  let computedAt = -Infinity;

  function renderPasses(t: number) {
    if (!rec || !app.observer) return;
    passes = findPasses(rec, app.observer, t - 15 * 60e3, 48, 0, o.period, std.mag);
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
          h(
            'div',
            {
              class: 'pass-vis',
              title:
                p.peakMag < 50
                  ? `Brightest about magnitude ${fmtMag(p.peakMag)} (${describeMag(p.peakMag)}) at ${timeFmt.format(p.peakMagAt)}${std.estimated ? ' — estimated from its size' : ''}`
                  : "Not visible to the eye (daylight or in Earth's shadow)",
            },
            p.visible ? icon(EYE) : '',
            p.peakMag < 50 ? h('small', null, fmtMag(p.peakMag)) : '',
          ),
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
    const mag = magnitudeOf(la, std.mag);
    cells.mag.replaceChildren(mag < 50 ? fmtMag(mag) : '—', h('small', null, mag < 50 ? 'mag' : la.el > 0 ? 'unlit' : ''));
    cells.mag.title = mag < 50 ? `${describeMag(mag)}${std.estimated ? ' (estimated from its size)' : ''}` : '';
    const up = la.el > 0;
    const visible = up && la.sunlit && la.sunEl < -6 && mag <= NAKED_EYE_MAG;
    badge.className = 'badge ' + (visible ? 'good' : up ? 'warn' : '');
    badge.textContent = visible
      ? `Visible now — magnitude ${fmtMag(mag)}, ${describeMag(mag)}`
      : up
        ? la.sunlit
          ? la.sunEl < -6
            ? `Above horizon · too faint (mag ${fmtMag(mag)})`
            : 'Above horizon · sky too bright'
          : "Above horizon · in Earth's shadow"
        : 'Below your horizon';
    const stale = Math.abs(t - computedAt) > 3600e3 || (Array.isArray(passes) && passes.length > 0 && passes[0].set < t && passes.filter((p) => p.set > t).length < 3);
    if (passes === null || stale) renderPasses(t);
  }

  return { el, update, dispose: () => offAlerts?.() };
}
