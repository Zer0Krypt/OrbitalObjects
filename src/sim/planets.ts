// Planet positions from JPL's approximate Keplerian elements (Standish,
// "Keplerian Elements for Approximate Positions of the Major Planets",
// valid 1800–2050, a few arcminutes at worst): plenty for a sky view, where
// planets are the brightest "stars" people mistake for satellites.

const DEG = Math.PI / 180;
const OBLIQUITY = 23.43928 * DEG;

// a (AU), e, I, L, ϖ (long. of perihelion), Ω (long. of node) in degrees,
// each with its rate per Julian century.
type Elements = [number, number, number, number, number, number];
const ELEMENTS: Record<string, [Elements, Elements]> = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
};

export interface PlanetInfo {
  key: string;
  name: string;
  /** J2000 right ascension and declination, degrees. */
  ra: number;
  dec: number;
  /** Unit vector toward the planet in the inertial (J2000 equatorial) frame. */
  dir: [number, number, number];
  mag: number;
  distAu: number;
  /** Linear RGB tint for drawing. */
  color: [number, number, number];
}

export const PLANETS: { key: string; name: string; color: [number, number, number] }[] = [
  { key: 'mercury', name: 'Mercury', color: [0.85, 0.78, 0.7] },
  { key: 'venus', name: 'Venus', color: [1, 0.96, 0.85] },
  { key: 'mars', name: 'Mars', color: [1, 0.55, 0.35] },
  { key: 'jupiter', name: 'Jupiter', color: [1, 0.92, 0.8] },
  { key: 'saturn', name: 'Saturn', color: [1, 0.88, 0.65] },
];

/** Heliocentric ecliptic J2000 position (AU). */
function helio(key: string, T: number): [number, number, number] {
  const [el, rate] = ELEMENTS[key];
  const a = el[0] + rate[0] * T;
  const e = el[1] + rate[1] * T;
  const I = (el[2] + rate[2] * T) * DEG;
  const L = el[3] + rate[3] * T;
  const peri = el[4] + rate[4] * T;
  const node = (el[5] + rate[5] * T) * DEG;
  const w = peri * DEG - node;
  let M = ((L - peri) % 360) * DEG;
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(node), sO = Math.sin(node), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Visual magnitude from distances (AU) and phase angle (deg); after Mallama & Hilton (2018), rings ignored. */
function magnitude(key: string, r: number, d: number, i: number) {
  const k = 5 * Math.log10(r * d);
  switch (key) {
    case 'mercury':
      return k - 0.613 + 6.328e-2 * i - 1.6336e-3 * i ** 2 + 3.3644e-5 * i ** 3 - 3.4265e-7 * i ** 4 + 1.6893e-9 * i ** 5 - 3.0334e-12 * i ** 6;
    case 'venus':
      return k - 4.384 - 1.044e-3 * i + 3.687e-4 * i ** 2 - 2.814e-6 * i ** 3 + 8.938e-9 * i ** 4;
    case 'mars':
      return k - 1.601 + 2.267e-2 * i - 1.302e-4 * i ** 2;
    case 'jupiter':
      return k - 9.395 - 3.7e-4 * i + 6.16e-4 * i ** 2;
    default:
      return k - 8.914 + 2.6e-2 * i;
  }
}

/** Geocentric positions and brightness of Mercury to Saturn at time `t` (ms). */
export function planetPositions(t: number): PlanetInfo[] {
  const T = (t / 86400e3 + 2440587.5 - 2451545) / 36525;
  const earth = helio('earth', T);
  return PLANETS.map(({ key, name, color }) => {
    const p = helio(key, T);
    const x = p[0] - earth[0];
    const y = p[1] - earth[1];
    const z = p[2] - earth[2];
    const d = Math.hypot(x, y, z);
    const r = Math.hypot(...p);
    // Ecliptic -> equatorial.
    const eq: [number, number, number] = [x / d, (y * Math.cos(OBLIQUITY) - z * Math.sin(OBLIQUITY)) / d, (y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY)) / d];
    const re = Math.hypot(...earth);
    const phase = Math.acos(Math.max(-1, Math.min(1, (r * r + d * d - re * re) / (2 * r * d)))) / DEG;
    let ra = Math.atan2(eq[1], eq[0]) / DEG;
    if (ra < 0) ra += 360;
    return { key, name, ra, dec: Math.asin(eq[2]) / DEG, dir: eq, mag: magnitude(key, r, d, phase), distAu: d, color };
  });
}
