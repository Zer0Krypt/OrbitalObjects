import type { App } from '../app';
import { parseTleText, type ParsedTle } from '../data/tle';
import { h } from './dom';
import { skyTool } from './skytools';
import { workerConfigured, workerUrl } from './push';

/**
 * Bring your own element sets (a cubesat before it's catalogued, a planned
 * orbit) and move your settings to another device.
 */
export const MY_TLE_KEY = 'oo:mytle';
export interface MyTle {
  name: string;
  l1: string;
  l2: string;
  added: number;
}
export function loadMyTles(): MyTle[] {
  try {
    const v = JSON.parse(localStorage.getItem(MY_TLE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveMyTles(list: MyTle[]) {
  try {
    localStorage.setItem(MY_TLE_KEY, JSON.stringify(list.slice(0, 100)));
    return true;
  } catch {
    return false;
  }
}

/** The stored sets, parsed (for merging into the catalogue at start-up). */
export function myTleSets(): ParsedTle[] {
  return loadMyTles().flatMap((t) => parseTleText(`${t.name}\n${t.l1}\n${t.l2}`).sets);
}

// ---------- sync ----------
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SKIP = new Set(['oo:push', 'oo:channels', 'oo:weather-cache']);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(20));
  return [...r].map((v) => ALPHABET[v % 32]).join('');
}
const fmtCode = (c: string) => c.match(/.{1,4}/g)!.join('-');
const cleanCode = (s: string) =>
  s
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-Z]/g, '');

async function keyFor(code: string) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.slice(8)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`orbital-objects-sync:${code.slice(0, 8)}`), iterations: 150000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Everything this site keeps in the browser (except device-specific push state). */
function snapshot() {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (/^oo[.:]/.test(k) && !k.startsWith('oo.wiki') && !SKIP.has(k)) out[k] = localStorage.getItem(k)!;
  }
  return out;
}

