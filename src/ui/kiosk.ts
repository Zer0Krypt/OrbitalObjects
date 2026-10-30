import type { App, Settings } from '../app';
import type { SatObject } from '../data/catalog';
import { defaultFilters, type ColorMode, type Filters } from '../data/model';
import { SPACE_AGE_START } from '../app';
import { fmtInt, fmtUtc, h } from './dom';

/**
 * Ambient / kiosk mode: full screen, no panels, slowly cycling through
 * scenes with large captions. For lobby screens and screensavers.
 * Start with ?kiosk in the URL, the K key or the About panel; Esc leaves.
 */

interface Scene {
  title: string;
  text: (app: App) => string;
  ms: number;
  run: (app: App) => void;
  available?: (app: App) => boolean;
}

const gi = (app: App, key: string) => app.cat.groups.findIndex((g) => g.key === key);
const brightest = (app: App): SatObject | undefined =>
  [25544, 48274, 20580].map((n) => app.cat.byNorad.get(n)).find((o) => o && app.isLiveObject(o) && app.hasPosition(o));

const SCENES: Scene[] = [
  {
    title: 'Everything in Earth orbit',
    text: (app) => `${fmtInt(app.liveCount)} tracked objects, live: satellites, spent rocket stages and debris, each where it is right now.`,
    ms: 40e3,
    run: (app) => {
      app.setColorMode('type');
      app.zoomTo(4.4);
    },
  },
  {
    title: 'Home in orbit',
    text: (app) => {
      const o = brightest(app);
      return o ? `${o.name.replace(/\s*\(.*\)$/, '')}, about ${fmtInt((o.perigee + o.apogee) / 2)} km up, circling Earth every ${Math.round(o.period)} minutes.` : 'Space stations circle Earth about every 90 minutes.';
    },
    ms: 35e3,
    available: (app) => !!brightest(app),
    run: (app) => {
      const o = brightest(app);
      if (o) {
        app.select(o, { fly: true });
        setTimeout(() => app.selected === o && app.setFollowing(true), 2500);
      }
    },
  },
  {
    title: 'Starlink coverage',
    text: () => 'Brighter means more Starlink satellites overhead: how many each place on Earth can see at least 25° above the horizon.',
    ms: 35e3,
    available: (app) => gi(app, 'starlink') >= 0,
    run: (app) => {
      app.setFilters({ groups: new Set([gi(app, 'starlink')]) });
      app.setSetting('coverage', 'starlink');
      app.zoomTo(3.4);
    },
  },
  {
    title: 'The geostationary belt',
    text: () => 'Some 36,000 km up, satellites circle once a day and hang over one spot, in a thin ring above the equator.',
    ms: 35e3,
    run: (app) => {
      app.setFilters({ regimes: new Set(['GEO']) });
      app.setColorMode('owner');
      app.zoomTo(15);
    },
  },
  {
    title: 'Where the debris is',
    text: () => 'Tracked debris and spent stages, drawn as a haze: densest between about 750 and 1,000 km, where it can stay up for centuries.',
    ms: 35e3,
    run: (app) => {
      app.setFilters({ types: new Set(['D', 'R']) });
      app.setSetting('debrisCloud', true);
      app.zoomTo(3.6);
    },
  },
  {
    title: 'The space age',
    text: () => 'From Sputnik in 1957 to today, every catalogued object appearing in the year it was launched.',
    ms: 42e3,
    run: (app) => {
      app.setHistory({ cutoff: SPACE_AGE_START, playing: true, speed: (1.75 * 365.25 * 86400e3) / 1000 });
      app.zoomTo(4.8);
    },
  },
];

export function mountKiosk(app: App) {
  const title = h('h2');
  const text = h('p');
  const when = h('div', { class: 'kiosk-when mono' });
  const caption = h('div', { class: 'kiosk-caption' }, h('div', { class: 'kiosk-brand' }, 'ORBITAL', h('b', null, 'OBJECTS')), title, text, when);
  const exit = h('button', { class: 'btn kiosk-exit', hidden: true, onclick: () => stop() }, 'Exit kiosk mode (Esc)');
  document.getElementById('app')!.append(caption, exit);

  let active = false;
  let index = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saved: { settings: Settings; color: ColorMode; filters: Filters; persist: boolean } | null = null;
  let wake: { release: () => Promise<void> } | null = null;
  let hideExit: ReturnType<typeof setTimeout> | undefined;

  /** Undo the previous scene's changes before the next one starts. */
  function clean() {
    app.exitHistory();
    app.setFollowing(false);
    app.select(null);
    app.filters = defaultFilters();
    app.applyFilters();
    if (saved) {
      app.setSetting('coverage', '');
      app.setSetting('debrisCloud', false);
      app.setSetting('autoRotate', true);
    }
  }

  function next() {
    if (!active) return;
    const list = SCENES.filter((s) => !s.available || s.available(app));
    index = (index + 1) % list.length;
    const s = list[index];
    clean();
    s.run(app);
    caption.classList.remove('in');
    void caption.offsetWidth;
    caption.classList.add('in');
    title.textContent = s.title;
    text.textContent = s.text(app);
    timer = setTimeout(next, s.ms);
  }

  async function start() {
    if (active) return;
    active = true;
    saved = { settings: { ...app.settings }, color: app.colorMode, filters: app.filters, persist: app.persistSettings };
    // Kiosk changes are temporary: don't save them as the visitor's settings.
    app.persistSettings = false;
    document.body.classList.add('kiosk');
    caption.hidden = false;
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    } catch {
      /* not allowed without a gesture (e.g. ?kiosk): fine */
    }
    try {
      wake = (await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen')) ?? null;
    } catch {
      wake = null;
    }
    app.updateViewOffset();
    index = -1;
    next();
  }

  function stop() {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    clean();
    if (saved) {
      for (const k of ['coverage', 'debrisCloud', 'autoRotate'] as const) app.setSetting(k, saved.settings[k] as never);
      app.setColorMode(saved.color);
      app.filters = saved.filters;
      app.applyFilters();
      app.persistSettings = saved.persist;
      saved = null;
    }
    document.body.classList.remove('kiosk');
    caption.hidden = true;
    exit.hidden = true;
    void wake?.release().catch(() => {});
    wake = null;
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    app.updateViewOffset();
    app.flyHome();
  }

  // The live clock line under the caption.
  setInterval(() => {
    if (!active) return;
    const t = app.history?.cutoff ?? app.clock.now();
    when.textContent = app.history ? `${new Date(t).getUTCFullYear()} · ${fmtInt(app.historyShown)} objects in orbit` : `Live · ${fmtUtc(t, false)} UTC`;
  }, 500);
  // Moving the mouse shows a way out for a few seconds.
  window.addEventListener('pointermove', () => {
    if (!active) return;
    exit.hidden = false;
    clearTimeout(hideExit);
    hideExit = setTimeout(() => (exit.hidden = true), 3000);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape' && active) stop();
    else if ((e.key === 'k' || e.key === 'K') && !app.skyView.active) void (active ? stop() : start());
    else if (active && e.key === 'ArrowRight') {
      clearTimeout(timer);
      next();
    }
  });
  app.startKiosk = () => void start();
  caption.hidden = true;
  if (new URLSearchParams(location.search).has('kiosk')) setTimeout(() => void start(), 1200);
}
