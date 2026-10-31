import { $, h } from './dom';

/**
 * Plain-language definitions wherever jargon appears. Labels in the panels
 * whose text is a glossary term get a dotted underline; hovering, focusing or
 * tapping them shows the definition. The full list is in About.
 */
export const GLOSSARY: [string, string][] = [
  ['Apogee', 'The highest point of an orbit above the Earth.'],
  ['Perigee', 'The lowest point of an orbit above the Earth.'],
  ['Period', 'How long one trip around the Earth takes.'],
  ['Inclination', 'How tilted the orbit is against the equator: 0° circles the equator, 90° passes over both poles, above 90° goes round backwards (retrograde).'],
  ['Eccentricity', 'How stretched the orbit is: 0 is a perfect circle, close to 1 a long thin ellipse.'],
  ['Semi-major axis', 'Half the longest width of the orbit’s ellipse, measured from Earth’s centre: its average size.'],
  ['Mean motion', 'Orbits per day.'],
  ['RAAN', 'Right ascension of the ascending node: where, against the stars, the orbit crosses the equator going north. It sets which way the orbit plane faces.'],
  ['Arg. of perigee', 'Argument of perigee: how far round the orbit, from where it crosses the equator northward, its lowest point is.'],
  ['Mean anomaly', 'Where the object is along its orbit at the element set’s epoch, as an angle from perigee.'],
  ['Orbit family', 'The kind of orbit, by purpose: sun-synchronous, geostationary, Molniya and so on.'],
  ['Epoch (UTC)', 'The moment the element set describes. Predictions are best near it and drift the further from it you go.'],
  ['Element set', 'The handful of numbers (a TLE or OMM) that describe an orbit at one moment; SGP4 works out positions from them.'],
  ['B* drag', 'A drag term in the element set: bigger means the atmosphere slows it more (light, large objects low down).'],
  ['ṅ / 2', 'Half the rate the mean motion is changing: how quickly drag is shrinking the orbit.'],
  ['Propagator', 'The model that works out positions from an element set. SGP4 is the standard one for these orbits.'],
  ['Accuracy now', 'A rough error estimate from the element set’s age: errors grow fastest along the direction of travel.'],
  ['NORAD', 'The U.S. Space Force catalogue number: every tracked object has one.'],
  ['COSPAR', 'The international designator: launch year, launch number that year, and a letter for each piece.'],
  ['Radar cross-section', 'How big the object looks to radar: a rough guide to its size.'],
  ['Illumination', 'Whether the object is in sunlight or in Earth’s shadow. It can only be seen when sunlit against a dark sky.'],
  ['Brightness', 'Predicted visual magnitude: smaller is brighter. Venus is about −4, the faintest stars you can see from a dark site about 6.'],
  ['Elevation', 'Angle above your horizon: 0° on the horizon, 90° straight overhead.'],
  ['Azimuth', 'Compass direction: 0° north, 90° east, 180° south, 270° west.'],
  ['Range', 'Straight-line distance from you.'],
  ['Radiation belts', 'The Van Allen belts: zones where Earth’s magnetic field traps fast particles that can damage electronics.'],
  ['Operational status', 'Whether the satellite is still working, as published in the satellite catalogue.'],
  ['Kp', 'Planetary K index, 0–9: how disturbed Earth’s magnetic field is. Kp 5 or more is a geomagnetic storm, and aurora reach further from the poles.'],
  ['LEO', 'Low Earth orbit: below about 2,000 km. Space stations, Starlink and most debris.'],
  ['MEO', 'Medium Earth orbit: between LEO and geostationary, home of the navigation satellites.'],
  ['GEO', 'Geostationary orbit, 35,786 km up over the equator: one orbit a day, so it hangs over one spot.'],
  ['HEO', 'Highly elliptical orbit: swings from low to very high, lingering high up.'],
  ['TLE', 'Two-line element set: the classic 69-character format for orbital elements.'],
  ['SupGP', 'Supplemental element sets from satellite operators’ own tracking, published by CelesTrak: usually more accurate.'],
  ['TCA', 'Time of closest approach between two objects.'],
  ['Miss distance', 'How close two objects are predicted to pass.'],
  ['Doppler', 'The shift in a radio signal’s frequency as the satellite approaches (higher) or recedes (lower).'],
  ['Umbra', 'The fully dark core of a shadow: inside the Moon’s umbra the Sun is completely hidden (a total eclipse).'],
  ['Penumbra', 'The partly dark outer shadow: from inside it the Sun is partly covered.'],
  ['Magnitude', 'For a solar eclipse, how much of the Sun’s diameter the Moon covers; for a star or satellite, its brightness (smaller is brighter).'],
  ['Gabbard diagram', 'A plot of apogee and perigee against orbital period: a breakup’s debris fans out in an X shape.'],
  ['Graveyard', 'The disposal orbit a few hundred km above geostationary, where retired GEO satellites are parked out of the way.'],
  ['Sun-synchronous', 'An orbit tilted just past polar that turns with the seasons, so the satellite crosses each place at the same local time.'],
  ['Molniya', 'A 12-hour, very elliptical orbit tilted 63.4° that hangs high over the far north for hours.'],
  ['IOD', 'Interactive Orbit Determination: the text format amateur observers use to report measured satellite positions.'],
  ['F10.7', 'Solar radio flux at 10.7 cm: a stand-in for the Sun’s ultraviolet output, which heats the upper atmosphere and raises drag.'],
];

