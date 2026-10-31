import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { auroraView } from '../data/more';
import { satrecFor } from '../render/orbits';
import { compass, findPasses, type Pass } from '../sim/observer';
import { findTrains, type Train } from '../sim/trains';
import { fmtMag } from '../sim/brightness';
import { visiblePasses } from './alerts';
import { fmtInt, h } from './dom';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

/** A collapsible tool in the Your sky section; `onOpen` runs the first time it opens. */
export function skyTool(title: string, sub: string, onOpen?: () => void) {
  const body = h('div', { class: 'sky-tool-body' });
  const el = h('details', { class: 'sky-tool' }, h('summary', null, h('b', null, title), h('small', null, sub)), body);
  let opened = false;
  el.addEventListener('toggle', () => {
    if (el.open && !opened) {
      opened = true;
      onOpen?.();
    }
  });
  return { el, body, isOpen: () => el.open };
}

/** Jump to a pass and show the object. */
function showPass(app: App, o: SatObject, p: Pass) {
  app.exitHistory();
  app.select(o, { fly: true });
  app.clock.set(p.rise - 60e3);
}

// ---------- radio passes ----------
const RADIO_HOURS = 12;
const RADIO_MAX = 260;

export function mountRadioPasses(app: App) {
  const status = h('p', { class: 'sky-hint', style: 'margin:0' });
  const list = h('div', { class: 'passes planner-list' });
  const run = h('button', { class: 'btn' }, 'Find radio passes');
  const t = skyTool('Radio passes', `amateur satellites · next ${RADIO_HOURS} h`, () => compute());
  t.body.append(status, list, h('div', { class: 'sky-actions' }, run));
  let job = 0;
  let found: { o: SatObject; p: Pass; f: number | null }[] = [];

  function candidates() {
    const r = app.radio;
    if (!r) return [];
    const out: SatObject[] = [];
    for (const [norad, txs] of r.sats) {
      const o = app.cat.byNorad.get(norad);
      if (!o || !app.isLiveObject(o) || o.period > 225) continue;
      if (!txs.some((x) => x.downlink && (/amateur/i.test(x.service) || norad === 25544))) continue;
      out.push(o);
    }
    return out.slice(0, RADIO_MAX);
  }

  function compute() {
    if (!app.observer) return;
    if (!app.radio) {
      status.textContent = 'Radio data (from SatNOGS) is unavailable right now.';
      return;
    }
    const id = ++job;
    const cands = candidates();
    const from = Date.now() - 5 * 60e3;
    const out: typeof found = [];
    let k = 0;
    run.disabled = true;
    const step = () => {
      if (id !== job || !app.observer) return;
      const until = performance.now() + 12;
      while (k < cands.length && performance.now() < until) {
        const o = cands[k++];
        const rec = satrecFor(o);
        if (!rec) continue;
        const ps = findPasses(rec, app.observer, from, RADIO_HOURS, 10, o.period, 6);
        if (!Array.isArray(ps)) continue;
        const f = app.radio!.sats.get(o.norad)?.find((x) => x.downlink)?.downlink ?? null;
        for (const p of ps) out.push({ o, p, f });
      }
      status.textContent = `Checking ${k} of ${cands.length} satellites with active transmitters…`;
      if (k < cands.length) setTimeout(step, 0);
      else {
        found = out.sort((a, b) => a.p.rise - b.p.rise);
        run.disabled = false;
        run.textContent = 'Refresh';
        render();
      }
    };
    step();
  }

  function render() {
    const now = Date.now();
    const up = found.filter((x) => x.p.set > now);
    status.textContent = up.length
      ? `${up.length} passes above 10° by ${new Set(up.map((x) => x.o.norad)).size} satellites. Radio works day or night, so these aren't limited to visible passes. Frequencies from SatNOGS DB.`
      : 'No passes above 10° in the next 12 hours.';
    list.replaceChildren(
      ...up.slice(0, 14).map(({ o, p, f }) =>
        h(
          'button',
          { class: 'pass planner-row', title: `${o.name}: show it and jump to the pass`, onclick: () => showPass(app, o, p) },
          h('div', { class: 'pass-day' }, `${dayFmt.format(p.rise)} ${timeFmt.format(p.rise)}`, h('small', null, o.name.replace(/\s*\(.*\)$/, ''))),
          h('div', { class: 'pass-dir' }, `${compass(p.riseAz)} → ${compass(p.setAz)}`, h('small', null, `${Math.round((p.set - p.rise) / 60e3)} min`)),
          h('div', { class: 'pass-max' }, `${Math.round(p.maxEl)}°`, h('small', null, 'max')),
          h('div', { class: 'pass-freq' }, f ? (f / 1e6).toFixed(3) : '—', h('small', null, 'MHz')),
        ),
      ),
    );
  }
  app.on('observer', () => t.isOpen() && compute());
  app.on('radio', () => t.isOpen() && compute());
  run.onclick = compute;
  status.textContent = 'Passes of amateur radio satellites you can listen to, at any time of day.';
  return t.el;
}

