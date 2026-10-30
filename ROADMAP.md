# Roadmap

Ideas for Orbital Objects, grouped by theme. Effort is a rough guide: **S** is a few hours, **M** is about a day, **L** is a bigger project.

## Done

Everything below has shipped and is described in the [README](README.md#features).

**Foundations**

| Feature | Notes |
| --- | --- |
| Live globe, search, filters, info panel, insights | Initial release. |
| **Shareable state links** | The URL holds the selected object, filters, colouring, time or history date, camera and view (close-up, sky view, tour). Your location is included only if you opt in. Old `#25544` links still work. |
| **Wikipedia summaries** | Exact match by COSPAR ID through Wikidata. Otherwise falls back to the debris event, the constellation, or the parent launch's article. |

**History**

| Feature | Notes |
| --- | --- |
| Time scrubber and space-age replay | History timeline back to October 1957. |
| **Real history, including re-entered objects** | `history.json` holds every catalogued object that has re-entered. Final orbits come from Space-Track and are refreshed weekly; where none is published, the orbit is reconstructed from SATCAT. Objects appear at launch and disappear at re-entry. |
| **History timeline events** | 22 milestones on the time slider, colour-coded by kind. Clicking one jumps there and highlights the objects involved; close-together markers merge into a picker, and captions appear during playback. |
| **Historical element sets** | Yearly 1 January snapshots from Space-Track `gp_history`, so every object is drawn on the orbit it had then. Backfilled 16 snapshots per build by default and cached. |
| **Finer snapshots** | Quarterly snapshots for the last ten years, plus one at the moment of each timeline event. |
| **True positions** | Snapshots keep the original element sets; when not fast-forwarding, history mode propagates them with SGP4 to the exact instant. Debris appears once it was first tracked. |

**Topical and newsworthy**

| Feature | Notes |
| --- | --- |
| **Re-entry watch** | Space-Track decay predictions and TIP messages (countdowns, uncertainty windows, predicted locations), plus re-entries from the last 30 days with a "replay its last day" view. |
| **Close approaches** | CelesTrak SOCRATES: miss distance, speed, probability and TCA, with a jump-to-encounter view linking the two objects with a live distance. |
| **Upcoming launches** | Launch Library 2 with countdowns, mission details and pad markers on the globe; recent launches grouped from the catalogue. |

**Storytelling and data views**

| Feature | Notes |
| --- | --- |
| **Guided tours** | Fengyun-1C, Building the ISS, The Starlink era, How crowded is LEO: steps driving time, filters, camera and charts, narration computed from the data; `#tour=…`. |
| **Gabbard diagram** | Insights → Debris & crowding, with presets for the major debris clouds. |
| **Crowding by altitude** | Objects per 10⁹ km³ in 20 km LEO shells, time-weighted across elliptical orbits; history-aware. |
| **Owner pages** | Fleet over time, orbit spread, payload status, groups, launch sites, notable objects. |
| **Compare two objects** | Distance over time with closest approach, side-by-side orbits, plane angle, live distance line. |

**Your sky**

| Feature | Notes |
| --- | --- |
| Your sky | Device, globe-pick or manual location; above-horizon and naked-eye filters; sky plot; pass predictions. |
| **Brightness predictions** | Standard magnitudes from Mike McCants' `qs.mag` (estimated from radar size otherwise), scaled for range, phase and extinction. |
| **Pass alerts and calendar export** | `.ics` download of visible passes (per object, or the brightest 180 over the next day), and browser notifications before visible passes while the tab is open. |
| **Sky view and AR mode** | First-person sky with twilight colours, real stars, satellites sized by brightness, labels and paths; drag/zoom, or point a phone at the sky. |
| **"What did I just see?"** | Time, direction and motion in; ranked sunlit candidates out, with Starlink trains recognised. |

**Richer object detail**

| Feature | Notes |
| --- | --- |
| **3D models of famous objects** | True-scale ISS, Hubble and Tiangong in their real attitude, arrays tracking the Sun, lit by Sun and Earth, dark in eclipse. |
| **Real Moon and star field** | HYG stars in their true orientation and colours, Milky Way, constellation figures, the Moon at its real position and phase; Sun, Moon and stars toggle individually. |

**Sharing and platform**

| Feature | Notes |
| --- | --- |
| **Export** | PNG screenshots with labels and caption; CSV of the filtered list with live positions; video recording, including a one-click space-age replay. |
| **Installable app and smoother loading** | Manifest and icons, service worker for instant repeat visits and offline use, catalogue preloading, low-resolution textures first, data-saver mode, long-lived library chunk. |
| **Embeddable widget** | `?embed` mode with caption and link back, snippet builder, `postMessage` API. |

## Observing, taken further

- **Planets in the sky view (S):** Mercury to Saturn, labelled, since they are often mistaken for satellites. Low-precision orbital elements are enough at this scale.
- **Weather for passes (S–M):** cloud cover for each visible pass from a free forecast API (e.g. Open-Meteo), straight from the browser, so the bright-pass list only shows passes you might actually see.
- **Light pollution (S):** a sky-quality setting (city, suburb, rural, dark site) that sets the faintest magnitude counted as visible, instead of a fixed 4.5.
- **Shadow entry and exit (S):** mark the moment in a pass when an object vanishes into Earth's shadow, or emerges from it: the classic "it just disappeared" sighting.
- **Flare and glint predictions (M):** bright reflections from flat surfaces (solar arrays, Starlink chassis), which brightness from size alone can't predict.
- **Transits of the Sun and Moon (M):** when the ISS or Tiangong crosses the Sun or Moon from near you, with the centre line and timing, for astrophotographers.
- **AR guidance (S):** in the phone sky view, an arrow toward the selected object when it is off-screen, and a countdown to its rise.
- **Observing aids (S):** a red night-vision mode, and binocular/telescope field-of-view circles in the sky view.

## Better data

- **Altitude history per object (M):** a chart of each object's perigee and apogee over its whole life from `gp_history`: orbit raising after launch, station reboosts, decay curves.
- **Manoeuvre detection (M):** flag objects whose orbit changed abruptly between element sets ("recently manoeuvred"), with a filter and a Watch entry.
- **Supplemental element sets (M):** CelesTrak's operator-supplied SupGP data for Starlink, OneWeb and others, which is more accurate than the public catalogue for those fleets.
- **Element-set age and accuracy (S):** how old each object's elements are, and a rough position uncertainty that grows with age, shown in the info panel and as a colour mode.
- **Space weather and drag (M):** solar flux and geomagnetic activity (NOAA SWPC), with their effect on decay rates and re-entry predictions, e.g. during solar storms like May 2024.
- **Breakup detection (M):** notice new fragmentation events automatically, when a parent object's debris count jumps between builds, and add them to Watch and the timeline.
- **Beyond Earth orbit (L):** spacecraft at L1/L2 and in lunar orbit (JWST, SOHO, lunar missions) from JPL Horizons, with a zoomed-out cislunar view.

## Visualising more

- **GEO belt view (M):** the geostationary ring unrolled by longitude, with station-keeping slots, drifting objects and the graveyard orbit above.
- **Coverage maps (M):** how many satellites of a constellation (Starlink, GPS, Iridium) can see each point on Earth, as a live heatmap, and "how many are above you right now".
- **Debris density on the globe (M):** a 3D density cloud or altitude-band heatmap drawn around Earth, not just in a chart.
- **Sunlit and shadowed orbit segments (S):** shade the selected orbit where it passes through Earth's shadow.
- **Ground stations (S):** major tracking and downlink stations on the globe, with which ones can see the selected object.
- **Conjunction geometry (M):** a close-up of a close approach with both objects' uncertainty ellipsoids and relative motion.
- **VR (M–L):** WebXR for headsets, standing in orbit next to a model or inside the debris field.

## Learning and stories

- **More tours (S each):** GPS and how navigation works, Molniya and Tundra orbits, the Moon race, Hubble's servicing missions, Kessler syndrome scenarios.
- **Tour authoring (M):** tours as JSON files anyone can contribute through a pull request, with a simple format for steps, camera and narration.
- **Orbit playground (M):** an interactive lesson. Drag sliders for altitude, inclination and eccentricity, and watch an orbit and its ground track respond; compare with real objects that fly it.
- **Launch day mode (L):** follow a launch live: countdown, webcast, an estimated ascent track, and the new objects appearing as they are catalogued.
- **"On this day" (S):** a daily highlight from the timeline and catalogue, e.g. a launch anniversary, with a one-click jump.

## Personal

- **Watchlist (S):** star objects to keep them in a "My satellites" list with their next visible passes, and alerts on for all of them.
- **Multiple locations (S):** home, a dark-sky site, a holiday destination; switch between them in the sky section.
- **Background notifications (L):** pass alerts even when the site is closed. This needs a push service, so a small serverless function, which the static site doesn't have yet.

## Platform and quality

- **Smaller downloads (M):** a binary catalogue (as the history snapshots already use), daily deltas, and a lighter catalogue for the embed widget.
- **Accessibility (M):** a screen-reader-friendly list view of what is on the globe, full keyboard navigation of objects, a high-contrast theme, and captions for tours.
- **Localisation (M):** translated interface text, local number and date formats.
- **Automated tests in CI (M):** the browser checks used during development, as a Playwright suite in the repository, run against the sample data on every pull request, with screenshot comparisons.
- **Pipeline status page (S):** a small page showing when each data source was last fetched, how many objects came from where, and the snapshot backfill progress.
- **Performance on low-end devices (S–M):** automatic quality levels (bloom, texture size, point count) based on frame rate; a WebGPU renderer later (L).
- **Embed variants (M):** an embeddable sky view for a fixed location, an oEmbed endpoint for blogs, and a small npm package wrapping the iframe and its messages.

## Fun

- **Poster export (S–M):** high-resolution prints of a chosen view, with a title, date and legend, e.g. "Everything in orbit on my birthday".
- **Ambient / kiosk mode (S):** full-screen, self-driving tours and slow camera moves for displays and screensavers.
- **Sonification (S):** a soft sound as bright satellites pass overhead, and Sputnik's beep in the 1957 replay.
