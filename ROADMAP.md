# Roadmap

Plans for Orbital Objects. Effort is a rough guide: **S** is a few hours, **M** is about a day, **L** is a bigger project.

- [Done](#done): what has shipped.
- [Up next](#up-next): the current to-do list, grouped by theme.
- [Idea list](#idea-list): earlier ideas that aren't scheduled. Any of them can be promoted to Up next.

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
| **Launch day mode** | Countdown, webcast link, an ascent track and moving marker on the globe, a 10× ascent preview, and the new objects as they are catalogued. |
| **Real launch trajectories** | The track uses Launch Library's published flight events and the drone ship's position, and snaps to the first catalogued orbit once the objects appear. |
| **How a close approach evolved** | Each build's SOCRATES prediction kept per encounter: a chart in the geometry view, and ▼/▲ trends in the Watch list. |
| **Manoeuvre detection** | Each build compares element sets with the previous build's: payloads whose orbit changed more than drag explains are flagged (raise, lower, plane change, rough Δv) in Watch and the info panel. |
| **Space weather and drag** | NOAA SWPC solar cycle, flux and Kp with forecast in an Insights tab; per-object sinking rate and rough lifetime; the 2022 Starlink and 2024 Gannon storms on the timeline. |
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
| **Transits of the Sun and Moon** | ISS, Tiangong, Hubble and your satellites crossing the Sun or Moon within 100 km of you, with the centre line and strip drawn on the globe. |
| **Background notifications** | Pass alerts while the site is closed, through a dependency-free Cloudflare Worker (Web Push, VAPID, aes128gcm, tested against RFC 8291). |
| **"What did I just see?"** | Time, direction and motion in; ranked sunlit candidates out, with Starlink trains and bright planets recognised. |
| **Planets in the sky view** | Mercury to Saturn from JPL's approximate elements, with brightness and labels. |
| **Weather for passes** | Opt-in Open-Meteo cloud cover on every pass; bright passes under thick cloud hidden and counted. |
| **Light pollution** | City / suburbs / rural / dark-site setting for the naked-eye limit, stars and the Milky Way. |
| **AR guidance** | An edge arrow toward the selected object when off screen, and when and where it rises when it's down. |
| **Observing aids** | Red night-vision mode; binocular, finder and telescope field-of-view circles. |
| **Watchlist** | My satellites: starred objects with their next visible pass and alerts for all of them. |
| **Radio passes** | SatNOGS DB transmitters for each satellite, live Doppler-corrected downlink and uplink, the next pass at any elevation as a polar plot, and a list of amateur-satellite passes over the next 12 hours. |
| **Starlink train forecasts** | Recent batches still bunched in a line, with the line's length and their visible passes for 3 days; "Train tonight" when one is coming. |
| **Aurora forecast** | NOAA OVATION, fetched live with a build-time fallback: chance overhead or toward the pole from your location, the oval on the globe and flat map, and a glow in the sky view. |
| **Eclipses on the globe** | Ten years of solar and lunar eclipses computed in the browser (Meeus lunar theory; paths within roughly 10–30 km), local circumstances, central line and limits on the globe, the Moon's shadow crossing the Earth, and the satellites inside it. |
| **Observation log** | "I saw it" with the predicted position (az/el and J2000 RA/Dec), editable with what you measured; CSV export, and IOD export for measured positions. |
| **Telescope and planetarium links** | A TLE file for Stellarium and other planetarium apps, Stellarium's Remote Control plugin, and LX200-compatible GoTo mounts over Web Serial (with a Sun-avoidance check). |

**Richer object detail**

| Feature | Notes |
| --- | --- |
| **Altitude history per object** | Perigee and apogee over each object's life from the history snapshots, and daily from `gp_history` for famous objects. |
| **Element-set age and accuracy** | A data-age colour mode, and a rough position uncertainty that grows with age in the info panel. |
| **Supplemental element sets** | CelesTrak SupGP (operator-supplied) orbits for big fleets where they are current, marked in the info panel. |
| **Beyond Earth orbit** | JWST, Euclid, SOHO, ACE, DSCOVR, Wind and lunar orbiters from JPL Horizons, with a cislunar view and halo orbits in the rotating frame. |
| **3D models of famous objects** | True-scale ISS, Hubble and Tiangong in their real attitude, arrays tracking the Sun, lit by Sun and Earth, dark in eclipse. |
| **Real Moon and star field** | HYG stars in their true orientation and colours, Milky Way, constellation figures, the Moon at its real position and phase; Sun, Moon and stars toggle individually. |

**Data and analysis**

| Feature | Notes |
| --- | --- |
| **Daily digest and feed** | New objects by launch, re-entries, manoeuvres and breakups per day, from comparing each build with the last; a Watch tab and an Atom feed with links back to each day. |
| **Constellation health** | Starlink, OneWeb, Kuiper, Qianfan and Guowang by phase (raising, at working altitude, lowering, re-entered), with shells found from where each fleet clusters and an altitude-by-launch-date scatter. |
| **Disposal compliance** | Dead payloads and stages in LEO since 2000 by remaining lifetime (5 / 25 years), by owner and by decade, from a drag model and each object's B*; GEO retirees by graveyard or not. |
| **Launch statistics** | Launches per year by launch country since 1957 (SATCAT), and providers, rockets, failures, booster reuse and landing success for recent years (Launch Library 2, backfilled a page per build). |
| **Deployment replay** | Recent multi-satellite launches day by day from each satellite's element sets at the time (Space-Track `gp_history` when configured, otherwise collected at each build), with an altitude chart and how far they've spread. |
| **Hobbyist-tracked classified satellites** | Opt-in layer from Mike McCants' `classfd.tle`, merged at start-up and marked as an unofficial orbit. |
| **Bring your own element sets** | Paste two- or three-line element sets (checksums checked); kept on the device, drawn like any other object, replacing a catalogue orbit with the same NORAD number. They travel with sync codes rather than share links. |

**Views and learning**

| Feature | Notes |
| --- | --- |
| **Flat map view** | Full-screen equirectangular map (`M`) with every shown object, day and night with city lights, the selected ground track, your location and the aurora; zoom, pan, hover and select. |
| **Orbit families** | A colour mode and explorer filter: sun-synchronous, polar, other LEO, MEO, GTO, Molniya, Tundra (and quasi-zenith), geosynchronous, other; named in each object's details. |
| **Radiation belts** | A ray-marched overlay from an offset, tilted dipole (so the inner belt dips over the South Atlantic), and the share of each orbit spent in each belt. |
| **Glossary tooltips** | Definitions on hover, focus or tap for labels across the panels, and the full glossary in About. |

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
| **Alerts anywhere** | The push worker also sends pass alerts to ntfy, Discord and Slack (only their own webhook addresses accepted) and serves a calendar feed refreshed whenever the site syncs. |
| **Sync across devices** | A 20-character code; data is encrypted in the browser (PBKDF2 + AES-GCM) before the worker stores it for 14 days. |
| **Alerts & sound menu** | One menu for sounds, rise alerts (elevation, which objects, how dark the sky must be; chime, pop-up or notification), pass alert preferences, notification permission and tests, and the push service's channels with test sends. |
| **Explanations everywhere** | A styled explanation for every control on hover, keyboard focus or long press, from the control's own text or a central table; can be switched off. |

## Up next

### Learning

- **Classroom pack (M):** lesson plans and worksheets that link into the app, with a teacher mode that keeps everyone on the same step.
- **Ask in plain words (M):** search that understands requests like "ISS passes tonight" or "Chinese satellites in GEO" and turns them into filters and views.

### Integrations and community

- **Social bot (M):** automatic posts to Bluesky and Mastodon for re-entries, breakups and big launches, with a poster image, from the build pipeline.
- **Open data docs (S):** document the published JSON and binary files as a versioned API, so other projects can build on them.

## Idea list

Earlier ideas that are not scheduled yet.

### Observing, taken further

- **Shadow entry and exit (S):** mark the moment in a pass when an object vanishes into Earth's shadow, or emerges from it: the classic "it just disappeared" sighting.
- **Flare and glint predictions (M):** bright reflections from flat surfaces (solar arrays, Starlink chassis), which brightness from size alone can't predict.
- **Transit photo planner (S):** for a chosen transit, a map of the strip with roads and the best spot near you, and the exact moment to the tenth of a second.
- **Planets on the globe and in passes (S):** mark conjunctions of bright satellites with planets or the Moon in the pass list ("passes 2° from Jupiter").

### Better data

- **Re-entry predictions that react to space weather (M):** re-run decay estimates with the forecast solar flux and Kp, and show how a storm moves a predicted re-entry.
- **Mars and beyond (M):** the same Horizons pipeline for interplanetary probes, in a zoomable inner-solar-system view.

### Visualising more

- **Sunlit and shadowed orbit segments (S):** shade the selected orbit where it passes through Earth's shadow.
- **Ground stations (S):** major tracking and downlink stations on the globe, with which ones can see the selected object.
- **Coverage over time (S):** play a coverage map forward to watch gaps open and close, and compare two constellations side by side.
- **VR (M–L):** WebXR for headsets, standing in orbit next to a model or inside the debris field.

### Learning and stories

- **Tour authoring (M):** tours as JSON files anyone can contribute through a pull request, with a simple format for steps, camera and narration.
- **Orbit playground (M):** an interactive lesson. Drag sliders for altitude, inclination and eccentricity, and watch an orbit and its ground track respond; compare with real objects that fly it.

### Personal

- **Multiple locations (S):** home, a dark-sky site, a holiday destination; switch between them in the sky section.

### Platform and quality

- **Smaller downloads (M):** a binary catalogue (as the history snapshots already use), daily deltas, and a lighter catalogue for the embed widget.
- **Accessibility (M):** a screen-reader-friendly list view of what is on the globe, full keyboard navigation of objects, a high-contrast theme, and captions for tours.
- **Localisation (M):** translated interface text, local number and date formats.
- **Automated tests in CI (M):** the browser checks used during development, as a Playwright suite in the repository, run against the sample data on every pull request, with screenshot comparisons.
- **Performance on low-end devices (S–M):** automatic quality levels (bloom, texture size, point count) based on frame rate; a WebGPU renderer later (L).

### Fun

- **Object cards (S):** a shareable image card for any object (name, photo from Wikipedia, orbit sketch, key numbers), like a trading card.
- **Spotting challenges (S):** a checklist of bright satellites to see with your own eyes, ticked off automatically when you mark a pass as seen.
