import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './style.css';
import { App } from './app';
import { loadCatalog } from './data/catalog';
import { fmtInt } from './ui/dom';
import { mountExplorer } from './ui/explorer';
import { mountInfo } from './ui/info';
import { mountInsights } from './ui/insights';
import { mountHelp, mountKpis, mountLayers, mountLegend } from './ui/chrome';
import { mountTimeline } from './ui/timeline';
import { mountOverlay } from './ui/overlay';
import { mountWatch } from './ui/watch';
import { mountProfile } from './ui/profile';
import { mountTours } from './ui/tours';
import { mountCloseup } from './ui/closeup';
import { PassAlerts } from './ui/alerts';
import { isEmbed, mountEmbed } from './ui/embed';
import { mountPlatform, registerServiceWorker } from './ui/platform';
import { mountSkyView } from './ui/skyview';
import { mountIdentify } from './ui/identify';
import { loadConjunctions, loadLaunches } from './data/watch';
import { loadBreakups, loadManoeuvres } from './data/changes';
import { addEvents } from './data/events';
import { applyHash, mountShare, syncUrl } from './ui/share';
import { loadReentries } from './data/reentry';
import { loadMagnitudes } from './sim/brightness';

const stepEl = document.getElementById('loader-step')!;
const barEl = document.getElementById('loader-bar')!;
const progress = (frac: number, msg?: string) => {
  barEl.style.width = `${Math.round(frac * 100)}%`;
  if (msg) stepEl.textContent = msg;
};

const embed = isEmbed();
if (embed) document.body.classList.add('embed');
registerServiceWorker();

async function boot() {
  progress(0.02, 'Downloading orbital catalog…');
  const cat = await loadCatalog(`${import.meta.env.BASE_URL}data/catalog.json`, (f) => progress(0.05 + f * 0.6));
  progress(0.68, `Initialising SGP4 for ${fmtInt(cat.objects.length)} objects…`);

  const canvas = document.getElementById('globe') as HTMLCanvasElement;
  const app = new App(cat, canvas);
  (window as unknown as { app: App }).app = app;

  mountOverlay(app);
  mountCloseup(app);
  if (embed) {
    // The widget is just the globe: no panels, menus or alerts.
    mountEmbed(app);
    app.stage.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    app.stage.resize();
  } else {
    app.alerts = new PassAlerts(app);
    mountKpis(app);
    mountExplorer(app);
    mountInfo(app);
    mountTimeline(app);
    mountLegend(app);
    mountLayers(app);
    mountInsights(app);
    mountHelp(app);
    mountWatch(app);
    mountProfile(app);
    mountTours(app);
    mountSkyView(app);
    mountIdentify(app);
    mountShare(app);
    mountPlatform(app);
  }
  const data = (f: string) => `${import.meta.env.BASE_URL}data/${f}`;
  if (!embed) {
    loadReentries(data('reentry.json')).then((d) => app.setReentries(d));
    loadMagnitudes(data('magnitudes.json')).then((d) => d && d.mags.size && app.setMagnitudes(d));
    Promise.all([loadConjunctions(data('conjunctions.json')), loadLaunches(data('launches.json'))]).then(([c, l]) => app.setWatchData(c, l));
    Promise.all([loadManoeuvres(data('manoeuvres.json')), loadBreakups(data('breakups.json'))]).then(([m, b]) => {
      // Detected breakups join the history timeline.
      if (b?.available)
        addEvents(
          b.items.map((e) => ({
            at: e.first,
            title: `${e.parent?.name ?? e.cospar} breakup`,
            text: `Detected from a jump in catalogued debris: ${e.added.toLocaleString('en-US')} new pieces from launch ${e.cospar}.`,
            kind: 'debris' as const,
            launches: [e.cospar],
          })),
        );
      app.setChanges(m, b);
    });
  }
  if (cat.sample) document.getElementById('sample-banner')!.hidden = false;

  progress(0.8, 'Propagating orbits…');
  await Promise.all([app.prop.ready, app.earth.ready, firstSnapshot(app)]);
  progress(1, 'Ready');

  const loop = () => {
    app.frame();
    requestAnimationFrame(loop);
  };
  loop();

  document.getElementById('app')!.hidden = false;
  app.updateViewOffset();
  requestAnimationFrame(() => document.getElementById('loader')!.classList.add('done'));

  // Deep links: "#25544" or full view state ("#s=25544&g=stations&cam=…").
  window.addEventListener('hashchange', () => applyHash(app));
  setTimeout(() => {
    applyHash(app);
    syncUrl(app);
  }, 400);
}

function firstSnapshot(app: App) {
  return new Promise<void>((resolve) => {
    if (app.prop.version > 0) return resolve();
    app.prop.onUpdate(() => resolve());
  });
}

boot().catch((err) => {
  console.error(err);
  stepEl.textContent = `Could not load the catalog: ${err.message}`;
  stepEl.style.color = '#ff8b8b';
});
