import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { defaultFilters } from '../data/model';
import { satrecFor, stateAt } from '../render/orbits';
import { eciToGeodetic, gmst } from '../sim/astro';
import { fmt, fmtInt, h, icon, ICONS } from './dom';

// Guided tours: short stories that drive time, filters, camera and charts.
// Narration is computed from the data at each step, so numbers stay true as
// the catalogue changes.

interface Step {
  title: string;
  run: (app: App) => Promise<void> | void;
  text: (app: App) => string;
}

export interface Tour {
  id: string;
  title: string;
  blurb: string;
  steps: Step[];
}

// ---------- helpers ----------
const ready = (app: App) =>
  app.historyStatus === 'ready' || app.historyStatus === 'error'
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const off = app.on('history', () => {
          if (app.historyStatus === 'loading') return;
          off();
          resolve();
        });
      });

/** History mode at an instant (real time, so true positions are possible). */
async function at(app: App, iso: string) {
  app.setHistory({ cutoff: Date.parse(iso), playing: false });
  await ready(app);
}

function live(app: App) {
  app.exitHistory();
  app.clock.resetToNow();
}

function reset(app: App) {
  app.setPair(null);
  app.clearCompare();
  app.select(null);
  app.setProfile(null);
  app.filters = defaultFilters();
  app.applyFilters();
  app.setColorMode('type');
  app.openInsights(undefined, false);
}

const byCospar = (app: App, prefix: string, extraGroup?: string) => {
  const gi = extraGroup ? app.cat.groups.findIndex((g) => g.key === extraGroup) : -1;
  return new Set(app.universe.filter((o) => o.cospar.startsWith(prefix) || (gi >= 0 && o.groups.includes(gi))).map((o) => o.norad));
};
const find = (app: App, norad: number) => app.cat.byNorad.get(norad);
const shown = (app: App) => (app.history ? app.historyShown : app.visibleList.length);
const plural = (n: number, w: string) => `${fmtInt(n)} ${w}${n === 1 ? '' : 's'}`;

/** Current altitude (km) of an object from SGP4. */
function altitude(o: SatObject | undefined) {
  const rec = o ? satrecFor(o) : null;
  const st = rec ? stateAt(rec, Date.now()) : null;
  return st ? eciToGeodetic(st.position.x, st.position.y, st.position.z, gmst(Date.now())).alt : NaN;
}

const isActive = (o: SatObject) => o.type === 'P' && ['+', 'P', 'B', 'S', 'X'].includes(o.status);

