// Orbital Objects push worker: delivers pass alerts while the site is closed.
//
// The site (static, on GitHub Pages) works out each upcoming visible pass in
// the browser and sends this worker only what to show and when:
//   POST /subscribe    { subscription, alerts: [{ at, title, body, url, tag }] }
//   POST /unsubscribe  { endpoint }
//   GET  /vapid        the public key, for checking the setup
// A cron trigger runs every minute and sends the alerts that are due.
//
// KV layout (binding PUSH_KV):
//   sub:<id>                  { subscription, due: [keys], updated }
//   due:<minute>:<id>:<n>     { title, body, url, tag }  (minute = epoch ms / 60000)
// Everything expires on its own: subscriptions after 9 days without a resync,
// alerts shortly after they are due.

import { b64url, sendPush } from './webpush.js';

const MAX_ALERTS = 200;
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
  const alerts = (Array.isArray(body.alerts) ? body.alerts : [])
    .filter((a) => Number.isFinite(a?.at) && a.at > now && a.at < now + HORIZON)
    .slice(0, MAX_ALERTS);
  const id = await subId(sub.endpoint);
  // Replace whatever was scheduled before: passes shift as orbits are updated.
  await forget(env, id);
  const due = [];
  for (const [n, a] of alerts.entries()) {
    const key = `due:${minuteOf(a.at)}:${id}:${n}`;
    const ttl = Math.max(60, Math.ceil((a.at - now) / 1000) + 3600);
    await env.PUSH_KV.put(key, JSON.stringify({ title: clip(a.title, 120), body: clip(a.body, 300), url: clip(a.url, 300), tag: clip(a.tag, 80) }), { expirationTtl: ttl });
    due.push(key);
  }
  await env.PUSH_KV.put(`sub:${id}`, JSON.stringify({ subscription: { endpoint: sub.endpoint, keys: sub.keys }, due, updated: now }), { expirationTtl: SUB_TTL });
  return [200, { ok: true, scheduled: due.length }];
}

/** Send everything due in the last few minutes (cron runs can be late or skipped). */
export async function sendDue(env, now = Date.now(), fetchImpl = fetch) {
  const privateJwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const subject = env.VAPID_SUBJECT || 'mailto:admin@example.com';
  let sent = 0;
  for (let m = minuteOf(now) - 5; m <= minuteOf(now); m++) {
    let cursor;
    do {
      const page = await env.PUSH_KV.list({ prefix: `due:${m}:`, cursor });
      cursor = page.list_complete ? undefined : page.cursor;
      for (const { name } of page.keys) {
        const id = name.split(':')[2];
        const [msg, rec] = await Promise.all([env.PUSH_KV.get(name, 'json'), env.PUSH_KV.get(`sub:${id}`, 'json')]);
        await env.PUSH_KV.delete(name);
        if (!msg || !rec) continue;
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
