import type { App } from '../app';

/**
 * The site's sounds, all set up in the Alerts menu and silent until you turn
 * Sound on there:
 *  - a soft chime when a satellite rises (rising.ts decides when),
 *  - a chime with each alert that pops up,
 *  - Sputnik's beep while the history date is in its three weeks of
 *    transmissions (4–26 October 1957), and as a replay passes its launch.
 */

const SPUTNIK_ON = Date.UTC(1957, 9, 4, 19, 28);
const SPUTNIK_OFF = Date.UTC(1957, 9, 26);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.5;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** True once the browser lets the page play sound (after a click or key press). */
export const audioReady = () => !!ctx && ctx.state === 'running';

/** A soft bell: a sine with a little inharmonic shimmer and a long decay. */
export function chime(freq = 660, pan = 0, level = 0.8) {
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

/** Chime for a satellite at magnitude `mag` and azimuth `az`: brighter is lower and louder; east right, west left. */
export function satelliteChime(mag: number, az: number) {
  const m = mag >= 99 ? 5 : mag;
  const freq = 440 * 2 ** ((Math.max(-2, Math.min(5, m)) + 1) / 6);
  chime(freq, Math.sin((az * Math.PI) / 180) * 0.8, Math.max(0.35, Math.min(1, 1 - m / 8)));
}

/** Two rising notes, for an alert that pops up. */
export function alertChime() {
  chime(784, 0, 0.7);
  setTimeout(() => chime(1046, 0, 0.6), 160);
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

/** Play a sample of each sound, for the Test button. */
export function testSound() {
  ensure();
  // The context may need a moment to start after the click.
  setTimeout(() => {
    satelliteChime(1, 270);
    setTimeout(() => satelliteChime(3, 90), 700);
    setTimeout(alertChime, 1500);
  }, 60);
}

export function mountSound(app: App) {
  volume = app.settings.volume;
  // Browsers only start audio after a gesture: resume on the first one.
  window.addEventListener('pointerdown', () => app.settings.sound && ensure(), { passive: true });
  window.addEventListener('keydown', () => app.settings.sound && ensure());

  // ---------- Sputnik ----------
  let lastCut = -Infinity;
  app.on('history', () => {
    const hs = app.history;
    if (!app.settings.sound || !app.settings.soundSputnik || !hs) {
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
    if (!app.settings.sound || !app.settings.soundSputnik || !hs || hs.cutoff < SPUTNIK_ON || hs.cutoff > SPUTNIK_OFF) return;
    beeps(1.3);
  }, 1000);

  app.on('settings', () => {
    volume = app.settings.volume;
    if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
    if (app.settings.sound) ensure();
    else if (ctx && ctx.state === 'running') void ctx.suspend();
  });
}
