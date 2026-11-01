import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { ALT_MAX, ALT_MIN, defaultFilters } from '../data/model';
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
  // A tour may have sped time up (Molniya); leave it at normal speed.
  if (app.clock.rate !== 1) app.clock.setRate(1);
}

const byCospar = (app: App, prefix: string, extraGroup?: string) => {
  const gi = extraGroup ? app.cat.groups.findIndex((g) => g.key === extraGroup) : -1;
  return new Set(app.universe.filter((o) => o.cospar.startsWith(prefix) || (gi >= 0 && o.groups.includes(gi))).map((o) => o.norad));
};
const find = (app: App, norad: number) => app.cat.byNorad.get(norad);
const shown = (app: App) => (app.history ? app.historyShown : app.filteredList.length);
const plural = (n: number, w: string) => `${fmtInt(n)} ${w}${n === 1 ? '' : 's'}`;

/** Current altitude (km) of an object from SGP4. */
function altitude(o: SatObject | undefined) {
  const rec = o ? satrecFor(o) : null;
  const st = rec ? stateAt(rec, Date.now()) : null;
  return st ? eciToGeodetic(st.position.x, st.position.y, st.position.z, gmst(Date.now())).alt : NaN;
}

const gIdx = (app: App, key: string) => app.cat.groups.findIndex((g) => g.key === key);
const inGroups = (app: App, ...keys: string[]) => {
  const gi = keys.map((k) => gIdx(app, k)).filter((i) => i >= 0);
  return app.universe.filter((o) => app.isLiveObject(o) && o.groups.some((g) => gi.includes(g)));
};
const named = (app: App, re: RegExp) => app.universe.filter((o) => app.isLiveObject(o) && re.test(o.name));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** How many of a set are above the horizon from a place (your location, else London). */
function aboveFrom(app: App, objs: SatObject[]) {
  const o = app.observer ?? { lat: 51.5, lon: -0.13, alt: 0, source: 'manual' as const };
  const t = app.clock.now();
  const g = gmst(t);
  const r = (d: number) => (d * Math.PI) / 180;
  // Observer position (spherical Earth is plenty here), ECI km.
  const th = g + r(o.lon);
  const R = 6371 + o.alt;
  const p = [R * Math.cos(r(o.lat)) * Math.cos(th), R * Math.cos(r(o.lat)) * Math.sin(th), R * Math.sin(r(o.lat))];
  let n = 0;
  for (const x of objs) {
    const rec = satrecFor(x);
    const st = rec ? stateAt(rec, t) : null;
    if (!st) continue;
    const d = [st.position.x - p[0], st.position.y - p[1], st.position.z - p[2]];
    if ((d[0] * p[0] + d[1] * p[1] + d[2] * p[2]) / (Math.hypot(...d) * R) > Math.sin(r(5))) n++;
  }
  return { n, where: app.observer ? 'above your horizon' : 'above the horizon in London' };
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
          return `Today ${plural(app.filteredList.length, 'Starlink object')} are in orbit, and Starlink makes up ${share}% of all active payloads in the catalogue. The crowding chart shows the spike where its shells sit.`;
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
          `${plural(app.filteredList.length, 'tracked object')} here are debris or spent rocket stages. These are only objects bigger than about 10 cm: ESA estimates there are around a million fragments between 1 and 10 cm, too small to track but big enough to destroy a satellite.`,
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
  {
    id: 'gps',
    title: 'How GPS works',
    blurb: 'Clocks in orbit, four at a time, and the four global systems.',
    steps: [
      {
        title: 'A constellation of clocks',
        run: (app) => {
          live(app);
          const gps = inGroups(app, 'gps-ops');
          app.setFilters({ ids: new Set(gps.map((o) => o.norad)), idsLabel: 'GPS' });
          app.zoomTo(11);
        },
        text: (app) => {
          const gps = inGroups(app, 'gps-ops');
          if (!gps.length) return 'GPS satellites fly about 20,200 km up in six orbital planes. (This catalogue has none listed right now.)';
          const alt = avg(gps.map((o) => (o.perigee + o.apogee) / 2));
          const per = avg(gps.map((o) => o.period));
          return `${plural(gps.length, 'GPS satellite')} fly about ${fmtInt(alt)} km up in six tilted planes, each going round in ${fmt(per / 60, 2)} hours. Every one carries atomic clocks and broadcasts the time and its own position, over and over.`;
        },
      },
      {
        title: 'Four at once',
        run: () => {},
        text: (app) => {
          const { n, where } = aboveFrom(app, inGroups(app, 'gps-ops'));
          return `A receiver times the signals from several satellites. Each delay gives a distance; three distances fix a point, and a fourth corrects the receiver's own cheap clock. Right now ${plural(n, 'GPS satellite')} ${n === 1 ? 'is' : 'are'} ${where} (5° or higher).`;
        },
      },
      {
        title: 'The same track every day',
        run: (app) => {
          const gps = inGroups(app, 'gps-ops');
          if (gps[0]) app.select(gps[0], { fly: true });
        },
        text: () =>
          "Two orbits take one sidereal day (23 h 56 min), so each satellite's ground track repeats daily and appears four minutes earlier each day. The track drawn on the globe is the path it will trace again tomorrow.",
      },
      {
        title: 'Four global systems',
        run: (app) => {
          app.select(null);
          const all = inGroups(app, 'gps-ops', 'glo-ops', 'galileo', 'beidou');
          app.setFilters({ ids: new Set(all.map((o) => o.norad)), idsLabel: 'GNSS' });
          app.setColorMode('owner');
          app.zoomTo(13);
        },
        text: (app) => {
          const c = (k: string) => inGroups(app, k).length;
          return `GPS (${c('gps-ops')}) is joined by Russia's GLONASS (${c('glo-ops')}), Europe's Galileo (${c('galileo')}) and China's BeiDou (${c('beidou')}). Phones use all of them, which is why a fix comes quickly even between tall buildings.`;
        },
      },
      {
        title: 'Relativity, every day',
        run: () => {},
        text: () =>
          "In weaker gravity the satellites' clocks tick faster, and their speed slows them slightly; together they gain about 38 microseconds a day. Uncorrected, that would add some 10 km of error daily — so GPS works only because Einstein was right.",
      },
    ],
  },
  {
    id: 'molniya',
    title: 'Molniya and Tundra orbits',
    blurb: 'Stretched orbits that hang over the north for hours.',
    steps: [
      {
        title: 'A problem with geostationary',
        run: (app) => {
          live(app);
          app.setFilters({ regimes: new Set(['GEO']) });
          app.flyToLatLon(65, 60, 9);
        },
        text: () =>
          "Geostationary satellites sit over the equator, so from the far north they're low on the horizon or below it. The Soviet Union, with most of its territory above 50°N, needed another way to reach its own people.",
      },
      {
        title: 'Molniya: 12 hours, mostly at the top',
        run: (app) => {
          const m = inGroups(app, 'molniya');
          const list = m.length ? m : named(app, /^MOLNIYA/);
          app.setFilters({ ids: new Set(list.map((o) => o.norad)), idsLabel: 'Molniya' });
          if (list[0]) app.select(list[0], { fly: false });
          app.zoomTo(16);
        },
        text: (app) => {
          const m = inGroups(app, 'molniya');
          const list = m.length ? m : named(app, /^MOLNIYA/);
          const o = list[0];
          return `A Molniya orbit swings from a few hundred km up to about 40,000 km, with the high point over the north${o ? ` (${o.name}: ${fmtInt(o.perigee)} to ${fmtInt(o.apogee)} km)` : ''}. Satellites crawl near the top, so each one serves the north for about eight hours of its 12-hour orbit.`;
        },
      },
      {
        title: 'Watch it hang',
        run: (app) => {
          app.clock.setRate(900);
        },
        text: () => 'Time is running 900× faster. See how it races through the low point in minutes, then lingers high over the northern hemisphere. Three satellites spaced along the orbit give round-the-clock coverage.',
      },
      {
        title: 'The magic 63.4°',
        run: () => {},
        text: () =>
          "Earth's equatorial bulge normally twists an orbit's long axis around, which would soon move the high point south. At an inclination of 63.4° that twisting stops — the 'critical inclination' — so the apogee stays put over the north.",
      },
      {
        title: 'Tundra and QZSS',
        run: (app) => {
          app.clock.setRate(1);
          const q = named(app, /^(QZS|MICHIBIKI|TUNDRA|SIRIUS)/);
          app.setFilters({ ids: new Set(q.map((o) => o.norad)), idsLabel: 'Tundra / QZSS' });
          app.select(null);
          app.flyToLatLon(35, 135, 12);
        },
        text: (app) => {
          const q = named(app, /^(QZS|MICHIBIKI|TUNDRA|SIRIUS)/);
          return `A Tundra orbit does the same trick in 24 hours, tracing a figure-eight over one region. Japan's QZSS (Michibiki) uses tilted, slightly stretched geosynchronous orbits so one satellite is always high over Japan's cities, boosting GPS where buildings block the sky${q.length ? ` (${plural(q.length, 'satellite')} here)` : ''}.`;
        },
      },
    ],
  },
  {
    id: 'race',
    title: 'The space race in orbit',
    blurb: 'From Sputnik to Apollo–Soyuz, as it filled the sky.',
    steps: [
      {
        title: 'Sputnik',
        run: async (app) => {
          await at(app, '1957-10-05T12:00:00Z');
          app.setFilters({ ids: byCospar(app, '1957-001'), idsLabel: 'Sputnik 1' });
          app.zoomTo(4.2);
        },
        text: () => 'On 4 October 1957 the Soviet Union put Sputnik 1 in orbit, with its rocket stage close behind. Visible to the eye, the stage made the point to everyone: the race was on.',
      },
      {
        title: 'Gagarin',
        run: async (app) => {
          await at(app, '1961-04-12T06:30:00Z');
          app.setFilters({ ids: byCospar(app, '1961-012'), idsLabel: 'Vostok 1' });
        },
        text: (app) => `12 April 1961: Yuri Gagarin made one orbit in Vostok 1. By then ${plural(app.historyShown, 'object')} were in orbit — most of them American.`,
      },
      {
        title: 'Walking in space',
        run: async (app) => {
          await at(app, '1965-06-03T18:00:00Z');
          app.setFilters({ ids: null, idsLabel: '' });
        },
        text: (app) =>
          `In March 1965 Alexei Leonov made the first spacewalk; Ed White followed from Gemini 4 in June. The catalogue had reached ${plural(app.historyShown, 'object')}, as both sides learned to rendezvous, dock and stay up for days.`,
      },
      {
        title: 'Apollo leaves Earth orbit',
        run: async (app) => {
          await at(app, '1969-07-16T14:30:00Z');
          app.setFilters({ ids: byCospar(app, '1969-059'), idsLabel: 'Apollo 11' });
        },
        text: () => 'On 16 July 1969 Apollo 11 spent one and a half orbits in a parking orbit, then fired for the Moon. Nothing from the landing itself is in Earth orbit: this is the third stage and debris left behind, if catalogued.',
      },
      {
        title: 'A handshake',
        run: async (app) => {
          await at(app, '1975-07-17T16:00:00Z');
          app.setFilters({ ids: null, idsLabel: '' });
          app.zoomTo(4.8);
        },
        text: (app) => `July 1975: an Apollo and a Soyuz docked and their crews shook hands, ending the race. ${fmtInt(app.historyShown)} objects were in orbit, up from 2 at the start.`,
      },
    ],
  },
  {
    id: 'hubble',
    title: "Hubble's servicing missions",
    blurb: 'Five Shuttle visits to repair and upgrade a telescope in orbit.',
    steps: [
      {
        title: 'Launch, and a flaw',
        run: async (app) => {
          await at(app, '1990-04-26T12:00:00Z');
          const hst = find(app, 20580);
          if (hst) app.select(hst, { fly: true });
        },
        text: () => 'Discovery left Hubble about 615 km up on 25 April 1990. Its first images were blurred: the main mirror had been ground to the wrong shape, by about a fiftieth of a hair’s width.',
      },
      {
        title: '1993: glasses for a telescope',
        run: async (app) => {
          await at(app, '1993-12-05T12:00:00Z');
          const hst = find(app, 20580);
          if (hst) app.select(hst, { fly: true });
        },
        text: () => 'In December 1993 Endeavour’s crew made five spacewalks to fit corrective optics and a new camera. Hubble has seen sharply ever since.',
      },
      {
        title: '1997–2002: upgrades',
        run: async (app) => {
          await at(app, '2002-03-07T12:00:00Z');
          const hst = find(app, 20580);
          if (hst) app.select(hst, { fly: true });
        },
        text: () => 'Three more missions in 1997, 1999 and 2002 swapped gyroscopes, computers and solar arrays, and added new instruments, each time also boosting the telescope a little higher.',
      },
      {
        title: '2009: the last visit',
        run: async (app) => {
          await at(app, '2009-05-16T12:00:00Z');
          const hst = find(app, 20580);
          if (hst) app.select(hst, { fly: true });
        },
        text: () => 'Atlantis made the final servicing mission in May 2009, with new cameras and batteries and a docking ring for a future visitor. After the Shuttle retired, nothing could reach Hubble again.',
      },
      {
        title: 'Slowly coming down',
        run: (app) => {
          live(app);
          const hst = find(app, 20580);
          if (hst) {
            app.select(hst, { fly: true });
            if (app.canCloseup(hst)) setTimeout(() => app.selected === hst && app.enterCloseup(hst), 2500);
          }
        },
        text: (app) => {
          const a = altitude(find(app, 20580));
          return `Hubble is ${Number.isFinite(a) ? `about ${fmtInt(a)} km up now` : 'lower now'}, sinking as the thin upper atmosphere drags on it. Without a boost it will re-enter some time in the 2030s; here it is up close, in its true attitude.`;
        },
      },
    ],
  },
  {
    id: 'kessler',
    title: 'Kessler syndrome scenarios',
    blurb: 'Collisions, weapons tests, and how a cascade could start.',
    steps: [
      {
        title: 'The first accidental collision',
        run: async (app) => {
          await at(app, '2009-02-10T16:50:00Z');
          const a = find(app, 24946);
          const b = find(app, 22675);
          if (a && b) {
            app.setPair({ a, b, label: 'Iridium 33 × Cosmos 2251', tca: Date.parse('2009-02-10T16:56:00Z') });
            app.select(a, { fly: true });
          }
        },
        text: () => 'On 10 February 2009, a working Iridium satellite and a dead Russian Cosmos met at about 11.7 km/s, 790 km over Siberia. Neither operator knew it was coming.',
      },
      {
        title: 'Two clouds of debris',
        run: (app) => {
          live(app);
          app.setPair(null);
          app.select(null);
          const d = inGroups(app, 'iridium-33-debris', 'cosmos-2251-debris');
          app.setFilters({ ids: new Set(d.map((o) => o.norad)), idsLabel: 'Iridium–Cosmos debris' });
          app.flyHome();
        },
        text: (app) => `${plural(inGroups(app, 'iridium-33-debris', 'cosmos-2251-debris').length, 'tracked fragment')} from that one collision are still in orbit today, spread around the whole planet.`,
      },
      {
        title: 'Debris on purpose',
        run: (app) => {
          const d = inGroups(app, 'cosmos-1408-debris');
          app.setFilters({ ids: new Set(d.map((o) => o.norad)), idsLabel: 'Cosmos 1408 debris' });
        },
        text: (app) =>
          `Anti-satellite tests add more. In November 2021 Russia destroyed Cosmos 1408 about 480 km up, and the ISS crew sheltered in their capsules. ${plural(inGroups(app, 'cosmos-1408-debris').length, 'catalogued piece')} remain; at that height most have already fallen back.`,
      },
      {
        title: 'The band to worry about',
        run: (app) => {
          app.setFilters({ ids: null, idsLabel: '', types: new Set(['D', 'R']), altMin: 700, altMax: 1000 });
          app.openInsights('debris');
        },
        text: (app) =>
          `Here are the ${plural(app.filteredList.length, 'debris fragment and spent stage')} between 700 and 1,000 km. Up here drag takes centuries to clear things, and studies suggest collisions among what's already there would keep adding fragments even if no one launched again.`,
      },
      {
        title: 'Slowing the cascade',
        run: (app) => {
          app.openInsights(undefined, false);
          app.setFilters({ types: new Set(['P', 'R', 'D', 'U']), altMin: ALT_MIN, altMax: ALT_MAX });
          app.openWatch('reentry');
        },
        text: () =>
          'The fixes: move out of the way (operators dodge thousands of predicted close approaches a year), bring dead satellites down within five years rather than the old 25, keep rocket stages out of crowded orbits, and one day remove the largest wrecks. The Watch panel shows what is coming down now.',
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
    // Tours drive the globe camera.
    app.exitSkyView();
    if (app.closeup.active) app.exitCloseup();
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
