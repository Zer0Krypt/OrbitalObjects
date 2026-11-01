import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { alertPasses, passesToIcs, type PassEvent } from './alerts';
import { fmtAgo, h } from './dom';
import { alertSchedule, workerConfigured, workerUrl } from './push';

/**
 * Alerts anywhere (Alerts menu → When the site is closed): the same pass
 * alerts as the bell, sent by the push worker to an ntfy topic, a Discord or
 * Slack webhook, or kept as a calendar feed you subscribe to. The browser
 * works out the passes; each channel is resynced whenever the site is opened
 * (and expires after 9 days without one).
 */
type Kind = 'ntfy' | 'discord' | 'slack' | 'calendar';
interface Saved {
  url: string;
  id: string;
  token: string;
  /** Alerts scheduled at the last sync, and when that was. */
  scheduled?: number;
  synced?: number;
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
  for (const o of objs.slice(0, 40)) for (const p of alertPasses(app, o, Date.now(), 7)) events.push({ o, p });
  return passesToIcs(events.sort((a, b) => a.p.rise - b.p.rise).slice(0, 200), app.observer);
}

async function push(app: App, kind: Kind, s: Saved | undefined, url: string) {
  const body: Record<string, unknown> = { channel: { kind, url }, id: s?.id, token: s?.token };
  if (kind === 'calendar') body.ics = calendarIcs(app) ?? undefined;
  else body.alerts = alertSchedule(app);
  const r = await fetch(`${workerUrl()}/channel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status === 400 ? 'that address isn’t accepted' : `push service ${r.status}`);
  const d = (await r.json()) as { id: string; token: string; scheduled?: number };
  return { saved: { url, id: d.id, token: d.token, scheduled: d.scheduled ?? 0, synced: Date.now() }, scheduled: d.scheduled ?? 0 };
}

/** Ask the push service to send a test message to a channel now. */
async function sendTest(s: Saved) {
  const r = await fetch(`${workerUrl()}/channel/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, token: s.token }) });
  if (r.status === 404) throw new Error('this push service is too old to send tests: redeploy workers/push');
  if (r.status === 429) throw new Error('wait a minute between tests');
  if (!r.ok) throw new Error(`push service ${r.status}`);
  const d = (await r.json()) as { ok?: boolean; status?: number };
  if (d.ok === false) throw new Error(d.status ? `the service answered ${d.status}: check the address` : 'the push service couldn’t reach it');
}

/** How many channels are on (for the Alerts button's badge). */
export const channelCount = () => Object.keys(load()).length;

/** The channels' controls, for the Alerts menu. */
export function channelsPanel(app: App) {
  const el = h('div', { class: 'channels' });
  if (!workerConfigured()) {
    el.append(
      h(
        'p',
        { class: 'sky-hint' },
        'Not available on this copy of the site: sending alerts to ntfy, Discord, Slack or a calendar needs the small push service (workers/push in the source code), which whoever runs this site hasn’t set up.',
      ),
    );
    return el;
  }
  const status = h('p', { class: 'sky-hint', style: 'margin:0' });
  const rows: HTMLElement[] = [];
  let state = load();
  const refreshers: (() => void)[] = [];
  const meta = (s: Saved | undefined) => (s ? `On${s.scheduled !== undefined ? ` · ${s.scheduled} alert${s.scheduled === 1 ? '' : 's'} queued` : ''}${s.synced ? ` · updated ${fmtAgo(Date.now() - s.synced)}` : ''}` : 'Off');

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
    refreshers.forEach((f) => f());
  }

  for (const { kind, label, placeholder, help } of KINDS) {
    const input = h('input', { type: 'text', placeholder, 'aria-label': `${label} address`, value: state[kind]?.url ?? '', title: help });
    const saveBtn = h('button', { class: 'btn', title: `Send pass alerts to this ${label} address` }, state[kind] ? 'Update' : 'Turn on');
    const off = h('button', { class: 'btn', hidden: !state[kind], title: `Stop sending alerts to ${label} and delete the address from the push service` }, 'Turn off');
    const test = h('button', { class: 'btn', hidden: !state[kind], title: `Send a test message to ${label} right now` }, 'Send test');
    const info = h('span', { class: 'ch-state' });
    const refresh = () => {
      info.textContent = meta(state[kind]);
      info.classList.toggle('on', !!state[kind]);
    };
    refreshers.push(refresh);
    refresh();
    test.onclick = async () => {
      const s = state[kind];
      if (!s) return;
      test.disabled = true;
      try {
        await sendTest(s);
        status.textContent = `${label}: test sent. It should arrive within a few seconds.`;
      } catch (err) {
        status.textContent = `${label}: test failed — ${(err as Error).message}.`;
      }
      test.disabled = false;
    };
    saveBtn.onclick = async () => {
      const url = normalise(kind, input.value);
      if (!url) return;
      saveBtn.disabled = true;
      try {
        const r = await push(app, kind, state[kind], url);
        state[kind] = r.saved;
        save(state);
        input.value = url;
        off.hidden = test.hidden = false;
        saveBtn.textContent = 'Update';
        refresh();
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
      off.hidden = test.hidden = true;
      saveBtn.textContent = 'Turn on';
      refresh();
      status.textContent = `${label} alerts are off.`;
    };
    rows.push(h('div', { class: 'ch-row' }, h('label', null, h('span', null, label, info), input), h('div', { class: 'sky-actions' }, saveBtn, test, off), h('small', null, help)));
  }

  // Calendar feed.
  const calLink = h('a', { class: 'mono ch-cal', target: '_blank', rel: 'noopener' });
  const calCopy = h('button', { class: 'btn', hidden: true, title: 'Copy the feed’s address, to paste into your calendar app’s “subscribe to calendar” option' }, 'Copy link');
  const calBtn = h('button', { class: 'btn', title: 'A calendar you subscribe to, which fills with upcoming passes of the satellites you have alerts on' }, state.calendar ? 'Remove feed' : 'Create calendar feed');
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

  el.append(
    h('p', { class: 'sky-hint', style: 'margin:0 0 6px' }, 'Send your pass alerts (the passes and warning time chosen above) to an app or chat as well. A small push service sends them; it keeps the address and the alert texts until they go out, and forgets them after 9 days if you don’t open the site.'),
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
  // Keep "updated … ago" current while the menu is open.
  setInterval(() => el.isConnected && refreshers.forEach((f) => f()), 30e3);
  return el;
}
