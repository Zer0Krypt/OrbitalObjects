export interface ReentryPrediction {
  norad: number;
  name: string;
  cospar: string;
  decay: string; // ISO, predicted re-entry time
  decayMs: number;
  /** ± minutes, from TIP messages. */
  windowMin: number | null;
  source: 'tip' | 'prediction';
  tip: { lat: number | null; lon: number | null; direction: string | null; highInterest: boolean } | null;
}

export interface RecentReentry {
  norad: number;
  name: string;
  cospar: string;
  decay: string; // YYYY-MM-DD
  type: string;
  owner: string;
  rcs: number | null;
}

export interface ReentryData {
  generated: string;
  /** False when the build had no Space-Track access (no predictions). */
  predictions: boolean;
  sample: boolean;
  upcoming: ReentryPrediction[];
  recent: RecentReentry[];
}

export async function loadReentries(url: string): Promise<ReentryData | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = await res.json();
    return {
      generated: raw.generated,
      predictions: !!raw.predictions,
      sample: !!raw.sample,
      upcoming: (raw.upcoming ?? []).map((u: ReentryPrediction) => ({ ...u, decayMs: Date.parse(u.decay) })).filter((u: ReentryPrediction) => Number.isFinite(u.decayMs)),
      recent: raw.recent ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Uncertainty of a prediction (± ms). TIP messages carry their own window;
 * for longer-range predictions the usual rule of thumb is ±20% of the time
 * remaining.
 */
export function uncertaintyMs(p: ReentryPrediction, now: number) {
  if (p.windowMin != null) return p.windowMin * 60e3;
  return Math.max(30 * 60e3, Math.abs(p.decayMs - now) * 0.2);
}
