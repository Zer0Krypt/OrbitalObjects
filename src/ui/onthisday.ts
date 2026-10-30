import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { EVENT_COLORS, EVENTS, type SpaceEvent } from '../data/events';
import extra from '../data/onthisday.json';
import { h, icon, ICONS } from './dom';

const DAY_KEY = 'oo:onthisday-hidden';
const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' });
const md = (iso: string) => iso.slice(5, 10);

type Item = { year: number; title: string; text: string; color: string; go: () => void; goLabel: string };

/** Groups whose members make good anniversaries. */
const NOTABLE = new Set(['stations', 'science', 'visual', 'gnss', 'gps-ops', 'weather', 'geodetic', 'engineering', 'education', 'amateur']);

/**
 * "On this day": a highlight from the timeline and a list of famous dates,
 * else a launch anniversary from the catalogue, with a one-click jump.
 */
export function mountOnThisDay(app: App) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const key = md(today);
  const year = now.getUTCFullYear();

  const items: Item[] = [];
  const events = [...EVENTS, ...(extra as SpaceEvent[])].filter((e) => md(e.at) === key && Number(e.at.slice(0, 4)) < year);
  for (const e of events.sort((a, b) => (a.at < b.at ? -1 : 1))) {
    const live = e.focus ? app.cat.objects.find((o) => o.cospar === e.focus && app.isLiveObject(o)) : undefined;
    items.push({
      year: Number(e.at.slice(0, 4)),
      title: e.title,
      text: e.text,
      color: EVENT_COLORS[e.kind],
      goLabel: live ? `Show ${live.name.replace(/\s*\(.*\)$/, '')}` : `Go to ${e.at.slice(0, 4)}`,
      go: () => {
        if (live) {
          app.exitHistory();
          app.select(live, { fly: true });
        } else app.openEvent(e);
      },
    });
  }
  // From the catalogue: objects still in orbit launched on this date, the
  // notable and round-number anniversaries first.
  const gi = new Set(app.cat.groups.map((g, i) => (NOTABLE.has(g.key) ? i : -1)).filter((i) => i >= 0));
  const byLaunch = new Map<string, { o: SatObject; score: number }>();
  for (const o of app.cat.objects.slice(0, app.liveCount)) {
    if (o.type !== 'P' || !o.launch || md(o.launch) !== key || !o.launchYear || o.launchYear >= year) continue;
    const age = year - o.launchYear;
    let score = age * 0.03 + (o.groups.some((g) => gi.has(g)) ? 3 : 0) + (age % 10 === 0 ? 2 : age % 5 === 0 ? 1 : 0);
    if (/^(STARLINK|ONEWEB|FLOCK|LEMUR|KUIPER|QIANFAN|SPACEBEE)/.test(o.name)) score -= 6;
    const k = o.cospar.slice(0, 8);
    const cur = byLaunch.get(k);
    if (!cur || score > cur.score) byLaunch.set(k, { o, score });
  }
  for (const { o } of [...byLaunch.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(1, 4 - items.length))) {
    const age = year - o.launchYear!;
    items.push({
      year: o.launchYear!,
      title: `${o.name} launched`,
      text: `${age} year${age === 1 ? '' : 's'} ago today, and still in orbit at about ${Math.round((o.perigee + o.apogee) / 2).toLocaleString('en-US')} km.`,
      color: app.colorsHex[o.idx],
      goLabel: 'Show it',
      go: () => {
        app.exitHistory();
        app.select(o, { fly: true });
      },
    });
  }

  let hidden = false;
  try {
    hidden = localStorage.getItem(DAY_KEY) === today;
  } catch {
    /* private mode */
  }
  const el = h('div', { class: 'section otd', hidden: hidden || !items.length });
  let k = 0;
  function render() {
    const it = items[k];
    const next = h('button', { class: 'link', hidden: items.length < 2, onclick: () => ((k = (k + 1) % items.length), render()) }, `Next (${k + 1}/${items.length})`);
    const close = h(
      'button',
      {
        class: 'icon-mini',
        title: 'Hide until tomorrow',
        'aria-label': 'Hide On this day until tomorrow',
        onclick: () => {
          el.hidden = true;
          try {
            localStorage.setItem(DAY_KEY, today);
          } catch {
            /* private mode */
          }
        },
      },
      icon(ICONS.close),
    );
    el.style.setProperty('--ev', it.color);
    el.replaceChildren(
      h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, `On this day · ${dayFmt.format(now)}`), close),
      h('div', { class: 'otd-card' }, h('b', { class: 'otd-year' }, String(it.year)), h('div', null, h('b', null, it.title), h('p', null, it.text))),
      h('div', { class: 'otd-actions' }, h('button', { class: 'btn', onclick: it.go }, it.goLabel, ' ›'), next),
    );
  }
  if (items.length) render();
  return el;
}
