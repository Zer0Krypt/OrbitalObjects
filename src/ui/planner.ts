import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { describeMag, fmtMag } from '../sim/brightness';
import { compass } from '../sim/observer';
import { downloadIcs, visiblePasses, type PassEvent } from './alerts';
import { h, icon } from './dom';
import { BELL, CAL, wxCell } from './passes';
import { cloudAt } from '../data/weather';
import { skyQuality } from '../sim/brightness';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const HOURS = 24;
const MAX_CANDIDATES = 180;

/** Objects worth looking for: stations, the brightest satellites, and anything with alerts on. */
function candidates(app: App): SatObject[] {
  const keys = new Set(['stations', 'visual']);
  const gi = app.cat.groups.map((g, i) => (keys.has(g.key) ? i : -1)).filter((i) => i >= 0);
  const alerted = new Set(app.alerts?.list ?? []);
  const list = app.cat.objects.filter(
    (o) => !o.decay && app.isLiveObject(o) && o.period < 225 && (alerted.has(o.norad) || o.groups.some((g) => gi.includes(g)) || [25544, 48274, 20580].includes(o.norad)),
  );
  // Brightest first, so a capped list keeps the ones most worth seeing.
  return list.sort((a, b) => app.stdMag(a).mag - app.stdMag(b).mag).slice(0, MAX_CANDIDATES);
}

/** "Bright passes tonight": visible passes of the brightest objects over the next day. */
export function mountPlanner(app: App) {
  const list = h('div', { class: 'passes planner-list' });
  const status = h('p', { class: 'sky-hint', style: 'margin:0' });
  const run = h('button', { class: 'btn' }, 'Find bright passes');
  const dl = h('button', { class: 'btn', hidden: true, title: 'Download these passes as a calendar file' }, icon(CAL), 'Calendar (.ics)');
  const el = h('div', { class: 'planner' }, h('div', { class: 'pass-head' }, 'Bright passes', h('span', null, `next ${HOURS} h`)), status, list, h('div', { class: 'sky-actions' }, run, dl));

  let events: PassEvent[] = [];
  // With a cloud forecast, passes under thick cloud are left out (and counted).
  let hideCloudy = true;
  const cloudToggle = h('button', { class: 'chip', hidden: true, onclick: () => ((hideCloudy = !hideCloudy), render()) }, 'Hide cloudy');
  el.querySelector('.sky-actions')!.append(cloudToggle);
  const where = () => `${app.observer?.lat},${app.observer?.lon},${skyQuality}`;
  let job = 0;
  let computedFor = '';

  function compute() {
    if (!app.observer) return;
    const id = ++job;
    const cands = candidates(app);
    const from = Date.now() - 5 * 60e3;
    const found: PassEvent[] = [];
    let k = 0;
    computedFor = where();
    run.disabled = true;
    const step = () => {
      if (id !== job || !app.observer) return;
      const until = performance.now() + 12;
      while (k < cands.length && performance.now() < until) {
        const o = cands[k++];
        for (const p of visiblePasses(app, o, from, HOURS / 24)) found.push({ o, p });
      }
      status.textContent = `Checking ${k} of ${cands.length} bright objects…`;
      if (k < cands.length) setTimeout(step, 0);
      else {
        events = found.sort((a, b) => a.p.rise - b.p.rise);
        run.disabled = false;
        run.textContent = 'Refresh';
        render();
      }
    };
    step();
  }

  function render() {
    if (!computedFor) return;
    const now = Date.now();
    const all = events.filter((e) => e.p.set > now);
    const cloudy = (e: PassEvent) => (cloudAt(app.weather, e.p.peak) ?? 0) >= 70;
    const upcoming = app.weather && hideCloudy ? all.filter((e) => !cloudy(e)) : all;
    const hidden = all.length - upcoming.length;
    cloudToggle.hidden = !app.weather || !all.length;
    cloudToggle.setAttribute('aria-pressed', String(hideCloudy));
    dl.hidden = !upcoming.length;
    status.textContent = upcoming.length
      ? `${upcoming.length} visible ${upcoming.length === 1 ? 'pass' : 'passes'} of the brightest ${MAX_CANDIDATES} objects${hidden ? `, ${hidden} more hidden by forecast cloud` : ''}. Times in your browser's zone.`
      : hidden
        ? `All ${hidden} bright ${hidden === 1 ? 'pass is' : 'passes are'} forecast to be clouded out.`
        : 'No bright passes in the next day. Satellites are only visible near dawn and dusk, when your sky is dark but they are still in sunlight.';
    list.replaceChildren(
      ...upcoming.slice(0, 12).map(({ o, p }) => {
        const alerted = app.alerts?.has(o.norad);
        const wx = wxCell(app, p.peak);
        return h(
          'button',
          {
            class: 'pass vis planner-row' + (wx ? ' wx' : '') + (wx?.classList.contains('cloudy') ? ' clouded' : ''),
            title: `${o.name}: brightest about magnitude ${fmtMag(p.peakMag)} (${describeMag(p.peakMag)}). Click to show it.`,
            onclick: () => {
              app.exitHistory();
              app.select(o, { fly: true });
              app.clock.set(p.rise - 60e3);
            },
          },
          h('div', { class: 'pass-day' }, `${dayFmt.format(p.rise)} ${timeFmt.format(p.rise)}`, h('small', null, o.name.replace(/\s*\(.*\)$/, ''))),
          h('div', { class: 'pass-dir' }, `${compass(p.riseAz)} → ${compass(p.setAz)}`, h('small', null, `${Math.round(p.maxEl)}° max`)),
          h('div', { class: 'pass-max' }, fmtMag(p.peakMag), h('small', null, 'mag')),
          h('div', { class: 'pass-vis' }, alerted ? icon(BELL) : ''),
          wx,
        );
      }),
    );
  }

  run.onclick = compute;
  dl.onclick = () => {
    if (!app.observer) return;
    const now = Date.now();
    downloadIcs(
      events.filter((e) => e.p.set > now),
      app.observer,
      'bright-satellite-passes.ics',
    );
  };
  app.on('observer', () => {
    if (!app.observer) {
      events = [];
      list.replaceChildren();
      return;
    }
    // Recompute for a new location once the list has been asked for.
    if (computedFor && computedFor !== where()) compute();
  });
  app.on('weather', render);
  app.alerts?.onChange(render);
  status.textContent = 'Find the brightest satellites passing over you in the next day.';
  return el;
}
