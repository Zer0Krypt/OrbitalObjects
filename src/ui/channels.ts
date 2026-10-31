import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { passesToIcs, visiblePasses, type PassEvent } from './alerts';
import { h } from './dom';
import { alertSchedule, workerConfigured, workerUrl } from './push';
import { skyTool } from './skytools';

/**
 * Alerts anywhere: the same pass alerts as the bell, sent by the push worker
 * to an ntfy topic, a Discord or Slack webhook, or kept as a calendar feed
 * you subscribe to. The browser works out the passes; each channel is
 * resynced whenever the site is opened (and expires after 9 days without one).
 */
type Kind = 'ntfy' | 'discord' | 'slack' | 'calendar';
interface Saved {
  url: string;
  id: string;
  token: string;
}
const KEY = 'oo:channels';
const load = (): Partial<Record<Kind, Saved>> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};
const save = (v: Partial<Record<Kind, Saved>>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};

const KINDS: { kind: Kind; label: string; placeholder: string; help: string }[] = [
  { kind: 'ntfy', label: 'ntfy', placeholder: 'ntfy.sh/your-topic', help: 'Free phone notifications: install the ntfy app and subscribe to a topic name only you know.' },
  { kind: 'discord', label: 'Discord', placeholder: 'https://discord.com/api/webhooks/…', help: 'Server Settings → Integrations → Webhooks → New Webhook → Copy URL.' },
  { kind: 'slack', label: 'Slack', placeholder: 'https://hooks.slack.com/services/…', help: 'An Incoming Webhook URL from a Slack app in your workspace.' },
];