export async function uploadSync() {
  const code = newCode();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ v: 1, at: Date.now(), data: snapshot() }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(code), plain));
  const r = await fetch(`${workerUrl()}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: code.slice(0, 8), iv: b64(iv), data: b64(ct) }) });
  if (!r.ok) throw new Error(r.status === 400 ? 'too much to send' : `sync service ${r.status}`);
  return fmtCode(code);
}

export async function downloadSync(input: string) {
  const code = cleanCode(input);
  if (code.length !== 20) throw new Error('a code has 20 letters and digits');
  const r = await fetch(`${workerUrl()}/sync/${code.slice(0, 8)}`);
  if (r.status === 404) throw new Error('that code has expired or was mistyped');
  if (!r.ok) throw new Error(`sync service ${r.status}`);
  const d = (await r.json()) as { iv: string; data: string };
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(d.iv) }, await keyFor(code), unb64(d.data));
  } catch {
    throw new Error('the code doesn’t match (check the last 12 characters)');
  }
  const v = JSON.parse(new TextDecoder().decode(plain)) as { data: Record<string, string> };
  return v.data;
}

export function mountMine(app: App) {
  // ---------- your element sets ----------
  const byo = skyTool('Add your own element set', 'paste a TLE: a new cubesat, a planned orbit');
  const ta = h('textarea', { rows: 4, spellcheck: 'false', class: 'tle-input', placeholder: 'MY CUBESAT\n1 99999U 26999A   26304.50000000  .00010000  00000-0  50000-3 0  9990\n2 99999  97.4000 120.0000 0010000  90.0000 270.0000 15.20000000    18', 'aria-label': 'Two- or three-line element sets' });
  const msg = h('p', { class: 'sky-hint', style: 'margin:0' });
  const list = h('div', { class: 'obs-list' });
  const add = h('button', { class: 'btn primary' }, 'Add and show');
  byo.body.append(
    h('p', { class: 'sky-hint', style: 'margin:0 0 6px' }, 'Element sets you add are kept in this browser and drawn like any other object. One with a NORAD number already in the catalogue replaces that object’s orbit. The page reloads to add them.'),
    ta,
    msg,
    h('div', { class: 'sky-actions' }, add),
    list,
  );
  add.onclick = () => {
    const { sets, errors } = parseTleText(ta.value);
    if (!sets.length) {
      msg.textContent = errors[0] ?? 'No element sets found: paste the two lines that start with “1 ” and “2 ”, with an optional name line above.';
      return;
    }
    if (errors.length) {
      msg.textContent = `${errors[0]} Fix it and try again.`;
      return;
    }
    const mine = loadMyTles().filter((t) => !sets.some((s) => t.l1.slice(2, 7) === s.l1.slice(2, 7)));
    if (!saveMyTles([...sets.map((s) => ({ name: s.name, l1: s.l1, l2: s.l2, added: Date.now() })), ...mine])) {
      msg.textContent = 'Couldn’t save them: this browser’s storage is full or switched off.';
      return;
    }
    location.hash = `#${sets[0].norad}`;
    location.reload();
  };
  const renderList = () => {
    const mine = loadMyTles();
    list.replaceChildren(
      ...mine.map((t) => {
        const norad = Number(t.l1.slice(2, 7)) || t.l1.slice(2, 7);
        const o = app.cat.byNorad.get(Number(norad));
        return h(
          'div',
          { class: 'obs-row' },
          h('button', { class: 'obs-main', onclick: () => o && app.select(o, { fly: true }) }, h('b', null, t.name), h('small', null, `NORAD ${norad} · epoch ${t.l1.slice(18, 32).trim()}`)),
          h(
            'button',
            {
              class: 'icon-mini',
              title: 'Remove (reloads the page)',
              'aria-label': `Remove ${t.name}`,
              onclick: () => {
                saveMyTles(loadMyTles().filter((x) => x.l1 !== t.l1));
                location.reload();
              },
            },
            '×',
          ),
        );
      }),
    );
  };
  renderList();
  if (loadMyTles().length) byo.el.open = true;

  // ---------- another device ----------
  const sync = skyTool('Use on another device', 'move your satellites and settings with a code');
  const out = h('div', { class: 'sync-code', hidden: true });
  const status = h('p', { class: 'sky-hint', style: 'margin:0' });
  const send = h('button', { class: 'btn' }, 'Get a code');
  const codeIn = h('input', { type: 'text', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX', 'aria-label': 'Code from your other device', autocomplete: 'off', spellcheck: 'false' });
  const load = h('button', { class: 'btn' }, 'Load');
  sync.body.append(
    h('p', { class: 'sky-hint', style: 'margin:0 0 6px' }, 'Your satellites, alerts, location, observation log, element sets and settings, encrypted in this browser before they’re sent: the service only stores scrambled data it can’t read. Codes work for 14 days.'),
    h('div', { class: 'sky-actions' }, send),
    out,
    h('div', { class: 'sync-in' }, codeIn, load),
    status,
  );
  send.onclick = async () => {
    send.disabled = true;
    try {
      const code = await uploadSync();
      out.hidden = false;
      out.replaceChildren(h('b', { class: 'mono' }, code), h('button', { class: 'link', onclick: () => navigator.clipboard?.writeText(code).catch(() => {}) }, 'Copy'));
      status.textContent = 'Enter this code on your other device (My satellites → Use on another device → Load).';
    } catch (err) {
      status.textContent = `Couldn’t make a code: ${(err as Error).message}.`;
    }
    send.disabled = false;
  };
  load.onclick = async () => {
    load.disabled = true;
    try {
      const data = await downloadSync(codeIn.value);
      const n = Object.keys(data).length;
      if (!confirm(`Replace this device’s satellites and settings with the ${n} saved items from the other device?`)) {
        load.disabled = false;
        return;
      }
      for (const [k, v] of Object.entries(data)) if (/^oo[.:]/.test(k) && !SKIP.has(k)) localStorage.setItem(k, v);
      location.reload();
    } catch (err) {
      status.textContent = `Couldn’t load: ${(err as Error).message}.`;
    }
    load.disabled = false;
  };

  const el = h('div', { class: 'section mine' }, h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, 'Bring your own')), byo.el, workerConfigured() ? sync.el : null);
  return el;
}