// ---------- tours ----------
export const TOURS: Tour[] = [
  {
    id: 'fengyun',
    title: 'The Fengyun-1C debris cloud',
    blurb: 'How one missile test created the largest debris cloud on record.',
    steps: [
      {
        title: 'A weather satellite in polar orbit',
        run: async (app) => {
          await at(app, '2007-01-11T20:00:00Z');
          app.setFilters({ ids: byCospar(app, '1999-025', 'fengyun-1c-debris'), idsLabel: 'Fengyun-1C' });
          const fy = app.cat.objects.find((o) => o.cospar === '1999-025A');
          if (fy) app.select(fy, { fly: true });
        },
        text: () => 'January 2007. Fengyun-1C, a retired Chinese weather satellite, circles Earth in a sun-synchronous orbit about 850 km up — one of the most crowded altitudes in low Earth orbit.',
      },
      {
        title: 'The test',
        run: async (app) => {
          await at(app, '2007-01-12T00:26:00Z');
        },
        text: () => 'On 11 January 2007 China destroyed Fengyun-1C with a ground-launched missile. The satellite broke into thousands of fragments, each now on its own orbit.',
      },
      {
        title: 'A year later',
        run: async (app) => {
          app.select(null);
          await at(app, '2008-01-01T12:00:00Z');
          app.flyHome();
        },
        text: (app) =>
          `By January 2008, ${plural(shown(app), 'object')} from the break-up were being tracked. Because each fragment's orbit drifts at a slightly different rate, the cloud has already spread into a shell around the planet.`,
      },
      {
        title: 'Still there today',
        run: (app) => {
          live(app);
          app.setFilters({ ids: byCospar(app, '1999-025', 'fengyun-1c-debris'), idsLabel: 'Fengyun-1C' });
        },
        text: (app) => `Today ${plural(shown(app), 'tracked fragment')} from Fengyun-1C are still in orbit. At this altitude, many will stay up for decades.`,
      },
      {
        title: 'Reading a Gabbard diagram',
        run: (app) => app.openInsights('debris'),
        text: () =>
          "The Gabbard diagram plots each fragment's apogee (blue) and perigee (orange) against its orbital period. Pieces thrown forward climb into longer orbits; those thrown backward drop lower. That forms the X-shape centred on the original orbit — the signature of a break-up.",
      },
    ],
  },
  {
    id: 'iss',
    title: 'Building the ISS',
    blurb: 'From a single Russian module to a home in orbit for a quarter-century.',
    steps: [
      {
        title: 'Zarya',
        run: async (app) => {
          await at(app, '1998-11-22T12:00:00Z');
          app.setFilters({ ids: new Set([25544, 16609]), idsLabel: 'ISS and Mir' });
          const iss = find(app, 25544);
          if (iss) app.select(iss, { fly: true });
        },
        text: () =>
          "On 20 November 1998 a Proton rocket launched Zarya, the first module of the International Space Station. (The catalogue tracks the whole station as one object under Zarya's number, 25544.)",
      },
      {
        title: 'Unity',
        run: async (app) => {
          await at(app, '1998-12-08T12:00:00Z');
        },
        text: () => 'Two weeks later Space Shuttle Endeavour brought Unity, the first US module, and the crew joined it to Zarya — the first step in assembling the station in orbit.',
      },
      {
        title: 'Expedition 1 moves in',
        run: async (app) => {
          await at(app, '2000-11-02T12:00:00Z');
          app.select(null);
          app.flyHome();
        },
        text: (app) =>
          `On 2 November 2000 the first crew arrived, and the station has been continuously occupied ever since. Mir was still in orbit too, empty since June 2000; ${find(app, 16609) ? 'both stations are shown here.' : 'it was de-orbited in March 2001.'}`,
      },
      {
        title: 'Assembly complete',
        run: async (app) => {
          await at(app, '2011-07-21T12:00:00Z');
          const iss = find(app, 25544);
          if (iss) app.select(iss, { fly: true });
        },
        text: () => 'The last Space Shuttle mission landed on 21 July 2011; by then the US segment was essentially complete. More than 40 assembly flights built a station about the size of a football field.',
      },
      {
        title: 'Today',
        run: (app) => {
          live(app);
          const gi = app.cat.groups.findIndex((g) => g.key === 'stations');
          if (gi >= 0) app.setFilters({ ids: null, groups: new Set([gi]) });
          const iss = find(app, 25544);
          if (iss) app.select(iss, { fly: true });
        },
        text: (app) => {
          const iss = find(app, 25544);
          const alt = altitude(iss);
          return `Right now the ISS is ${Number.isFinite(alt) ? `${fmtInt(alt)} km up` : 'in orbit'}, circling Earth about ${iss ? fmt(iss.meanMotion, 1) : '15.5'} times a day. The highlighted group also shows China's Tiangong and the spacecraft visiting both stations.`;
        },
      },
    ],
  },
  {
    id: 'starlink',
    title: 'The Starlink era',
    blurb: 'How one constellation came to outnumber every other active satellite.',
    steps: [
      {
        title: 'The first 60',
        run: async (app) => {
          await at(app, '2019-05-26T12:00:00Z');
          app.setFilters({ query: 'starlink' });
          app.zoomTo(3.3);
        },
        text: (app) => `On 24 May 2019 a Falcon 9 released SpaceX's first 60 Starlink satellites. Two days later, ${plural(shown(app), 'Starlink object')} were in orbit.`,
      },
      {
        title: 'Mid-2020',
        run: async (app) => {
          await at(app, '2020-07-01T12:00:00Z');
        },
        text: (app) => `A year on: ${plural(shown(app), 'Starlink satellite')}. Launches of 60 at a time, every few weeks, were filling the first orbital shell around 550 km.`,
      },
      {
        title: 'Mid-2022',
        run: async (app) => {
          await at(app, '2022-07-01T12:00:00Z');
        },
        text: (app) => `July 2022: ${plural(shown(app), 'Starlink satellite')}, spread across several shells at different inclinations, including polar orbits for coverage at high latitudes.`,
      },
      {
        title: 'Mid-2024',
        run: async (app) => {
          await at(app, '2024-07-01T12:00:00Z');
        },
        text: (app) => `July 2024: ${plural(shown(app), 'Starlink satellite')}.`,
      },
      {
        title: 'Today',
        run: (app) => {
          live(app);
          app.setFilters({ query: 'starlink' });
          app.openInsights('debris');
        },
        text: (app) => {
          const all = app.cat.objects.slice(0, app.liveCount);
          const active = all.filter(isActive);
          const sl = active.filter((o) => /^STARLINK/.test(o.name));
          const share = active.length ? Math.round((sl.length / active.length) * 100) : 0;
          return `Today ${plural(app.visibleList.length, 'Starlink object')} are in orbit, and Starlink makes up ${share}% of all active payloads in the catalogue. The crowding chart shows the spike where its shells sit.`;
        },
      },
    ],
  },
  {
    id: 'crowded',
    title: 'How crowded is low Earth orbit?',
    blurb: 'Debris, density, and why collisions are the worry.',
    steps: [
      {
        title: 'Everything we track',
        run: (app) => {
          live(app);
          app.setColorMode('regime');
          app.zoomTo(5.5);
        },
        text: (app) => {
          const all = app.cat.objects.slice(0, app.liveCount);
          const leo = all.filter((o) => o.regime === 'LEO').length;
          return `${fmtInt(all.length)} objects in this catalogue, ${fmtInt(leo)} (${Math.round((leo / Math.max(1, all.length)) * 100)}%) of them in low Earth orbit — below 2,000 km, coloured blue here.`;
        },
      },
      {
        title: 'Most of it is junk',
        run: (app) => {
          app.setColorMode('type');
          app.setFilters({ types: new Set(['D', 'R']) });
        },
        text: (app) =>
          `${plural(app.visibleList.length, 'tracked object')} here are debris or spent rocket stages. These are only objects bigger than about 10 cm: ESA estimates there are around a million fragments between 1 and 10 cm, too small to track but big enough to destroy a satellite.`,
      },
      {
        title: 'Where it is densest',
        run: (app) => {
          app.setFilters({ types: new Set(['P', 'R', 'D', 'U']) });
          app.openInsights('debris');
        },
        text: () => "The crowding chart counts objects per billion cubic kilometres in 20 km shells. The tallest peaks are where collision risk concentrates — today around the big constellation shells, plus the 750–900 km band full of old debris.",
      },
      {
        title: '1990 for comparison',
        run: async (app) => {
          await at(app, '1990-01-01T12:00:00Z');
        },
        text: (app) => `On 1 January 1990, ${plural(app.historyShown, 'catalogued object')} were in orbit. Today the catalogue has ${fmtInt(app.liveCount)}.`,
      },
      {
        title: 'The Kessler syndrome',
        run: (app) => {
          live(app);
          app.openInsights(undefined, false);
          app.openWatch('conjunctions');
        },
        text: (app) => {
          const n = (app.conjunctions?.items ?? []).filter((c) => c.rangeKm < 1 && c.tcaMs > Date.now()).length;
          return `In 1978 NASA scientist Donald Kessler warned that debris could reach a density where collisions create debris faster than it decays, setting off a cascade. The Watch panel lists predicted close approaches${n ? ` — ${plural(n, 'pass')} within 1 km in the coming week` : ''}.`;
        },
      },
    ],
  },
];

