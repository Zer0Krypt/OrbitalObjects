import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { toTLE } from '../data/tle';
import { gmst } from '../sim/astro';
import { observerFrame, sunScene } from '../sim/observer';
import { h } from './dom';
import { predictedPosition } from './obslog';

/**
 * Point a telescope or planetarium program at the selected object:
 *  - a TLE file of it (and My satellites) for Stellarium's Satellites plugin
 *    and most other planetarium apps,
 *  - Stellarium's Remote Control plugin on this computer (set the place and
 *    time, centre the object),
 *  - a Meade LX200-compatible mount over Web Serial, re-slewing a little
 *    ahead of the satellite every couple of seconds.
 */

const STELLARIUM = 'http://127.0.0.1:8090/api';
const SUN_MARGIN = 20;

function download(text: string, name: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

export function tleFile(objs: SatObject[]) {
  return objs.map((o) => [o.name, ...toTLE(o)].join('\r\n')).join('\r\n') + '\r\n';
}

const post = (path: string, data: Record<string, string>) =>
  fetch(`${STELLARIUM}${path}`, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });

/** Angle (deg) between the object's direction and the Sun's, from the observer. */
function sunSeparation(app: App, az: number, el: number, t: number) {
  const f = observerFrame(app.observer!, gmst(t));
  const s = sunScene(t);
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  const d = [0, 1, 2].map((i) => f.east[i] * Math.cos(e) * Math.sin(a) + f.north[i] * Math.cos(e) * Math.cos(a) + f.up[i] * Math.sin(e));
  return (Math.acos(Math.max(-1, Math.min(1, d[0] * s[0] + d[1] * s[1] + d[2] * s[2]))) * 180) / Math.PI;
}

// ---------- LX200 over Web Serial ----------
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
  readable: ReadableStream<Uint8Array> | null;
}
let port: SerialPortLike | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
const enc = new TextEncoder();
const send = async (cmd: string) => writer?.write(enc.encode(cmd));
const p2 = (n: number) => String(Math.floor(n)).padStart(2, '0');

async function slewTo(raHours: number, decDeg: number) {
  const s = Math.round(raHours * 3600) % 86400;
  const ra = `${p2(s / 3600)}:${p2((s % 3600) / 60)}:${p2(s % 60)}`;
  const d = Math.round(Math.abs(decDeg) * 3600);
  const dec = `${decDeg < 0 ? '-' : '+'}${p2(d / 3600)}*${p2((d % 3600) / 60)}:${p2(d % 60)}`;
  await send(`:Sr${ra}#`);
  await send(`:Sd${dec}#`);
  await send(':MS#');
}

