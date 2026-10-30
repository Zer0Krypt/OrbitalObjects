// Cloud cover for pass predictions, from Open-Meteo's free forecast API
// (no key, CORS enabled). Off until the user turns it on, because it sends
// their approximate location (rounded to 0.1°, about 10 km) to Open-Meteo.

import type { Observer } from '../sim/observer';

export interface CloudForecast {
  lat: number;
  lon: number;
  fetched: number;
  /** Hourly cloud cover in percent, from `start` (ms, UTC hour). */
  start: number;
  cover: number[];
}

const ON_KEY = 'oo:weather';
const CACHE_KEY = 'oo:weather-cache';
const MAX_AGE = 60 * 60e3;

export function weatherEnabled() {
  try {
    return localStorage.getItem(ON_KEY) === '1';
  } catch {
    return false;
  }
}
export function setWeatherEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(ON_KEY, '1');
    else {
      localStorage.removeItem(ON_KEY);
      localStorage.removeItem(CACHE_KEY);
    }
  } catch {
    /* private mode */
  }
}

const round = (v: number) => Math.round(v * 10) / 10;

export async function fetchClouds(o: Observer): Promise<CloudForecast | null> {
  const lat = round(o.lat);
  const lon = round(o.lon);
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as CloudForecast | null;
    if (c && c.lat === lat && c.lon === lon && Date.now() - c.fetched < MAX_AGE) return c;
  } catch {
    /* no cache */
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=cloud_cover&forecast_days=8&timezone=GMT`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { hourly?: { time: string[]; cloud_cover: (number | null)[] } };
    if (!d.hourly?.time?.length) return null;
    const f: CloudForecast = {
      lat,
      lon,
      fetched: Date.now(),
      start: Date.parse(d.hourly.time[0] + 'Z'),
      cover: d.hourly.cloud_cover.map((v) => (v === null ? -1 : v)),
    };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(f));
    } catch {
      /* full */
    }
    return f;
  } catch {
    return null;
  }
}

/** Cloud cover (%) at time `t`, interpolated between hours; null outside the forecast. */
export function cloudAt(f: CloudForecast | null, t: number): number | null {
  if (!f) return null;
  const x = (t - f.start) / 3600e3;
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= f.cover.length) return null;
  const a = f.cover[i];
  const b = f.cover[i + 1];
  if (a < 0 || b < 0) return null;
  return a + (b - a) * (x - i);
}

export function describeCloud(c: number) {
  if (c < 20) return 'Clear';
  if (c < 50) return 'Partly cloudy';
  if (c < 80) return 'Mostly cloudy';
  return 'Overcast';
}

/** A small sky icon for a cloud-cover percentage. */
export const CLOUD_ICON = '<path d="M7 18h10a4 4 0 0 0 .5-8A5.5 5.5 0 0 0 7 9.5 4.3 4.3 0 0 0 7 18z"/>';
export const CLEAR_ICON = '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>';
