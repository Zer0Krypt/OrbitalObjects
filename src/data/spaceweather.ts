// Solar activity and geomagnetic storms (NOAA SWPC), fetched at build time.

export interface SpaceWeather {
  generated: string;
  available: boolean;
  sample: boolean;
  /** Daily 10.7 cm solar flux: [YYYY-MM-DD, sfu]. */
  f107: [string, number][];
  /** Monthly sunspot number and F10.7 since 1996: [YYYY-MM, ssn, f107]. */
  cycle: [string, number | null, number | null][];
  /** NOAA's prediction for the coming months, same shape. */
  predicted: [string, number | null, number | null][];
  /** 3-hourly planetary Kp, observed and forecast: [ISO, kp, observed]. */
  kp: [string, number, boolean][];
}

export async function loadSpaceWeather(url: string): Promise<SpaceWeather | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    return { generated: d.generated, available: !!d.available, sample: !!d.sample, f107: d.f107 ?? [], cycle: d.cycle ?? [], predicted: d.predicted ?? [], kp: d.kp ?? [] };
  } catch {
    return null;
  }
}

/** NOAA G-scale for a Kp value: 0 for below storm level, 1–5 for G1–G5. */
export const gScale = (kp: number) => (kp >= 9 ? 5 : kp >= 8 ? 4 : kp >= 7 ? 3 : kp >= 6 ? 2 : kp >= 5 ? 1 : 0);
export const G_COLORS = ['#3987e5', '#c98500', '#e07b1f', '#d95926', '#d03b3b', '#b0207a'];
export const G_LABELS = ['Quiet to active', 'G1 minor storm', 'G2 moderate', 'G3 strong', 'G4 severe', 'G5 extreme'];

export function latestFlux(sw: SpaceWeather | null) {
  const f = sw?.f107;
  return f?.length ? f[f.length - 1][1] : null;
}
export function latestKp(sw: SpaceWeather | null, now = Date.now()) {
  const past = (sw?.kp ?? []).filter((k) => Date.parse(k[0]) <= now);
  return past.length ? past[past.length - 1][1] : null;
}
export function describeFlux(f: number) {
  return f < 80 ? 'very low' : f < 110 ? 'low' : f < 150 ? 'moderate' : f < 200 ? 'high' : 'very high';
}
