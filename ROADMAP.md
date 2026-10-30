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
| **Launch day mode** | Countdown, webcast link, an estimated ascent track and moving marker on the globe toward the likely target orbit, a 10× ascent preview, and the new objects as they are catalogued. |
| **Manoeuvre detection** | Each build compares element sets with the previous build's: payloads whose orbit changed more than drag explains are flagged (raise, lower, plane change, rough Δv) in Watch and the info panel. |
| **Breakup detection** | Jumps in a launch's catalogued debris between builds, in Watch, the info panel and on the history timeline. |
| **On this day** | A daily anniversary from the timeline, a list of famous dates and the catalogue, with a one-click jump. |

**Storytelling and data views**

| Feature | Notes |
| --- | --- |
| **Guided tours** | Fengyun-1C, Building the ISS, The Starlink era, How crowded is LEO: steps driving time, filters, camera and charts, narration computed from the data; `#tour=…`. |
| **More tours** | How GPS works, Molniya and Tundra orbits, The space race in orbit, Hubble's servicing missions, Kessler syndrome scenarios. |
| **GEO belt view** | Insights tab: the geostationary ring unrolled by longitude, station-kept, drifting and graveyard objects told apart. |
| **Coverage maps** | Live heatmaps on the globe for eight constellations and GNSS, with how many are above you now. |
| **Debris density on the globe** | Debris and stages binned by altitude and latitude, ray-marched as a glowing haze around Earth. |
| **Conjunction geometry** | A close approach in 3D in the first object's RIC frame: the other's path, the miss vector and age-based uncertainty ellipsoids. |
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
| **"What did I just see?"** | Time, direction and motion in; ranked sunlit candidates out, with Starlink trains and bright planets recognised. |
| **Planets in the sky view** | Mercury to Saturn from JPL's approximate elements, with brightness and labels. |
| **Weather for passes** | Opt-in Open-Meteo cloud cover on every pass; bright passes under thick cloud hidden and counted. |
| **Light pollution** | City / suburbs / rural / dark-site setting for the naked-eye limit, stars and the Milky Way. |
| **AR guidance** | An edge arrow toward the selected object when off screen, and when and where it rises when it's down. |
| **Observing aids** | Red night-vision mode; binocular, finder and telescope field-of-view circles. |
| **Watchlist** | My satellites: starred objects with their next visible pass and alerts for all of them. |

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
| **Embed variants** | Sky view from a fixed place, an `<orbital-objects>` element served as `embed.js` and published as `packages/embed`, and an oEmbed endpoint. |
| **Pipeline status page** | `status.html`: when each source was last fetched, counts by source and type, and backfill progress. |
| **Poster export** | A4, square and 4K renders with title, date and legend, on any date back to 1957. |
| **Ambient / kiosk mode** | Full screen, no panels, cycling scenes with large captions; `K` or `?kiosk`. |
| **Sonification** | Chimes as bright satellites rise from your location, and Sputnik's beep in the 1957 replay. |

## Observing, taken further

- **Shadow entry and exit (S):** mark the moment in a pass when an object vanishes into Earth's shadow, or emerges from it: the classic "it just disappeared" sighting.
- **Flare and glint predictions (M):** bright reflections from flat surfaces (solar arrays, Starlink chassis), which brightness from size alone can't predict.
- **Transits of the Sun and Moon (M):** when the ISS or Tiangong crosses the Sun or Moon from near you, with the centre line and timing, for astrophotographers.
- **Planets on the globe and in passes (S):** mark conjunctions of bright satellites with planets or the Moon in the pass list ("passes 2° from Jupiter").

## Better data

- **Altitude history per object (M):** a chart of each object's perigee and apogee over its whole life from `gp_history`: orbit raising after launch, station reboosts, decay curves.
- **Supplemental element sets (M):** CelesTrak's operator-supplied SupGP data for Starlink, OneWeb and others, which is more accurate than the public catalogue for those fleets.
- **Element-set age and accuracy (S):** how old each object's elements are, and a rough position uncertainty that grows with age, shown in the info panel and as a colour mode.
- **Space weather and drag (M):** solar flux and geomagnetic activity (NOAA SWPC), with their effect on decay rates and re-entry predictions, e.g. during solar storms like May 2024.
- **Real launch trajectories (M):** replace launch day's estimated ascent with the provider's published profile where there is one, and snap to the first real element set once the new objects are catalogued.
- **How a close approach evolved (S):** keep each build's SOCRATES prediction so the geometry view can show how the predicted miss distance changed as the encounter approached.
- **Beyond Earth orbit (L):** spacecraft at L1/L2 and in lunar orbit (JWST, SOHO, lunar missions) from JPL Horizons, with a zoomed-out cislunar view.

## Visualising more

- **Sunlit and shadowed orbit segments (S):** shade the selected orbit where it passes through Earth's shadow.
- **Ground stations (S):** major tracking and downlink stations on the globe, with which ones can see the selected object.
- **Coverage over time (S):** play a coverage map forward to watch gaps open and close, and compare two constellations side by side.
- **VR (M–L):** WebXR for headsets, standing in orbit next to a model or inside the debris field.

## Learning and stories

- **Tour authoring (M):** tours as JSON files anyone can contribute through a pull request, with a simple format for steps, camera and narration.
- **Orbit playground (M):** an interactive lesson. Drag sliders for altitude, inclination and eccentricity, and watch an orbit and its ground track respond; compare with real objects that fly it.

## Personal

- **Multiple locations (S):** home, a dark-sky site, a holiday destination; switch between them in the sky section.
- **Background notifications (L):** pass alerts even when the site is closed. This needs a push service, so a small serverless function, which the static site doesn't have yet.

## Platform and quality

- **Smaller downloads (M):** a binary catalogue (as the history snapshots already use), daily deltas, and a lighter catalogue for the embed widget.
- **Accessibility (M):** a screen-reader-friendly list view of what is on the globe, full keyboard navigation of objects, a high-contrast theme, and captions for tours.
- **Localisation (M):** translated interface text, local number and date formats.
- **Automated tests in CI (M):** the browser checks used during development, as a Playwright suite in the repository, run against the sample data on every pull request, with screenshot comparisons.
- **Performance on low-end devices (S–M):** automatic quality levels (bloom, texture size, point count) based on frame rate; a WebGPU renderer later (L).

## Fun

- **Object cards (S):** a shareable image card for any object (name, photo from Wikipedia, orbit sketch, key numbers), like a trading card.
- **Spotting challenges (S):** a checklist of bright satellites to see with your own eyes, ticked off automatically when you mark a pass as seen.
