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
import { loadConjunctions, loadLaunches } from './data/watch';
import { applyHash, mountShare, syncUrl } from './ui/share';
import { loadReentries } from './data/reentry';

const stepEl = document.getElementById('loader-step')!;
const barEl = document.getElementById('loader-bar')!;
const progress = (frac: number, msg?: string) => {
  barEl.style.width = `${Math.round(frac * 100)}%`;
  if (msg) stepEl.textContent = msg;
};

async function boot() {
  progress(0.02, 'Downloading orbital catalog…');
  const cat = await loadCatalog(`${import.meta.env.BASE_URL}data/catalog.json`, (f) => progress(0.05 + f * 0.6));
  progress(0.68, `Initialising SGP4 for ${fmtInt(cat.objects.length)} objects…`);

  const canvas = document.getElementById('globe') as HTMLCanvasElement;
  const app = new App(cat, canvas);
  (window as unknown as { app: App }).app = app;

  mountKpis(app);
  mountExplorer(app);
  mountInfo(app);
  mountTimeline(app);
  mountLegend(app);
  mountLayers(app);
  mountInsights(app);
  mountHelp(app);
  mountOverlay(app);
  mountWatch(app);
  mountProfile(app);
  mountTours(app);
  mountShare(app);
  const data = (f: string) => `${import.meta.env.BASE_URL}data/${f}`;
  loadReentries(data('reentry.json')).then((d) => app.setReentries(d));
  Promise.all([loadConjunctions(data('conjunctions.json')), loadLaunches(data('launches.json'))]).then(([c, l]) => app.setWatchData(c, l));
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
