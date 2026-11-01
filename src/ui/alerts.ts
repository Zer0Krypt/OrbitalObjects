import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { satrecFor } from '../render/orbits';
import { describeMag, fmtMag } from '../sim/brightness';
import { compass, findPasses, type Observer, type Pass } from '../sim/observer';
import { h } from './dom';
import { alertChime } from './sound';

/** Visible passes of one object, for calendar export and alerts. */
export function visiblePasses(app: App, o: SatObject, from: number, days: number): Pass[] {
  const rec = satrecFor(o);
  if (!rec || !app.observer) return [];
  const all = findPasses(rec, app.observer, from, days * 24, 0, o.period, app.stdMag(o).mag);
  return Array.isArray(all) ? all.filter((p) => p.visible) : [];
}

/**
 * Passes that pass alerts announce, following the Alerts menu: visible ones
 * only (or all of them), climbing above the chosen elevation.
 */
export function alertPasses(app: App, o: SatObject, from: number, days: number): Pass[] {
  const rec = satrecFor(o);
  if (!rec || !app.observer) return [];
  const all = findPasses(rec, app.observer, from, days * 24, 0, o.period, app.stdMag(o).mag);
  if (!Array.isArray(all)) return [];
  const { passVisible, passMinEl } = app.settings;
  return all.filter((p) => (!passVisible || p.visible) && p.maxEl >= passMinEl);
}

/** Title and text of the alert for a pass, `mins` minutes before it starts. */
export function passMessage(o: SatObject, p: Pass, mins: number) {
  const name = o.name.replace(/\s*\(.*\)$/, '');
  const title = mins > 0 ? `${name} rises in ${mins} min` : `${name} is passing over now`;
  const look = p.peakMag < 99 ? `about magnitude ${fmtMag(p.peakMag)} (${describeMag(p.peakMag)})` : 'not visible to the eye (in daylight or Earth’s shadow)';
  const body = `From the ${compass(p.riseAz)} to the ${compass(p.setAz)}, up to ${Math.round(p.maxEl)}° high, ${look}.`;
  return { title, body };
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
  private prefs = '';

  constructor(private app: App) {
    this.toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(this.toastBox);
    setInterval(() => this.tick(), 20e3);
    app.on('observer', () => {
      this.schedule.clear();
      this.emit();
    });
    // New pass preferences: work the passes out again (and resync the push service and channels).
    this.prefs = this.prefKey();
    app.on('settings', () => {
      const k = this.prefKey();
      if (k === this.prefs) return;
      this.prefs = k;
      this.schedule.clear();
      this.emit();
      this.tick();
    });
  }

  private prefKey() {
    const s = this.app.settings;
    return `${s.passLead}|${s.passMinEl}|${s.passVisible}`;
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
  /** Tell listeners (the push service and channels) that the alert list or its passes changed. */
  changed() {
    this.schedule.clear();
    this.emit();
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
      e = { passes: alertPasses(this.app, o, now - 10 * 60e3, 2), at: now };
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
        if (this.fired.has(key) || now < p.rise - this.app.settings.passLead * 60e3 || now > p.set) continue;
        this.fired.add(key);
        this.notify(o, p, now);
      }
    }
  }

  private notify(o: SatObject, p: Pass, now: number) {
    const { title, body } = passMessage(o, p, Math.max(0, Math.round((p.rise - now) / 60e3)));
    this.alert(title, body, `pass-${o.norad}`, this.app.settings.passNotify, () => this.show(o));
  }

  /** Bring the page forward, back to live time, showing `o`. */
  show(o: SatObject) {
    window.focus();
    this.app.exitHistory();
    this.app.clock.resetToNow();
    this.app.select(o, { fly: true });
  }

  /**
   * An alert: a system notification when the tab is in the background (and
   * `system` is allowed), otherwise a pop-up in the page; with a chime if
   * Sound and "Chime with alerts" are on.
   */
  alert(title: string, body: string, tag: string, system: boolean, open?: () => void, chime = true) {
    const s = this.app.settings;
    if (chime && s.sound && s.soundAlerts) alertChime();
    if (system && this.permission === 'granted' && document.visibilityState !== 'visible') {
      try {
        const n = new Notification(title, { body, tag, icon: `${import.meta.env.BASE_URL}favicon.svg` });
        n.onclick = () => (window.focus(), open?.());
        return;
      } catch {
        /* fall through to a pop-up */
      }
    }
    this.toast(title, body, open);
  }

  /** Ask for notification permission (resolves to the result). */
  async requestPermission() {
    if (!('Notification' in window)) return 'unsupported' as const;
    if (Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* older browsers */
      }
    }
    this.emit();
    return Notification.permission;
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
