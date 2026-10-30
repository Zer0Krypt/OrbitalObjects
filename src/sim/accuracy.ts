import type { SatObject } from '../data/catalog';

/**
 * How far an object might be from where SGP4 puts it. Public element sets
 * are fitted to radar and optical tracking; the error is a few hundred
 * metres at the epoch and grows mostly along the track, by roughly a
 * kilometre a day, faster for objects low enough to feel strong drag.
 * Operator-supplied (SupGP) orbits start out and stay considerably better.
 * These are rough 1σ figures for orientation, not a covariance.
 */
export function positionSigma(o: SatObject, t: number) {
  const days = Math.min(Math.abs(t - o.epochMs) / 86400e3, 30);
  const drag = o.perigee < 350 ? 2.5 : o.perigee < 500 ? 1.5 : o.apogee > 30000 ? 0.5 : 1;
  const k = o.sup ? 0.35 : 1;
  const R = (o.sup ? 0.03 : 0.1) + 0.08 * k * days * drag;
  const I = (o.sup ? 0.08 : 0.3) + 1.0 * k * days * drag;
  const C = (o.sup ? 0.03 : 0.1) + 0.08 * k * days * drag;
  return { R, I, C, total: Math.hypot(R, I, C), days };
}

/** Element-set age bins for colouring. */
export const AGE_BINS: { max: number; label: string }[] = [
  { max: 1, label: 'Under a day' },
  { max: 3, label: '1–3 days' },
  { max: 7, label: '3–7 days' },
  { max: 30, label: '1–4 weeks' },
  { max: Infinity, label: 'Older' },
];
export const ageDays = (o: SatObject, now = Date.now()) => (now - o.epochMs) / 86400e3;
export const ageBin = (o: SatObject, now = Date.now()) => {
  const d = ageDays(o, now);
  return AGE_BINS.findIndex((b) => d < b.max);
};
