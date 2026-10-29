import type { App } from '../app';

export function fmtCountdown(ms: number) {
  const past = ms < 0;
  let s = Math.abs(ms) / 1000;
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const hh = Math.floor(s / 3600);
  s -= hh * 3600;
  const mm = Math.floor(s / 60);
  const txt = d > 0 ? `${d} d ${hh} h` : hh > 0 ? `${hh} h ${mm} min` : `${mm} min`;
  return past ? `${txt} ago` : `in ${txt}`;
}

export function fmtUncertainty(ms: number) {
  const h = ms / 3600e3;
  if (h < 1) return `±${Math.round(ms / 60e3)} min`;
  if (h < 48) return `±${Math.round(h)} h`;
  return `±${Math.round(h / 24)} d`;
}

/** "Watch its last day": history mode just before a re-entry, playing slowly. */
export function watchReentry(app: App, norad: number, decayIso: string) {
  const decay = Date.parse(decayIso.length === 10 ? decayIso + 'T12:00:00Z' : decayIso);
  app.select(null);
  app.setHistory({ cutoff: decay - 1.5 * 86400e3, playing: true, speed: (12 * 3600e3) / 1000 });
  const sel = () => {
    const o = app.cat.byNorad.get(norad);
    if (!o) return false;
    // Trust the object's own re-entry date once history data is loaded.
    if (o.decay && app.history) app.setHistory({ cutoff: Date.parse(o.decay + 'T12:00:00Z') - 1.5 * 86400e3 });
    app.select(o, { fly: true });
    return true;
  };
  if (!sel()) {
    const off = app.on('history', () => {
      if (app.historyStatus === 'loading') return;
      off();
      sel();
    });
  }
}
