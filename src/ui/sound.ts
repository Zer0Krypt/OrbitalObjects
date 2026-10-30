import type { App } from '../app';
import { NAKED_EYE_MAG } from '../sim/brightness';

/**
 * Sonification (off by default; Layers → Sound):
 *  - a soft chime as each bright satellite rises above 10° from your location,
 *    pitched by brightness and panned by direction;
 *  - Sputnik's beep while the history date is in its three weeks of
 *    transmissions (4–26 October 1957), and as a replay passes its launch.
 */

const SPUTNIK_ON = Date.UTC(1957, 9, 4, 19, 28);
const SPUTNIK_OFF = Date.UTC(1957, 9, 26);
const RISE_EL = 10;

export function mountSound(app: App) {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;

  const ensure = () => {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  };
  // Browsers only start audio after a gesture: resume on the first one.
  window.addEventListener('pointerdown', () => app.settings.sound && ensure(), { passive: true });
  window.addEventListener('keydown', () => app.settings.sound && ensure());

  /** A soft bell: a sine with a little inharmonic shimmer and a long decay. */
  function chime(freq: number, pan: number, level: number) {
    const c = ensure();
    if (!c || !master || c.state !== 'running') return;
    const t = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.18 * level, t + 0.015);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    out.connect(p).connect(master);
    for (const [mult, amp] of [
      [1, 1],
      [2.76, 0.28],
      [5.4, 0.08],
    ]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      g.gain.value = amp;
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 2.7);
    }
  }

  /** Sputnik's alternating beeps (its two transmitters, made audible), for `secs` seconds. */
  let beepUntil = 0;
  function beeps(secs: number) {
    const c = ensure();
    if (!c || !master || c.state !== 'running') return;
    const start = Math.max(c.currentTime, beepUntil);
    const end = c.currentTime + secs;
    for (let t = start, k = 0; t < end; t += 0.6, k++) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      // Alternating pitches, like the 20 and 40 MHz signals heard on the ground.
      o.frequency.value = k % 2 ? 1180 : 940;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.setValueAtTime(0.12, t + 0.28);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.31);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.32);
    }
    beepUntil = Math.max(beepUntil, end);
  }

  // ---------- rising bright satellites ----------
  let up = new Set<number>();
  let lastCheck = 0;
  let lastChime = 0;
  let primed = false;
  app.on('frame', () => {
    if (!app.settings.sound || !app.observer || app.history) {
      primed = false;
      return;
    }
    const now = performance.now();
    if (now - lastCheck < 1000) return;
    lastCheck = now;
    const next = new Set<number>();
    const rising: number[] = [];
    for (let i = 0; i < app.liveCount; i++) {
      if (app.skyEl[i] < RISE_EL || app.skyMag[i] > NAKED_EYE_MAG) continue;
      next.add(i);
      if (primed && !up.has(i)) rising.push(i);
    }
    up = next;
    // The first check only learns what's already up.
    if (!primed) {
      primed = true;
      return;
    }
    // At most one chime every 1.5 s, the brightest first, so fast-forward stays calm.
    rising.sort((a, b) => app.skyMag[a] - app.skyMag[b]);
    const i = rising[0];
    if (i === undefined || now - lastChime < 1500) return;
    lastChime = now;
    const mag = app.skyMag[i];
    // Brighter: lower and louder. Direction: east right, west left (relative to north).
    const freq = 440 * 2 ** ((Math.max(-2, Math.min(5, mag)) + 1) / 6);
    const pan = Math.sin((app.skyAz[i] * Math.PI) / 180) * 0.8;
    chime(freq, pan, Math.max(0.35, Math.min(1, 1 - mag / 8)));
  });

  // ---------- Sputnik ----------
  let lastCut = -Infinity;
  app.on('history', () => {
    const hs = app.history;
    if (!app.settings.sound || !hs) {
      lastCut = hs?.cutoff ?? -Infinity;
      return;
    }
    // Passing the launch during a replay: a few seconds of beeps.
    if (lastCut < SPUTNIK_ON && hs.cutoff >= SPUTNIK_ON && hs.cutoff - lastCut < 400 * 86400e3) beeps(4);
    lastCut = hs.cutoff;
  });
  // Parked within Sputnik's transmitting weeks: keep beeping.
  setInterval(() => {
    const hs = app.history;
    if (!app.settings.sound || !hs || hs.cutoff < SPUTNIK_ON || hs.cutoff > SPUTNIK_OFF) return;
    beeps(1.3);
  }, 1000);

  app.on('settings', () => {
    if (app.settings.sound) {
      ensure();
      primed = false;
    } else if (ctx && ctx.state === 'running') void ctx.suspend();
  });
}
