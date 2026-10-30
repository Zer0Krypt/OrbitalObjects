import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { satrecFor } from '../render/orbits';
import { describeMag, fmtMag } from '../sim/brightness';
import { compass, findPasses, type Observer, type Pass } from '../sim/observer';
import { h } from './dom';

/** Visible passes of one object, for calendar export and alerts. */
export function visiblePasses(app: App, o: SatObject, from: number, days: number): Pass[] {
  const rec = satrecFor(o);
  if (!rec || !app.observer) return [];
  const all = findPasses(rec, app.observer, from, days * 24, 0, o.period, app.stdMag(o).mag);
  return Array.isArray(all) ? all.filter((p) => p.visible) : [];
}

// ---------- calendar (.ics) ----------
const icsTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
/** RFC 5545 lines are folded at 75 octets. */
function fold(line: string) {
  const out: string[] = [];
  let s = line;
  while (s.length > 74) {
    out.push(s.slice(0, 74));
    s = ' ' + s.slice(74);
  }
  out.push(s);
  return out.join('\r\n');
}

export interface PassEvent {
  o: SatObject;
  p: Pass;
}

export function passesToIcs(events: PassEvent[], observer: Observer) {
  const stamp = icsTime(Date.now());
  const where = `${observer.lat.toFixed(4)}, ${observer.lon.toFixed(4)}`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Orbital Objects//Visible passes//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Visible satellite passes'];
  for (const { o, p } of events) {
    const name = o.name.replace(/\s*\(.*\)$/, '');
    const desc = [
      `${name} (NORAD ${o.norad}) crosses your sky from ${compass(p.riseAz)} to ${compass(p.setAz)}.`,
      `Highest: ${Math.round(p.maxEl)}° in the ${compass(p.peakAz)}.`,
      `Brightest about magnitude ${fmtMag(p.peakMag)} (${describeMag(p.peakMag)}).`,
      `Times are when it is above the horizon; it is only visible while sunlit against a dark sky.`,
      `Predicted from published orbital elements: check again closer to the time.`,
    ].join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${o.norad}-${Math.round(p.rise / 60e3)}@orbital-objects`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsTime(p.rise)}`,
      `DTEND:${icsTime(p.set)}`,
      fold(`SUMMARY:${icsText(`${name} pass · mag ${fmtMag(p.peakMag)} · ${Math.round(p.maxEl)}° high`)}`),
      fold(`DESCRIPTION:${icsText(desc)}`),
      fold(`LOCATION:${icsText(where)}`),
      `GEO:${observer.lat.toFixed(5)};${observer.lon.toFixed(5)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT10M',
      fold(`DESCRIPTION:${icsText(`${name} rises in the ${compass(p.riseAz)} in 10 minutes`)}`),
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function downloadIcs(events: PassEvent[], observer: Observer, filename: string) {
  const blob = new Blob([passesToIcs(events, observer)], { type: 'text/calendar;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

// ---------- alerts ----------
const KEY = 'oo.alerts';
const LEAD_MS = 5 * 60e3;

function loadAlerts(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}
function saveAlerts(list: number[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Browser notifications a few minutes before visible passes of chosen objects,
 * while this tab is open. Falls back to an in-page toast without permission.
 */
export class PassAlerts {
  private watched = new Set(loadAlerts());
  private schedule = new Map<number, { passes: Pass[]; at: number }>();
  private fired = new Set<string>();
  private listeners = new Set<() => void>();
  private toastBox: HTMLElement;

  constructor(private app: App) {
    this.toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(this.toastBox);
    setInterval(() => this.tick(), 20e3);
    app.on('observer', () => {
      this.schedule.clear();
      this.emit();
    });
  }

  has(norad: number) {
    return this.watched.has(norad);
  }
  get list() {
    return [...this.watched];
  }
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  async toggle(o: SatObject) {
    if (this.watched.has(o.norad)) this.watched.delete(o.norad);
    else {
      this.watched.add(o.norad);
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {
          /* older browsers */
        }
      }
    }
    saveAlerts([...this.watched]);
    this.schedule.delete(o.norad);
    this.emit();
    this.tick();
  }

  /** Turn alerts on or off for several objects at once (one permission prompt). */
  async setMany(objs: SatObject[], on: boolean) {
    for (const o of objs) {
      if (on) this.watched.add(o.norad);
      else this.watched.delete(o.norad);
      this.schedule.delete(o.norad);
    }
    if (on && 'Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* older browsers */
      }
    }
    saveAlerts([...this.watched]);
    this.emit();
    this.tick();
  }

  /** Next alerted visible pass for an object, if known. */
  nextPass(norad: number) {
    const now = Date.now();
    return this.passesFor(norad, now).find((p) => p.set > now) ?? null;
  }

  get permission(): NotificationPermission | 'unsupported' {
    return 'Notification' in window ? Notification.permission : 'unsupported';
  }

  private passesFor(norad: number, now: number) {
    const o = this.app.cat.byNorad.get(norad);
    if (!o || !this.app.observer) return [];
    let e = this.schedule.get(norad);
    if (!e || now - e.at > 30 * 60e3) {
      // Real time, whatever the simulation clock is showing.
      e = { passes: visiblePasses(this.app, o, now - 10 * 60e3, 2), at: now };
      this.schedule.set(norad, e);
    }
    return e.passes;
  }

  private tick() {
    if (!this.app.observer || !this.watched.size) return;
    const now = Date.now();
    for (const norad of this.watched) {
      const o = this.app.cat.byNorad.get(norad);
      if (!o) continue;
      for (const p of this.passesFor(norad, now)) {
        const key = `${norad}:${Math.round(p.rise / 60e3)}`;
        if (this.fired.has(key) || now < p.rise - LEAD_MS || now > p.set) continue;
        this.fired.add(key);
        this.notify(o, p, now);
      }
    }
  }

  private notify(o: SatObject, p: Pass, now: number) {
    const name = o.name.replace(/\s*\(.*\)$/, '');
    const mins = Math.max(0, Math.round((p.rise - now) / 60e3));
    const title = mins > 0 ? `${name} rises in ${mins} min` : `${name} is passing over now`;
    const body = `From the ${compass(p.riseAz)} to the ${compass(p.setAz)}, up to ${Math.round(p.maxEl)}° high, about magnitude ${fmtMag(p.peakMag)} (${describeMag(p.peakMag)}).`;
    const open = () => {
      window.focus();
      this.app.exitHistory();
      this.app.clock.resetToNow();
      this.app.select(o, { fly: true });
    };
    if (this.permission === 'granted' && document.visibilityState !== 'visible') {
      try {
        const n = new Notification(title, { body, tag: `pass-${o.norad}`, icon: `${import.meta.env.BASE_URL}favicon.svg` });
        n.onclick = open;
        return;
      } catch {
        /* fall through to a toast */
      }
    }
    this.toast(title, body, open);
  }

  toast(title: string, body: string, onClick?: () => void) {
    const close = () => el.remove();
    const el = h(
      'div',
      { class: 'toast', role: 'status' },
      h('div', null, h('b', null, title), h('p', null, body)),
      onClick ? h('button', { class: 'btn', onclick: () => (onClick(), close()) }, 'Show') : null,
      h('button', { class: 'icon-mini', 'aria-label': 'Dismiss', onclick: close }, '×'),
    );
    this.toastBox.append(el);
    setTimeout(close, 60e3);
  }
}