const DEFS = new Map(GLOSSARY.map(([k, v]) => [k.toLowerCase(), v]));
/** Where to look for terms: labels in the info panel, Insights, the explorer and the Watch panel. */
const SELECTOR = '.kv dt, .live .l, th, .glo';

export function glossaryTerm(text: string) {
  return DEFS.get(text.trim().toLowerCase().replace(/\s*\(.*\)$/, '')) ?? DEFS.get(text.trim().toLowerCase()) ?? null;
}

function annotate(root: ParentNode) {
  for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) {
    if (el.dataset.gl !== undefined) continue;
    // The text of the label itself (h3s carry a <span> with extra detail).
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() || el.textContent!.trim();
    const def = glossaryTerm(own);
    el.dataset.gl = def ? '1' : '';
    if (!def) continue;
    el.classList.add('gl-term');
    el.tabIndex = 0;
    el.setAttribute('aria-description', def);
  }
}

export function mountGlossary() {
  const tooltip = $('#tooltip');
  let showing: HTMLElement | null = null;
  const show = (el: HTMLElement) => {
    const def = el.getAttribute('aria-description');
    if (!def) return;
    showing = el;
    const r = el.getBoundingClientRect();
    tooltip.hidden = false;
    tooltip.classList.add('gl-tip');
    tooltip.style.left = `${r.left + Math.min(r.width, 120) / 2}px`;
    tooltip.style.top = `${r.bottom + 4}px`;
    tooltip.replaceChildren(h('b', null, (el.firstChild?.textContent ?? el.textContent ?? '').trim()), h('div', { class: 'tt-sub gl-def' }, def));
  };
  const hide = () => {
    if (!showing) return;
    showing = null;
    tooltip.hidden = true;
    tooltip.classList.remove('gl-tip');
  };
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as Element).closest?.('.gl-term') as HTMLElement | null;
    if (el) show(el);
    else if (showing) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = (e.target as Element).closest?.('.gl-term') as HTMLElement | null;
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);
  // Taps on touch screens toggle it.
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest?.('.gl-term') as HTMLElement | null;
    if (el && showing !== el) show(el);
    else if (!el) hide();
  });
  let pending = 0;
  const mo = new MutationObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      annotate(document);
    });
  });
  mo.observe(document.getElementById('app')!, { childList: true, subtree: true });
  annotate(document);
}

/** The full list, for the About dialog. */
export function glossaryList() {
  return h('dl', { class: 'glossary' }, ...GLOSSARY.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}