export function telescopeSection(app: App, o: SatObject) {
  const status = h('p', { class: 'sky-hint', style: 'margin:6px 0 0' });
  const tle = h('button', { class: 'btn', title: 'For Stellarium (Satellites plugin → Sources → add a file) and other planetarium apps' }, 'TLE file');
  tle.onclick = () => {
    const list = [o, ...app.watchlistObjects().filter((x) => x !== o && app.isLiveObject(x))];
    download(tleFile(list), `${list.length > 1 ? 'my-satellites' : o.name.replace(/\W+/g, '-').toLowerCase()}.tle`);
    status.textContent = `Saved ${list.length} element set${list.length === 1 ? '' : 's'}${list.length > 1 ? ' (this one and My satellites)' : ''}. In Stellarium: Satellites plugin → Sources → add the file, then update.`;
  };
  const stel = h('button', { class: 'btn', title: 'Needs Stellarium’s Remote Control plugin running on this computer (port 8090)' }, 'Show in Stellarium');
  stel.onclick = async () => {
    const t = app.clock.now();
    const obs = app.observer;
    try {
      if (obs) await post('/location/setlocationfields', { latitude: String(obs.lat), longitude: String(obs.lon), altitude: String(Math.round(obs.alt * 1000)), name: 'Orbital Objects' });
      await post('/main/time', { time: String(t / 86400000 + 2440587.5), timerate: String(1 / 86400) });
      await post('/main/focus', { target: o.name, mode: 'center' });
      status.textContent = 'Sent to Stellarium. If nothing moved, check that its Remote Control plugin is on (port 8090) and the Satellites plugin knows this object.';
    } catch {
      status.textContent = 'Couldn’t reach Stellarium on this computer. Turn on its Remote Control plugin (Configuration → Plugins), then try again.';
    }
  };

  const serialOk = 'serial' in navigator && window.isSecureContext;
  const connect = h('button', { class: 'btn', hidden: !serialOk, title: 'Meade LX200-compatible mounts and many GoTo controllers, over USB serial' }, port ? 'Disconnect mount' : 'Connect a GoTo mount');
  const point = h('button', { class: 'btn', hidden: !port, title: 'Slew to where it will be in a minute, and wait for it there' }, 'Point ahead');
  const follow = h('button', { class: 'btn', hidden: !port, 'aria-pressed': 'false', title: 'Keep re-slewing a few seconds ahead of it' }, 'Follow');
  let timer: ReturnType<typeof setInterval> | null = null;

  const target = (lead: number) => {
    if (!app.observer) return null;
    const t = Date.now() + lead;
    const p = predictedPosition(app, o, t);
    if (!p) return null;
    if (p.el < 3) return { err: 'It is below your horizon then.' };
    if (sunSeparation(app, p.az, p.el, t) < SUN_MARGIN) return { err: `Too close to the Sun (within ${SUN_MARGIN}°): not slewing.` };
    return { p };
  };
  const go = async (lead: number) => {
    const r = target(lead);
    if (!r) {
      status.textContent = 'Set your location first.';
      return false;
    }
    if ('err' in r) {
      status.textContent = r.err!;
      return false;
    }
    await slewTo(r.p.raNow, r.p.decNow);
    status.textContent = `Slewing to RA ${r.p.raNow.toFixed(3)} h, Dec ${r.p.decNow.toFixed(2)}° (${Math.round(r.p.el)}° up)${lead > 10e3 ? ` — it gets there in ${Math.round(lead / 1000)} s` : ''}.`;
    return true;
  };
  connect.onclick = async () => {
    if (port) {
      if (timer) clearInterval(timer);
      timer = null;
      try {
        writer?.releaseLock();
        await port.close();
      } catch {
        /* already closed */
      }
      port = writer = null;
      connect.textContent = 'Connect a GoTo mount';
      point.hidden = follow.hidden = true;
      status.textContent = 'Mount disconnected.';
      return;
    }
    try {
      const p = await (navigator as unknown as { serial: { requestPort(): Promise<SerialPortLike> } }).serial.requestPort();
      await p.open({ baudRate: 9600 });
      port = p;
      writer = p.writable!.getWriter();
      connect.textContent = 'Disconnect mount';
      point.hidden = follow.hidden = false;
      status.textContent = 'Mount connected (LX200 protocol, 9600 baud). Make sure it is aligned and the Sun is well out of the way.';
    } catch (err) {
      status.textContent = `Couldn’t open the mount: ${(err as Error).message}`;
    }
  };
  point.onclick = () => void go(60e3);
  follow.onclick = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      follow.setAttribute('aria-pressed', 'false');
      void send(':Q#');
      status.textContent = 'Stopped following.';
      return;
    }
    follow.setAttribute('aria-pressed', 'true');
    const tick = async () => {
      if (!(await go(4e3)) && timer) {
        clearInterval(timer);
        timer = null;
        follow.setAttribute('aria-pressed', 'false');
      }
    };
    void tick();
    timer = setInterval(tick, 2000);
  };

  const el = h(
    'div',
    { class: 'isec' },
    h('h3', null, 'Telescope & planetarium'),
    h('div', { class: 'sky-actions' }, tle, stel, connect, point, follow),
    status,
  );
  return { el, dispose: () => timer && clearInterval(timer) };
}
