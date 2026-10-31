// Orbital Objects push worker: delivers pass alerts while the site is closed.
//
// The site (static, on GitHub Pages) works out each upcoming visible pass in
// the browser and sends this worker only what to show and when:
//   POST /subscribe    { subscription, alerts: [{ at, title, body, url, tag }] }
//   POST /unsubscribe  { endpoint }
//   GET  /vapid        the public key, for checking the setup
// The same alerts can go to other places ("alerts anywhere"):
//   POST /channel      { channel: { kind: ntfy|discord|slack|calendar, url }, id?, token?, alerts, ics? }
//                      -> { id, token }   (id + token update or remove it later)
//   POST /channel/delete { id, token }
//   GET  /cal/<id>.ics a calendar feed of the passes, refreshed whenever the site syncs
// And settings can move between devices ("sync"), end-to-end encrypted by the site:
//   POST /sync         { id, iv, data }   (fails if the id is taken)
//   GET  /sync/<id>    { iv, data }
// A cron trigger runs every minute and sends the alerts that are due.
//
// KV layout (binding PUSH_KV):
//   sub:<id>                  { subscription, due: [keys], updated }
//   ch:<id>                   { kind, url, tokenHash, origin, due: [keys], ics, updated }
//   due:<minute>:<id>:<n>     { title, body, url, tag }  (minute = epoch ms / 60000;
//                             <id> is "ch.<id>" for channels)
//   sync:<id>                 { iv, data }
// Everything expires on its own: subscriptions and channels after 9 days
// without a resync, alerts shortly after they are due, sync blobs after 14 days.

import { b64url, sendPush } from './webpush.js';

const MAX_ALERTS = 200;
const MAX_ICS = 120_000;
const MAX_SYNC = 60_000;
const SYNC_TTL = 14 * 86400;
const HORIZON = 8 * 86400e3;
const SUB_TTL = 9 * 86400;
const enc = new TextEncoder();

const subId = async (endpoint) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(endpoint)))).slice(0, 32);
const minuteOf = (ms) => Math.floor(ms / 60000);
const clip = (v, n) => String(v ?? '').slice(0, n);

function cors(env, req) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  const origin = req.headers.get('Origin') || '';
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin || '*' : allowed[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const randomId = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (t) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t))));

/** Where a channel may post: only the services' own webhook URLs (no open relay). */
export function validChannel(c, env = {}) {
  if (!c || typeof c.kind !== 'string') return false;
  const url = typeof c.url === 'string' ? c.url.trim() : '';
  if (url.length > 400) return false;
  if (c.kind === 'calendar') return true;
  if (c.kind === 'discord') return /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url);
  if (c.kind === 'slack') return /^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/.test(url);
  if (c.kind === 'ntfy') {
    const hosts = ['ntfy.sh', ...String(env.NTFY_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)];
    const m = /^https:\/\/([\w.-]+)\/([\w-]{1,64})$/.exec(url);
    return !!m && hosts.includes(m[1].toLowerCase());
  }
  return false;
}

/** Only calendar lines: no HTML or scripts served from the worker. */
export function validIcs(t) {
  if (typeof t !== 'string' || t.length > MAX_ICS || !t.startsWith('BEGIN:VCALENDAR')) return false;
  return t.split(/\r?\n/).every((l) => l === '' || /^[A-Z-]+[;:]/.test(l) || l.startsWith(' '));
}

function validSubscription(s) {
  return (
    s &&
    typeof s.endpoint === 'string' &&
    /^https:\/\//.test(s.endpoint) &&
    s.endpoint.length < 1000 &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string' &&
    s.keys.p256dh.length < 200 &&
    s.keys.auth.length < 100
  );
}

async function forget(env, id) {
  const rec = await env.PUSH_KV.get(`sub:${id}`, 'json');
  if (rec?.due) await Promise.all(rec.due.map((k) => env.PUSH_KV.delete(k)));
  await env.PUSH_KV.delete(`sub:${id}`);
}

async function subscribe(env, body, now) {
  const sub = body?.subscription;
  if (!validSubscription(sub)) return [400, { error: 'invalid subscription' }];
  const alerts = cleanAlerts(body.alerts, now);
  const id = await subId(sub.endpoint);
  // Replace whatever was scheduled before: passes shift as orbits are updated.
  await forget(env, id);
  const due = await schedule(env, id, alerts, now);
  await env.PUSH_KV.put(`sub:${id}`, JSON.stringify({ subscription: { endpoint: sub.endpoint, keys: sub.keys }, due, updated: now }), { expirationTtl: SUB_TTL });
  return [200, { ok: true, scheduled: due.length }];
}

