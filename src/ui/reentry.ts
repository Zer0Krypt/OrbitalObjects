import type { App } from '../app';
import { TYPE_LABEL, type ObjectType, type SatObject } from '../data/catalog';
import { ownerName } from '../data/codes';
import { uncertaintyMs, type ReentryPrediction } from '../data/reentry';
import { $, fmtDate, fmtKm, fmtUtc, h } from './dom';

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

export function mountReentry(app: App) {
  const btn = $('#btn-reentry');
  const badge = btn.querySelector('.count-badge') as HTMLElement;
  const list = h('div', { class: 'rw-list' });
  const recent = h('div', { class: 'rw-list' });
  const sub = h('p', { class: 'rw-sub' });
  const showAll = h('button', { class: 'btn' }, 'Show these on the globe');
  const panel = h(
    'div',
    { class: 'reentry-panel', hidden: true, role: 'dialog', 'aria-label': 'Re-entry watch' },
    h('div', { class: 'rw-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Re-entry watch'), sub), showAll),
    h('div', { class: 'scroll rw-body' }, h('h4', { class: 'rw-h' }, 'Coming down'), list, h('h4', { class: 'rw-h' }, 'Re-entered in the last 30 days'), recent),
    h(
      'p',
      { class: 'rw-foot' },
      'Predictions from the U.S. Space Force via Space-Track.org. Early predictions are uncertain — roughly ±20% of the time remaining — and narrow to a final Tracking & Impact Prediction (TIP) shortly before re-entry.',
    ),
  );
  document.getElementById('app')!.append(panel);

  const upcomingObjs = () => (app.reentry?.upcoming ?? []).filter((u) => u.decayMs > Date.now() - 6 * 3600e3);

  function lowestOrbits(): SatObject[] {
    return app.cat.objects
      .slice(0, app.liveCount)
      .filter((o) => app.prop.valid[o.idx] && o.perigee < 260)
      .sort((a, b) => a.perigee - b.perigee)
      .slice(0, 15);
  }

  function row(p: ReentryPrediction) {
    const o = app.cat.byNorad.get(p.norad);
    const now = Date.now();
    const color = o ? app.colorsHex[o.idx] : '#7d8394';
    const meta = o ? `${p.norad} · ${TYPE_LABEL[o.type]} · ${ownerName(o.owner)}` : `${p.norad}${p.cospar ? ' · ' + p.cospar : ''}`;
    return h(
      'button',
      {
        class: 'rw-row' + (p.decayMs - now < 86400e3 ? ' soon' : ''),
        disabled: !o,
        title: o ? 'Show on the globe' : 'Not in the current catalogue',
        onclick: () => {
          if (!o) return;
          app.exitHistory();
          open(false);
          app.select(o, { fly: true });
        },
      },
      h('i', { class: 'd', style: `background:${color};color:${color}` }),
      h(
        'span',
        { class: 't' },
        h('b', null, p.name, p.source === 'tip' ? h('em', { class: 'tag tip', title: 'Final Tracking & Impact Prediction' }, 'TIP') : null, p.tip?.highInterest ? h('em', { class: 'tag hi' }, 'High interest') : null),
        h('span', null, meta),
      ),
      h('span', { class: 'r' }, h('b', { 'data-cd': String(p.decayMs) }, fmtCountdown(p.decayMs - now)), h('small', null, `${fmtUtc(p.decayMs, false).slice(5)} UTC ${fmtUncertainty(uncertaintyMs(p, now))}`)),
    );
  }

  function render() {
    const d = app.reentry;
    const up = upcomingObjs();
    const soon = up.filter((u) => u.decayMs - Date.now() < 7 * 86400e3).length;
    badge.hidden = !soon;
    badge.textContent = String(soon);
    if (!d) {
      sub.textContent = 'Re-entry data is unavailable right now.';
      list.replaceChildren();
      recent.replaceChildren();
      showAll.hidden = true;
      return;
    }
    sub.textContent = `${d.predictions ? `${up.length} predicted` : 'No predictions in this build'} · updated ${fmtDate(d.generated.slice(0, 10))}${d.sample ? ' · sample data' : ''}`;
    if (d.predictions) {
      list.replaceChildren(...(up.length ? up.map(row) : [h('p', { class: 'rw-empty' }, 'No re-entries are currently predicted.')]));
      showAll.hidden = !up.length;
    } else {
      // Without Space-Track there are no predictions; show the lowest orbits instead.
      const low = lowestOrbits();
      list.replaceChildren(
        h('p', { class: 'rw-empty' }, 'Predictions need Space-Track data (see the README). Meanwhile, these are the lowest orbits right now — the objects most likely to come down soon.'),
        ...low.map((o) =>
          h(
            'button',
            { class: 'rw-row', onclick: () => (open(false), app.select(o, { fly: true })) },
            h('i', { class: 'd', style: `background:${app.colorsHex[o.idx]};color:${app.colorsHex[o.idx]}` }),
            h('span', { class: 't' }, h('b', null, o.name), h('span', null, `${o.norad} · ${TYPE_LABEL[o.type]}`)),
            h('span', { class: 'r' }, h('b', null, `${fmtKm(o.perigee)} km`), h('small', null, 'perigee')),
          ),
        ),
      );
      showAll.hidden = true;
    }
    recent.replaceChildren(
      ...(d.recent.length
        ? d.recent.slice(0, 40).map((r) =>
            h(
              'button',
              { class: 'rw-row', title: 'Replay its last day in history mode', onclick: () => (open(false), watchReentry(app, r.norad, r.decay)) },
              h('i', { class: 'd gone' }),
              h('span', { class: 't' }, h('b', null, r.name), h('span', null, `${r.norad} · ${TYPE_LABEL[(r.type as ObjectType) || 'U'] ?? r.type} · ${ownerName(r.owner)}`)),
              h('span', { class: 'r' }, h('b', null, fmtDate(r.decay)), h('small', null, 'replay ▸')),
            ),
          )
        : [h('p', { class: 'rw-empty' }, 'None recorded in the last 30 days.')]),
    );
  }

  showAll.onclick = () => {
    const ids = new Set(upcomingObjs().map((u) => u.norad));
    app.exitHistory();
    app.select(null);
    app.setFilters({ ids, idsLabel: 'Re-entry watch' });
    app.flyHome();
    open(false);
  };

  const open = (v: boolean) => {
    panel.hidden = !v;
    btn.setAttribute('aria-pressed', String(v));
    if (v) render();
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    open(!!panel.hidden);
  };
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) open(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'r' || e.key === 'R') open(!!panel.hidden);
    if (e.key === 'Escape' && !panel.hidden) open(false);
  });
  // Live countdowns
  setInterval(() => {
    if (panel.hidden) return;
    for (const el of panel.querySelectorAll<HTMLElement>('[data-cd]')) el.textContent = fmtCountdown(Number(el.dataset.cd) - Date.now());
  }, 1000);

  app.on('reentry', render);
  app.on('colors', () => !panel.hidden && render());
  render();
}
