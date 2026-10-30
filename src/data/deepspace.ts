// Spacecraft beyond Earth orbit (JPL Horizons, fetched at build time):
// geocentric positions in km, sampled at a fixed step.

export interface Series {
  t0: number;
  step: number;
  /** x, y, z (km, equatorial J2000) per sample. */
  pos: number[];
}

export interface DeepCraft extends Series {
  id: string;
  name: string;
  short: string;
  where: 'L1' | 'L2' | 'Moon';
  wiki: string;
  /** Daily positions over ±90 days (libration-point missions), for drawing the path. */
  path: Series | null;
}

export interface DeepSpaceData {
  generated: string;
  available: boolean;
  sample: boolean;
  craft: DeepCraft[];
}

export async function loadDeepSpace(url: string): Promise<DeepSpaceData | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    return { generated: d.generated, available: !!d.available, sample: !!d.sample, craft: d.craft ?? [] };
  } catch {
    return null;
  }
}

/** Position (km) at time t by linear interpolation, or null outside the series. */
export function sampleAt(s: Series, t: number): [number, number, number] | null {
  const n = s.pos.length / 3;
  const x = (t - s.t0) / s.step;
  if (!(x >= 0) || x > n - 1) return null;
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const a = i * 3;
  const b = a + 3;
  return [s.pos[a] + (s.pos[b] - s.pos[a]) * f, s.pos[a + 1] + (s.pos[b + 1] - s.pos[a + 1]) * f, s.pos[a + 2] + (s.pos[b + 2] - s.pos[a + 2]) * f];
}

export const WHERE_LABEL: Record<DeepCraft['where'], string> = {
  L1: 'Sun–Earth L1, toward the Sun',
  L2: 'Sun–Earth L2, beyond Earth’s shadow',
  Moon: 'In orbit around the Moon',
};