function cleanAlerts(list, now) {
  return (Array.isArray(list) ? list : []).filter((a) => Number.isFinite(a?.at) && a.at > now && a.at < now + HORIZON).slice(0, MAX_ALERTS);
}

async function schedule(env, id, alerts, now) {
  const due = [];
  for (const [n, a] of alerts.entries()) {
    const key = `due:${minuteOf(a.at)}:${id}:${n}`;
    const ttl = Math.max(60, Math.ceil((a.at - now) / 1000) + 3600);
    await env.PUSH_KV.put(key, JSON.stringify({ title: clip(a.title, 120), body: clip(a.body, 300), url: clip(a.url, 300), tag: clip(a.tag, 80) }), { expirationTtl: ttl });
    due.push(key);
  }
  return due;
}

async function channel(env, body, now, origin) {
  const c = body?.channel;
  if (!validChannel(c, env)) return [400, { error: 'invalid channel' }];
  let id = typeof body.id === 'string' && /^[\w-]{16,32}$/.test(body.id) ? body.id : null;
  let token = typeof body.token === 'string' ? body.token : null;
  if (id) {
    const prev = await env.PUSH_KV.get(`ch:${id}`, 'json');
    // Expired: start afresh under a new id. Wrong token: refuse.
    if (!prev) id = token = null;
    else if (prev.tokenHash !== (await sha(token || ''))) return [403, { error: 'wrong token' }];
    else await Promise.all((prev.due ?? []).map((k) => env.PUSH_KV.delete(k)));
  }
  if (!id) {
    id = randomId(16);
    token = randomId(24);
  }
  const ics = c.kind === 'calendar' ? (validIcs(body.ics) ? body.ics : null) : null;
  const due = c.kind === 'calendar' ? [] : await schedule(env, `ch.${id}`, cleanAlerts(body.alerts, now), now);
  await env.PUSH_KV.put(`ch:${id}`, JSON.stringify({ kind: c.kind, url: c.url ?? '', tokenHash: await sha(token), origin: clip(origin, 200), due, ics, updated: now }), { expirationTtl: SUB_TTL });
  return [200, { ok: true, id, token, scheduled: due.length }];
}

/** Post one alert to a channel; returns the HTTP status. */
export async function deliver(ch, msg, fetchImpl = fetch) {
  const link = msg.url ? new URL(msg.url, ch.origin || 'https://example.invalid/').toString() : '';
  let init;
  if (ch.kind === 'ntfy') init = { body: msg.body, headers: { Title: msg.title, Tags: 'satellite', ...(link ? { Click: link } : {}) } };
  else if (ch.kind === 'discord') init = { body: JSON.stringify({ content: `**${msg.title}**\n${msg.body}${link ? `\n${link}` : ''}` }), headers: { 'Content-Type': 'application/json' } };
  else if (ch.kind === 'slack') init = { body: JSON.stringify({ text: `*${msg.title}*\n${msg.body}${link ? `\n<${link}|Show it>` : ''}` }), headers: { 'Content-Type': 'application/json' } };
  else return 0;
  const r = await fetchImpl(ch.url, { method: 'POST', ...init });
  return r.status;
}

/** Send everything due in the last few minutes (cron runs can be late or skipped). */
export async function sendDue(env, now = Date.now(), fetchImpl = fetch) {
  // Channels (ntfy, Discord, Slack) work without Web Push keys.
  const privateJwk = env.VAPID_PRIVATE_JWK ? JSON.parse(env.VAPID_PRIVATE_JWK) : null;
  const subject = env.VAPID_SUBJECT || 'mailto:admin@example.com';
  let sent = 0;
  for (let m = minuteOf(now) - 5; m <= minuteOf(now); m++) {
    let cursor;
    do {
      const page = await env.PUSH_KV.list({ prefix: `due:${m}:`, cursor });
      cursor = page.list_complete ? undefined : page.cursor;
      for (const { name } of page.keys) {
        const id = name.split(':')[2];
        if (id.startsWith('ch.')) {
          const [msg, ch] = await Promise.all([env.PUSH_KV.get(name, 'json'), env.PUSH_KV.get(`ch:${id.slice(3)}`, 'json')]);
          await env.PUSH_KV.delete(name);
          if (!msg || !ch) continue;
          const status = await deliver(ch, msg, fetchImpl).catch(() => 0);
          if (status >= 200 && status < 300) sent++;
          continue;
        }
        const [msg, rec] = await Promise.all([env.PUSH_KV.get(name, 'json'), env.PUSH_KV.get(`sub:${id}`, 'json')]);
        await env.PUSH_KV.delete(name);
        if (!msg || !rec || !privateJwk) continue;
        const status = await sendPush(rec.subscription, msg, { privateJwk, subject, fetchImpl }).catch(() => 0);
        // Gone: the browser unsubscribed or the user revoked permission.
        if (status === 404 || status === 410) await forget(env, id);
        else if (status >= 200 && status < 300) sent++;
      }
    } while (cursor);
  }
  return sent;
}