// ---------- Starlink trains ----------
export function mountTrains(app: App) {
  const body = h('div');
  const t = skyTool('Starlink trains', 'fresh launches still in a line', () => render());

  t.body.append(body);
  function trains(): Train[] {
    const gi = app.cat.groups.findIndex((g) => g.key === 'starlink');
    return findTrains(app.cat.objects.slice(0, app.liveCount), gi, Date.now());
  }

  function render() {
    if (!app.observer) return;
    const now = Date.now();
    const list = trains();
    if (!list.length) {
      body.replaceChildren(
        h('p', { class: 'sky-hint', style: 'margin:0' }, 'No fresh Starlink trains right now. A new batch flies in a tight line for a week or two after launch, then spreads out as the satellites climb to their working orbits.'),
      );
      return;
    }
    body.replaceChildren(
      h('p', { class: 'sky-hint', style: 'margin:0 0 8px' }, 'A batch launched days ago still flies in a tight line, bright and low before it climbs: the “string of lights” behind many UFO reports.'),
      ...list.map((tr) => {
        const passes = visiblePasses(app, tr.centre, now - 10 * 60e3, 3).filter((p) => p.set > now);
        const tonight = passes.find((p) => p.rise - now < 18 * 3600e3);
        return h(
          'div',
          { class: 'train' },
          h(
            'div',
            { class: 'train-head' },
            h('b', null, `Launch ${tr.key}`, tonight ? h('em', { class: 'tag tip' }, 'Train tonight') : null),
            h('small', null, `${tr.objects.length} satellites · ${Math.max(0, Math.round(tr.ageDays))} days old · ${fmtInt(tr.altKm)} km up · line ${fmtInt(tr.lengthKm)} km long`),
          ),
          passes.length
            ? h(
                'div',
                { class: 'passes' },
                ...passes.slice(0, 4).map((p) =>
                  h(
                    'button',
                    { class: 'pass vis planner-row', title: 'Jump to this pass', onclick: () => showTrain(tr, p) },
                    h('div', { class: 'pass-day' }, `${dayFmt.format(p.rise)} ${timeFmt.format(p.rise)}`, h('small', null, `${Math.round((p.set - p.rise) / 60e3)} min overhead`)),
                    h('div', { class: 'pass-dir' }, `${compass(p.riseAz)} → ${compass(p.setAz)}`, h('small', null, `${Math.round(p.maxEl)}° max`)),
                    h('div', { class: 'pass-max' }, fmtMag(p.peakMag), h('small', null, 'mag')),
                  ),
                ),
              )
            : h('p', { class: 'sky-hint', style: 'margin:4px 0' }, 'No visible passes over you in the next 3 days.'),
          h('div', { class: 'sky-actions' }, h('button', { class: 'btn', onclick: () => showTrain(tr) }, 'Show the train')),
        );
      }),
    );
  }

  function showTrain(tr: Train, p?: Pass) {
    app.exitHistory();
    app.setFilters({ ids: new Set(tr.objects.map((o) => o.norad)), idsLabel: `Starlink train ${tr.key}` });
    app.select(tr.centre, { fly: true });
    if (p) app.clock.set(p.rise - 60e3);
  }
  app.on('observer', () => t.isOpen() && render());
  return t.el;
}

// ---------- aurora ----------
/** "Aurora tonight" line for the observing conditions. */
export function mountAuroraLine(app: App) {
  const btn = h('button', { class: 'chip', onclick: () => app.setSetting('aurora', !app.settings.aurora) }, 'Aurora on globe');
  const note = h('small');
  const el = h('div', { class: 'sky-wx' }, btn, note);
  const sync = () => {
    btn.setAttribute('aria-pressed', String(app.settings.aurora));
    const o = app.observer;
    const g = app.aurora;
    if (!o) return;
    if (!g) {
      note.textContent = 'Loading the aurora forecast…';
      return;
    }
    const v = auroraView(g, o.lat, o.lon);
    const kp = app.spaceWeather?.kp.filter((k) => !k[2] && Date.parse(k[0]) > Date.now() && Date.parse(k[0]) < Date.now() + 24 * 3600e3).reduce((m, k) => Math.max(m, k[1]), 0) ?? 0;
    const when = g.forecast ? ` for ${timeFmt.format(Date.parse(g.forecast.endsWith('Z') ? g.forecast : g.forecast + 'Z'))}` : '';
    const chance =
      v.overhead >= 10
        ? `Aurora likely overhead (${v.overhead}% chance)`
        : v.horizon >= 10
          ? `Aurora possible low in the ${v.direction} (${v.horizon}%)`
          : `Aurora unlikely from here (${Math.max(v.overhead, v.horizon)}%)`;
    note.textContent = `${chance}${when}. ${kp >= 5 ? `Kp ${kp} storm forecast in the next day. ` : ''}NOAA OVATION${g.live ? '' : ', last build'}${g.sample ? ' (sample)' : ''}.`;
  };
  app.on('aurora', sync);
  app.on('observer', () => {
    if (app.observer) void app.refreshAurora();
    sync();
  });
  app.on('settings', sync);
  app.on('watch', sync);
  if (app.observer) void app.refreshAurora();
  setInterval(() => app.observer && void app.refreshAurora(), 15 * 60e3);
  sync();
  return el;
}

