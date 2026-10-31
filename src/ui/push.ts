import type { App } from '../app';
import { fmtMag } from '../sim/brightness';
import { compass } from '../sim/observer';
import { visiblePasses } from './alerts';

/**
 * Background pass alerts: the site has no server, so a small push worker
 * (workers/push) sends them. The browser works out each upcoming visible pass
 * of the objects you have alerts on, and hands the worker only what to show
 * and when; it resyncs whenever the site is opened, as orbits are updated.
 *
 * Needs VITE_PUSH_URL and VITE_VAPID_PUBLIC_KEY at build time.
 */

const PUSH_URL = (import.meta.env.VITE_PUSH_URL as string | undefined)?.replace(/\/+$/, '') ?? '';
const VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';
const KEY = 'oo:push';
const DAYS = 7;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const pushConfigured = () => !!PUSH_URL && !!VAPID;
/** The worker is deployed (channels and sync need it, but not the Web Push keys). */
export const workerConfigured = () => !!PUSH_URL;
export const workerUrl = () => PUSH_URL;

export interface AlertMessage {
  at: number;
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** The next week's visible passes of every object with alerts on, as alert messages. */
export function alertSchedule(app: App): AlertMessage[] {
  const out: AlertMessage[] = [];
  if (!app.observer || !app.alerts) return out;
  const now = Date.now();
  for (const n of app.alerts.list) {
    const o = app.cat.byNorad.get(n);
    if (!o || !app.isLiveObject(o)) continue;
    for (const p of visiblePasses(app, o, now, DAYS)) {
      const at = p.rise - 5 * 60e3;
      if (at < now + 60e3) continue;
      const name = o.name.replace(/\s*\(.*\)$/, '');
      out.push({
        at,
        title: `${name} passes over in 5 minutes`,
        body: `Rises in the ${compass(p.riseAz)} at ${timeFmt.format(p.rise)}, up to ${Math.round(p.maxEl)}° in the ${compass(p.peakAz)}, magnitude ${fmtMag(p.peakMag)}.`,
        url: `./#s=${o.norad}&v=sky`,
        tag: `pass-${o.norad}-${Math.round(p.rise / 60e3)}`,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 200);
}
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

export class BackgroundAlerts {
  private listeners = new Set<() => void>();
  status = '';
  constructor(private app: App) {
    // Resync on open, when alerts or the location change, and every few hours.
    if (this.enabled) void this.sync();
    app.alerts?.onChange(() => this.enabled && void this.sync());
    app.on('observer', () => this.enabled && void this.sync());
    setInterval(() => this.enabled && void this.sync(), 3 * 3600e3);
  }
  get enabled() {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }
  private setEnabled(v: boolean) {
    try {
      if (v) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode */
    }
  }
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(status: string) {
    this.status = status;
    this.listeners.forEach((fn) => fn());
  }

  private async subscription(create: boolean) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(VAPID) });
    return sub;
  }

  private schedule() {
    return alertSchedule(this.app);
  }

  async sync() {
    if (!pushConfigured() || !pushSupported()) return;
    try {
      const sub = await this.subscription(true);
      if (!sub) throw new Error('no subscription');
      const alerts = this.schedule();
      const r = await fetch(`${PUSH_URL}/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), alerts }) });
      if (!r.ok) throw new Error(`push service ${r.status}`);
      const d = (await r.json()) as { scheduled?: number };
      this.emit(d.scheduled ? `${d.scheduled} alert${d.scheduled === 1 ? '' : 's'} scheduled for the next ${DAYS} days.` : 'No visible passes to alert you about this week.');
    } catch (err) {
      this.emit(`Couldn't schedule background alerts: ${(err as Error).message}`);
    }
  }

  async enable() {
    if (!pushConfigured()) return this.emit('Background alerts aren’t set up on this site.');
    if (!pushSupported()) return this.emit('This browser can’t receive notifications when the site is closed. On iPhone and iPad, add the site to your Home Screen first.');
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') return this.emit('Notifications are blocked for this site in your browser settings.');
    this.setEnabled(true);
    await this.sync();
  }

  async disable() {
    this.setEnabled(false);
    try {
      const sub = await this.subscription(false);
      if (sub) {
        await fetch(`${PUSH_URL}/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe();
      }
    } catch {
      /* already gone */
    }
    this.emit('Background alerts are off.');
  }
}