const normalise = (kind: Kind, v: string) => {
  let t = v.trim();
  if (kind === 'ntfy' && t && !/^https?:\/\//.test(t)) t = `https://${t.includes('/') ? t : `ntfy.sh/${t}`}`;
  return t;
};

/** Calendar of the next week's visible passes: alerted objects, else My satellites. */
function calendarIcs(app: App) {
  if (!app.observer) return null;
  const ids = new Set([...(app.alerts?.list ?? []), ...(app.alerts?.list.length ? [] : app.watchlist)]);
  const objs = [...ids].map((n) => app.cat.byNorad.get(n)).filter((o): o is SatObject => !!o && app.isLiveObject(o));
  const events: PassEvent[] = [];
  for (const o of objs.slice(0, 40)) for (const p of visiblePasses(app, o, Date.now(), 7)) events.push({ o, p });
  return passesToIcs(events.sort((a, b) => a.p.rise - b.p.rise).slice(0, 200), app.observer);
}

async function push(app: App, kind: Kind, s: Saved | undefined, url: string) {
  const body: Record<string, unknown> = { channel: { kind, url }, id: s?.id, token: s?.token };
  if (kind === 'calendar') body.ics = calendarIcs(app) ?? undefined;
  else body.alerts = alertSchedule(app);
  const r = await fetch(`${workerUrl()}/channel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status === 400 ? 'that address isn’t accepted' : `push service ${r.status}`);
  const d = (await r.json()) as { id: string; token: string; scheduled?: number };
  return { saved: { url, id: d.id, token: d.token }, scheduled: d.scheduled ?? 0 };
}

export function mountChannels(app: App) {
  const t = skyTool('Alerts anywhere', 'ntfy, Discord, Slack or a calendar feed');
  if (!workerConfigured()) {
    t.el.hidden = true;
    return t.el;
  }
  const status = h('p', { class: 'sky-hint', style: 'margin:0' });
  const rows: HTMLElement[] = [];
  let state = load();

  async function syncAll() {
    state = load();
    for (const k of Object.keys(state) as Kind[]) {
      try {
        const r = await push(app, k, state[k], state[k]!.url);
        state[k] = r.saved;
      } catch {
        /* keep the old one; try again next time */
      }
    }
    save(state);
  }

  for (const { kind, label, placeholder, help } of KINDS) {
    const input = h('input', { type: 'text', placeholder, 'aria-label': `${label} address`, value: state[kind]?.url ?? '' });
    const saveBtn = h('button', { class: 'btn' }, state[kind] ? 'Update' : 'Turn on');
    const off = h('button', { class: 'btn', hidden: !state[kind] }, 'Turn off');
    saveBtn.onclick = async () => {
      const url = normalise(kind, input.value);
      if (!url) return;
      saveBtn.disabled = true;
      try {
        const r = await push(app, kind, state[kind], url);
        state[kind] = r.saved;
        save(state);
        input.value = url;
        off.hidden = false;
        saveBtn.textContent = 'Update';
        status.textContent = `${label}: ${r.scheduled} alert${r.scheduled === 1 ? '' : 's'} scheduled for the next week${app.alerts?.list.length ? '' : ' — turn on “Alert me” for some objects first'}.`;
      } catch (err) {
        status.textContent = `${label}: couldn’t turn on — ${(err as Error).message}.`;
      }
      saveBtn.disabled = false;
    };
    off.onclick = async () => {
      const s = state[kind];
      if (s) await fetch(`${workerUrl()}/channel/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, token: s.token }) }).catch(() => {});
      delete state[kind];
      save(state);
      off.hidden = true;
      saveBtn.textContent = 'Turn on';
      status.textContent = `${label} alerts are off.`;
    };
    rows.push(h('div', { class: 'ch-row' }, h('label', null, h('span', null, label), input), h('div', { class: 'sky-actions' }, saveBtn, off), h('small', null, help)));
  }

  // Calendar feed.
  const calLink = h('a', { class: 'mono ch-cal', target: '_blank', rel: 'noopener' });
  const calCopy = h('button', { class: 'btn', hidden: true }, 'Copy link');
  const calBtn = h('button', { class: 'btn' }, state.calendar ? 'Remove feed' : 'Create calendar feed');
  const calUrl = (s: Saved) => `${workerUrl()}/cal/${s.id}.ics`;
  const syncCal = () => {
    const s = state.calendar;
    calLink.hidden = calCopy.hidden = !s;
    if (s) {
      calLink.textContent = calUrl(s);
      calLink.href = calUrl(s).replace(/^https?:/, 'webcal:');
    }
    calBtn.textContent = s ? 'Remove feed' : 'Create calendar feed';
  };
  calCopy.onclick = () => state.calendar && navigator.clipboard?.writeText(calUrl(state.calendar)).catch(() => {});
  calBtn.onclick = async () => {
    if (state.calendar) {
      const s = state.calendar;
      await fetch(`${workerUrl()}/channel/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, token: s.token }) }).catch(() => {});
      delete state.calendar;
      save(state);
      syncCal();
      return;
    }
    try {
      const r = await push(app, 'calendar', undefined, '');
      state.calendar = r.saved;
      save(state);
      syncCal();
      status.textContent = 'Subscribe to this link in your calendar app (not “import”): it fills with the next week’s visible passes of your alerted satellites, and refreshes each time you open this site.';
    } catch (err) {
      status.textContent = `Couldn’t create the feed: ${(err as Error).message}.`;
    }
  };
  syncCal();

  t.body.append(
    h('p', { class: 'sky-hint', style: 'margin:0 0 6px' }, 'Send the same pass alerts as “Alert me” (5 minutes before each visible pass) somewhere else. A small push service sends them; it keeps the address and the alert texts until they go out.'),
    ...rows,
    h('div', { class: 'ch-row' }, h('label', null, h('span', null, 'Calendar')), h('div', { class: 'sky-actions' }, calBtn, calCopy), calLink),
    status,
  );

  // Resync with fresh predictions when alerts or the location change, and every few hours.
  let pending: ReturnType<typeof setTimeout> | null = null;
  const later = () => {
    if (!Object.keys(load()).length) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => void syncAll(), 1500);
  };
  app.alerts?.onChange(later);
  app.on('observer', later);
  setTimeout(later, 4000);
  setInterval(later, 3 * 3600e3);
  return t.el;
}
