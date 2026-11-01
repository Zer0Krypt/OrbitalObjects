import type { App } from '../app';
import { fmtMag } from '../sim/brightness';
import { compass } from '../sim/observer';
import { satelliteChime } from './sound';

/**
 * Rise alerts (Alerts menu → Rising satellites): tell you when satellites
 * climb past a chosen elevation from your location, optionally only while the
 * Sun is far enough below the horizon, by a chime, a pop-up and/or a browser
 * notification. Works on the simulation clock, so fast-forwarding plays the
 * chimes; pop-ups and notifications only come at live time.
 */

const CHIME_GAP = 1500;
const POPUP_GAP = 20e3;
/** A jump of the clock bigger than this starts afresh rather than announcing everything it skipped. */
const JUMP_MS = 10 * 60e3;

/** The twilight a solar elevation (as degrees below the horizon) corresponds to. */
export function twilightName(below: number) {
  if (below >= 18) return 'astronomical darkness';
  if (below >= 12) return 'nautical twilight or darker';
  if (below >= 6) return 'civil twilight or darker';
  if (below > 0) return 'after sunset';
  return 'the Sun below the horizon';
}

export function mountRising(app: App) {
  let prevEl: Float32Array | null = null;
  let prevT = 0;
  let lastChime = 0;
  let lastPopup = 0;
  let pending: number[] = [];

  const reset = () => {
    prevEl = null;
    pending = [];
  };
  app.on('observer', reset);
  app.on('settings', reset);
  app.on('watchlist', reset);
  app.alerts?.onChange(reset);

  /** Indices that count, or null for everything. */
  function pool(): Set<number> | null {
    const s = app.settings;
    if (s.riseWhich === 'mine') return new Set(app.watchlistObjects().map((o) => o.idx));
    if (s.riseWhich === 'alerted') return new Set((app.alerts?.list ?? []).map((n) => app.cat.byNorad.get(n)?.idx).filter((i): i is number => i !== undefined));
    return null;
  }

  function check() {
    const s = app.settings;
    if (!s.riseOn || !app.observer || app.history) {
      prevEl = null;
      return;
    }
    // Frames keep the sky fresh while the page is showing; in a background tab, do it here.
    if (document.visibilityState !== 'visible') app.refreshSky();
    const t = app.skyTime;
    const n = app.liveCount;
    const el = app.skyEl;
    if (!prevEl || prevEl.length !== n || Math.abs(t - prevT) > JUMP_MS * Math.max(1, Math.abs(app.clock.rate) / 60)) {
      prevEl = el.slice(0, n);
      prevT = t;
      return;
    }
    if (t === prevT) return;
    const dark = !s.riseDark || app.sunEl <= -s.riseSunBelow;
    const only = pool();
    const rising: number[] = [];
    if (dark) {
      const consider = (i: number) => {
        if (el[i] < s.riseEl || prevEl![i] >= s.riseEl || prevEl![i] <= -89) return;
        const mag = app.skyMag[i];
        if (s.riseWhich === 'bright' ? mag > s.riseMag : s.riseSunlit && mag >= 99) return;
        rising.push(i);
      };
      if (only) for (const i of only) i < n && consider(i);
      else for (let i = 0; i < n; i++) consider(i);
    }
    prevEl.set(el.subarray(0, n));
    prevT = t;
    if (!rising.length) return;
    rising.sort((a, b) => app.skyMag[a] - app.skyMag[b]);

    const now = performance.now();
    if (s.sound && s.riseChime && now - lastChime >= CHIME_GAP) {
      lastChime = now;
      satelliteChime(app.skyMag[rising[0]], app.skyAz[rising[0]]);
    }
    // Pop-ups and notifications are for what's happening now, not a fast-forward.
    if (!(s.riseToast || s.riseNotify) || !app.clock.isLive) return;
    pending.push(...rising.filter((i) => !pending.includes(i)));
    flush();
  }

  function flush() {
    const s = app.settings;
    const now = performance.now();
    // Whatever was waiting is stale once time leaves live, or the sky is no longer dark enough.
    if (!s.riseOn || !app.clock.isLive || app.history || (s.riseDark && app.sunEl > -s.riseSunBelow)) pending = [];
    if (!pending.length || now - lastPopup < POPUP_GAP) return;
    lastPopup = now;
    const list = pending.filter((i) => app.skyEl[i] >= s.riseEl * 0.5);
    pending = [];
    if (!list.length) return;
    list.sort((a, b) => app.skyMag[a] - app.skyMag[b]);
    const i = list[0];
    const o = app.cat.objects[i];
    const name = o.name.replace(/\s*\(.*\)$/, '');
    const more = list.length - 1;
    const mag = app.skyMag[i];
    const title = more ? `${name} and ${more} more rising` : `${name} is rising`;
    const body = `Now ${Math.round(app.skyEl[i])}° up in the ${compass(app.skyAz[i])}${mag < 99 ? `, magnitude ${fmtMag(mag)}` : ''}.${
      more ? ` Also: ${list.slice(1, 4).map((j) => app.cat.objects[j].name.replace(/\s*\(.*\)$/, '')).join(', ')}${more > 3 ? '…' : ''}.` : ''
    }`;
    const hidden = document.visibilityState !== 'visible';
    // In a background tab only a notification can be seen; in the page only a pop-up.
    if (hidden ? !s.riseNotify : !s.riseToast) return;
    // No second sound when the rise chime has just played.
    app.alerts?.alert(title, body, 'rise', s.riseNotify, () => app.alerts?.show(o), !(s.sound && s.riseChime));
  }

  // Once a second; background tabs throttle this to about once a minute, which still catches rises.
  setInterval(check, 1000);
  setInterval(flush, 5000);
}
