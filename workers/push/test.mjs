// Self-test: encryption round trip (decrypting as a browser would), VAPID
// signature, and the subscribe -> cron -> push flow against a mock KV.
import assert from 'node:assert/strict';
import worker, { sendDue, testChannel } from './src/index.js';
import { b64url, encryptPayload, unb64url, vapidAuth } from './src/webpush.js';

const enc = new TextEncoder();
const hkdf = async (salt, ikm, info, n) =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
const cat = (...p) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of p) (o.set(x, i), (i += x.length));
  return o;
};

// A "browser" subscription.
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: 'https://push.example.net/send/abc123', keys: { p256dh: b64url(uaPublic), auth: b64url(auth) } };

/** Decrypt an aes128gcm push body the way the browser does (RFC 8291). */
async function decrypt(body) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)));
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  return new TextDecoder().decode(plain.slice(0, -1));
}

// 1. Encryption round trip.
const body = await encryptPayload('{"hello":"orbit"}', sub.keys.p256dh, sub.keys.auth);
assert.equal(await decrypt(body), '{"hello":"orbit"}');
console.log('✓ payload decrypts with the subscription keys');

// 1b. RFC 8291 section 5's worked example, byte for byte.
{
  const asPub = unb64url('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const privateJwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: b64url(asPub.slice(1, 33)), y: b64url(asPub.slice(33)) };
  const out = await encryptPayload('When I grow up, I want to be a watermelon', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', { privateJwk, salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.equal(
    b64url(out),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
  console.log('✓ matches the RFC 8291 worked example byte for byte');
}

// 2. VAPID JWT verifies against the public key.
const vk = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', vk.privateKey);
const { authorization, publicKey } = await vapidAuth(sub.endpoint, jwk, 'mailto:test@example.com');
const [, token, k] = authorization.match(/^vapid t=([^,]+), k=(.+)$/);
assert.equal(k, publicKey);
const [h, p, sig] = token.split('.');
const claims = JSON.parse(new TextDecoder().decode(unb64url(p)));
assert.equal(claims.aud, 'https://push.example.net');
const pub = await crypto.subtle.importKey('raw', unb64url(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64url(sig), enc.encode(`${h}.${p}`)));
console.log('✓ VAPID token verifies, audience', claims.aud);

// 3. The worker end to end, with an in-memory KV.
const store = new Map();
const KV = {
  get: async (k, t) => (store.has(k) ? (t === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
  put: async (k, v) => void store.set(k, v),
  delete: async (k) => void store.delete(k),
  list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const env = { PUSH_KV: KV, VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_SUBJECT: 'mailto:test@example.com', ALLOWED_ORIGINS: 'https://site.example' };
const now = Date.now();
const alerts = [
  { at: now + 30e3, title: 'ISS passes over in 5 minutes', body: 'Rises NW at 19:42, up to 61°, magnitude −3.1', url: './#s=25544', tag: 'pass-25544' },
  { at: now + 86400e3, title: 'Tiangong in 5 minutes', body: '…', url: './#s=48274', tag: 'pass-48274' },
  { at: now - 1000, title: 'in the past: dropped' },
];
const res = await worker.fetch(new Request('https://w.example/subscribe', { method: 'POST', headers: { Origin: 'https://site.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub, alerts }) }), env);
assert.equal(res.status, 200);
assert.equal((await res.json()).scheduled, 2);
assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://site.example');
console.log('✓ subscribe stored', [...store.keys()].filter((k) => k.startsWith('due:')).length, 'alerts');

const sent = [];
const fakeFetch = async (url, init) => {
  sent.push({ url, init });
  return new Response(null, { status: 201 });
};
assert.equal(await sendDue(env, now + 31e3, fakeFetch), 1);
assert.equal(sent[0].url, sub.endpoint);
assert.equal(sent[0].init.headers['Content-Encoding'], 'aes128gcm');
const msg = JSON.parse(await decrypt(sent[0].init.body));
assert.equal(msg.title, 'ISS passes over in 5 minutes');
console.log('✓ cron sent the due alert; browser decrypts:', msg.title);
assert.equal(await sendDue(env, now + 32e3, fakeFetch), 0, 'not sent twice');

// Resubscribing replaces the schedule.
await worker.fetch(new Request('https://w.example/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub, alerts: [{ at: now + 7200e3, title: 'new' }] }) }), env);
assert.equal([...store.keys()].filter((k) => k.startsWith('due:')).length, 1);
console.log('✓ resubscribing replaces the old schedule');

// A 410 from the push service forgets the subscription.
await sendDue(env, now + 7200e3, async () => new Response(null, { status: 410 }));
assert.equal([...store.keys()].length, 0);
console.log('✓ a gone subscription is removed');

// Unsubscribe and bad input.
const bad = await worker.fetch(new Request('https://w.example/subscribe', { method: 'POST', body: JSON.stringify({ subscription: { endpoint: 'http://insecure' } }) }), env);
assert.equal(bad.status, 400);
const vap = await (await worker.fetch(new Request('https://w.example/vapid'), env)).json();
assert.equal(vap.publicKey, publicKey);
console.log('✓ rejects bad subscriptions; /vapid returns the public key');

// Alerts anywhere: an ntfy channel gets its alert; webhook URLs are checked.
{
  const post = (path, data, origin = 'https://site.example') => worker.fetch(new Request(`https://w.example${path}`, { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(data) }), env);
  const r = await post('/channel', { channel: { kind: 'ntfy', url: 'https://ntfy.sh/my-sat-topic' }, alerts: [{ at: now + 60e3, title: 'ISS in 5 min', body: 'From the W', url: './#s=25544' }] });
  assert.equal(r.status, 200);
  const { id, token, scheduled } = await r.json();
  assert.equal(scheduled, 1);
  const got = [];
  assert.equal(await sendDue(env, now + 61e3, async (url, init) => (got.push({ url, init }), new Response(null, { status: 200 }))), 1);
  assert.equal(got[0].url, 'https://ntfy.sh/my-sat-topic');
  assert.equal(got[0].init.headers.Title, 'ISS in 5 min');
  assert.equal(got[0].init.headers.Click, 'https://site.example/#s=25544');
  // Updating needs the token.
  assert.equal((await post('/channel', { id, token: 'nope', channel: { kind: 'ntfy', url: 'https://ntfy.sh/my-sat-topic' } })).status, 403);
  assert.equal((await post('/channel', { id, token, channel: { kind: 'ntfy', url: 'https://ntfy.sh/my-sat-topic' }, alerts: [] })).status, 200);
  // A test message goes out at once, needs the token, and only once a minute.
  const tests = [];
  const [ts, td] = await testChannel(env, { id, token }, now, async (url, init) => (tests.push({ url, init }), new Response(null, { status: 200 })));
  assert.equal(ts, 200);
  assert.equal(td.ok, true);
  assert.equal(tests[0].url, 'https://ntfy.sh/my-sat-topic');
  assert.match(tests[0].init.headers.Title, /test/i);
  assert.equal((await testChannel(env, { id, token }, now + 5e3, async () => new Response(null, { status: 200 })))[0], 429);
  assert.equal((await testChannel(env, { id, token: 'nope' }, now + 120e3, async () => new Response(null, { status: 200 })))[0], 404);
  console.log('✓ test messages are sent at once, need the token and are rate-limited');
  for (const url of ['https://evil.example/hook', 'http://ntfy.sh/x', 'https://ntfy.sh.evil.example/x'])
    assert.equal((await post('/channel', { channel: { kind: 'ntfy', url } })).status, 400, url);
  assert.equal((await post('/channel', { channel: { kind: 'discord', url: 'https://discord.com/api/webhooks/123/abc-DEF_9' } })).status, 200);
  assert.equal((await post('/channel', { channel: { kind: 'slack', url: 'https://hooks.slack.com/services/T0/B0/xyz' } })).status, 200);
  console.log('✓ ntfy channel delivers; channel tokens and webhook URLs are checked');

  // Calendar feed.
  const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:ISS pass\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const c = await (await post('/channel', { channel: { kind: 'calendar' }, ics })).json();
  const feed = await worker.fetch(new Request(`https://w.example/cal/${c.id}.ics`), env);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get('Content-Type'), /text\/calendar/);
  assert.match(await feed.text(), /SUMMARY:ISS pass/);
  const bogus = await (await post('/channel', { channel: { kind: 'calendar' }, ics: 'BEGIN:VCALENDAR\r\n<script>alert(1)</script>' })).json();
  assert.doesNotMatch(await (await worker.fetch(new Request(`https://w.example/cal/${bogus.id}.ics`), env)).text(), /script/);
  await post('/channel/delete', { id: c.id, token: c.token });
  assert.equal((await worker.fetch(new Request(`https://w.example/cal/${c.id}.ics`), env)).status, 404);
  console.log('✓ calendar feed serves only calendar lines, and can be removed');

  // Sync: stored once per id, fetched back.
  assert.equal((await post('/sync', { id: 'ABCD1234', iv: 'aXY=', data: 'Y2lwaGVy' })).status, 200);
  assert.equal((await post('/sync', { id: 'ABCD1234', iv: 'aXY=', data: 'b3RoZXI=' })).status, 409);
  const back = await (await worker.fetch(new Request('https://w.example/sync/ABCD1234'), env)).json();
  assert.equal(back.data, 'Y2lwaGVy');
  console.log('✓ sync blobs are stored once and read back');
}
console.log('All push worker tests passed.');