// ---------- player ----------
export function mountTours(app: App) {
  const eyebrow = h('div', { class: 'eyebrow' });
  const counter = h('span', { class: 'tour-count' });
  const title = h('h3');
  const text = h('p');
  const dots = h('div', { class: 'tour-dots' });
  const prev = h('button', { class: 'btn' }, 'Back');
  const next = h('button', { class: 'btn primary' }, 'Next');
  const auto = h('button', { class: 'btn', title: 'Advance automatically' }, 'Auto ▸');
  const exit = h('button', { class: 'close', 'aria-label': 'Exit tour' }, icon(ICONS.close));
  const card = h(
    'div',
    { class: 'tour-card', hidden: true, role: 'dialog', 'aria-live': 'polite' },
    exit,
    h('div', { class: 'tour-top' }, eyebrow, counter),
    title,
    text,
    dots,
    h('div', { class: 'tour-actions' }, prev, auto, next),
  );
  document.getElementById('app')!.append(card);

  let tour: Tour | null = null;
  let index = 0;
  let token = 0;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let refresh: ReturnType<typeof setInterval> | undefined;
  let autoOn = false;

  async function go(i: number) {
    if (!tour) return;
    index = Math.max(0, Math.min(tour.steps.length - 1, i));
    const step = tour.steps[index];
    const my = ++token;
    eyebrow.textContent = tour.title;
    counter.textContent = `${index + 1} / ${tour.steps.length}`;
    title.textContent = step.title;
    text.textContent = '…';
    dots.replaceChildren(...tour.steps.map((_, k) => h('i', { class: k === index ? 'on' : k < index ? 'done' : '' })));
    prev.disabled = index === 0;
    next.textContent = index === tour.steps.length - 1 ? 'Finish' : 'Next';
    clearTimeout(autoTimer);
    await step.run(app);
    if (my !== token) return;
    // Counts settle as filters apply and snapshots load; keep the narration current.
    const say = () => my === token && (text.textContent = step.text(app));
    say();
    clearInterval(refresh);
    refresh = setInterval(say, 1000);
    if (autoOn) autoTimer = setTimeout(() => (index < tour!.steps.length - 1 ? go(index + 1) : stop()), 14000);
  }

  function start(t: Tour) {
    reset(app);
    tour = t;
    card.hidden = false;
    document.body.classList.add('touring');
    document.body.classList.remove('explorer-open');
    app.updateViewOffset();
    void go(0);
  }

  function stop() {
    token++;
    clearTimeout(autoTimer);
    clearInterval(refresh);
    tour = null;
    card.hidden = true;
    document.body.classList.remove('touring');
    app.updateViewOffset();
    live(app);
    reset(app);
    app.flyHome();
  }

  prev.onclick = () => go(index - 1);
  next.onclick = () => (tour && index === tour.steps.length - 1 ? stop() : go(index + 1));
  exit.onclick = stop;
  auto.onclick = () => {
    autoOn = !autoOn;
    auto.setAttribute('aria-pressed', String(autoOn));
    if (autoOn) void go(index);
    else clearTimeout(autoTimer);
  };
  window.addEventListener('keydown', (e) => {
    if (!tour || e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowRight') next.click();
    else if (e.key === 'ArrowLeft') prev.click();
    else if (e.key === 'Escape') stop();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  app.startTour = (id: string) => {
    const t = TOURS.find((x) => x.id === id);
    if (t) start(t);
  };
}