export default {
  async fetch(req, env) {
    const headers = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    try {
      // Calendar feeds are fetched by calendar apps, not the site: no CORS needed.
      const cal = req.method === 'GET' && /^\/cal\/([\w-]{16,32})\.ics$/.exec(path);
      if (cal) {
        const ch = await env.PUSH_KV.get(`ch:${cal[1]}`, 'json');
        if (!ch || ch.kind !== 'calendar') return new Response('Not found', { status: 404 });
        const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Orbital Objects//Visible passes//EN\r\nX-WR-CALNAME:Visible satellite passes\r\nEND:VCALENDAR\r\n';
        return new Response(ch.ics || empty, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'max-age=900', 'X-Content-Type-Options': 'nosniff' } });
      }
      const syncGet = req.method === 'GET' && /^\/sync\/([\w-]{6,32})$/.exec(path);
      if (syncGet) {
        const v = await env.PUSH_KV.get(`sync:${syncGet[1]}`, 'json');
        return v ? json(v, 200, headers) : json({ error: 'not found' }, 404, headers);
      }
      if (req.method === 'GET' && path === '/vapid') {
        const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
        const raw = new Uint8Array(65);
        raw[0] = 4;
        raw.set(Uint8Array.from(atob(jwk.x.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0)), 1);
        raw.set(Uint8Array.from(atob(jwk.y.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0)), 33);
        return json({ publicKey: b64url(raw) }, 200, headers);
      }
      if (req.method !== 'POST') return json({ error: 'not found' }, 404, headers);
      const len = Number(req.headers.get('Content-Length') || 0);
      if (len > 100_000) return json({ error: 'too large' }, 413, headers);
      const body = await req.json().catch(() => null);
      if (path === '/subscribe') {
        const [status, data] = await subscribe(env, body, Date.now());
        return json(data, status, headers);
      }
      if (path === '/channel') {
        const [status, data] = await channel(env, body, Date.now(), req.headers.get('Origin') || '');
        return json(data, status, headers);
      }
      if (path === '/channel/delete') {
        const id = String(body?.id ?? '');
        const prev = /^[\w-]{16,32}$/.test(id) ? await env.PUSH_KV.get(`ch:${id}`, 'json') : null;
        if (prev && prev.tokenHash === (await sha(String(body?.token ?? '')))) {
          await Promise.all((prev.due ?? []).map((k) => env.PUSH_KV.delete(k)));
          await env.PUSH_KV.delete(`ch:${id}`);
        }
        return json({ ok: true }, 200, headers);
      }
      if (path === '/sync') {
        const id = String(body?.id ?? '');
        if (!/^[\w-]{6,32}$/.test(id) || typeof body?.iv !== 'string' || typeof body?.data !== 'string' || body.data.length > MAX_SYNC || body.iv.length > 40) return json({ error: 'invalid' }, 400, headers);
        if (await env.PUSH_KV.get(`sync:${id}`)) return json({ error: 'taken' }, 409, headers);
        await env.PUSH_KV.put(`sync:${id}`, JSON.stringify({ iv: body.iv, data: body.data }), { expirationTtl: SYNC_TTL });
        return json({ ok: true, expires: Date.now() + SYNC_TTL * 1000 }, 200, headers);
      }
      if (path === '/unsubscribe') {
        if (typeof body?.endpoint !== 'string') return json({ error: 'missing endpoint' }, 400, headers);
        await forget(env, await subId(body.endpoint));
        return json({ ok: true }, 200, headers);
      }
      return json({ error: 'not found' }, 404, headers);
    } catch (err) {
      return json({ error: String(err?.message || err) }, 500, headers);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDue(env));
  },
};
