# Orbital Objects

An explorable, real-time 3D globe of every publicly tracked object orbiting Earth: working satellites, spent rocket bodies and debris. Positions are propagated live in the browser with SGP4/SDP4 from the latest published element sets.

## Features

**Globe**
- Day/night Earth shader using NASA Blue Marble and Black Marble imagery. It renders the real-time sun position, city lights on the night side, ocean sun glint, bump-mapped terrain, drifting clouds with cloud shadows, and an atmospheric scattering rim that turns orange at the terminator.
- Every catalogued object is drawn as a glowing point and animated at full frame rate (see *How it works*).
- Colour by object type, orbit regime, owner, operational status or launch year. The palettes are checked for colour-blind separation.
- The real sky around it: about 26,000 stars to magnitude 7.5 from the HYG catalogue, placed and coloured by their true positions and colours, a faint Milky Way along the galactic plane, and optional constellation figures. The Moon is at its real position and distance, lit by the Sun with the correct phase, and darkens in Earth's shadow during a lunar eclipse.
- The Sun, Moon, stars and constellation figures can each be switched off under **Layers → Sky**.

**Up close** (the **See it up close** button on the ISS, Hubble and Tiangong, or `…/#s=25544&v=3d`)
- The camera flies in to a true-scale 3D model of the object, flying in its real attitude (station nose-forward, belly to Earth) at its real SGP4 position, with Earth below.
- Solar arrays turn to face the Sun. The model is lit by the real Sun and by blue light from Earth, and goes dark when the object passes into Earth's shadow.
- Drag to look around and scroll or pinch to zoom; zooming out far enough, or `Esc`, flies back to the globe.

**Search and explore**
- Search by name, NORAD ID, COSPAR ID, owner or mission group.
- Faceted filters (type, regime, status, owner, mission/constellation, launch year, altitude), each with live counts. The launch-year and altitude sliders show histograms.
- Quick views: ISS, Tiangong, Hubble, Starlink, GNSS, the GEO belt, debris and space stations.
- When a filtered set is small (400 objects or fewer), each object's orbit is drawn as a faint ring.

**Info panel**
- Live altitude, velocity, latitude/longitude, sunlit or eclipse state, and orbit number.
- Ground-track minimap with the day/night terminator and the object's visibility footprint.
- Altitude profile over the next orbit, and an orbit diagram drawn to scale.
- Full orbital elements, a reconstructed TLE (with a copy button), and launch and ownership details: owner, launch date and site, time in orbit, radar cross-section and status.
- The five nearest objects right now, mission groups, and links out to CelesTrak, N2YO, Heavens-Above, NASA NSSDCA and Wikipedia.
- **Compare:** pick any second object to see:
  - their distance over the coming day or more (SGP4), with the closest approach (time, distance, relative speed) and a jump-to button;
  - a side-by-side table of their orbits, and the angle between their orbit planes;
  - a live distance line between the two on the globe.

**Owner profiles** (from the owner badge in the info panel, or the › next to any owner in the explorer)
- Objects in orbit, active payloads, debris, rocket bodies, re-entered objects and payloads ever launched.
- Fleet in orbit over time since 1957, stacked by type and including re-entered objects.
- Spread across orbit regimes, payload status (active vs. inactive), top constellations and missions, launch sites (counted per launch), and notable objects: the oldest still in orbit, the newest, and the largest.

**Guided tours** (in the explorer, or share one with `…/#tour=starlink`)
- *The Fengyun-1C debris cloud*, *Building the ISS*, *The Starlink era* and *How crowded is low Earth orbit?*
- Each step drives the time, filters, camera and charts. The numbers in the narration are computed live from the data. Use `←`/`→` to step through a tour, or Auto to advance automatically.

**Time**
- Run live, pause, or warp time from −1 day/s to +1 day/s, and jump back to the present.
- Scrub track with two zones. The right-hand zone covers the last 30 days and the next 7, with real propagated positions. The left-hand zone is a history timeline back to Sputnik (October 1957).
- History mode and **Replay 1957→** show the real population at each date. Objects appear at launch and disappear with a red flash when they re-enter. Sputnik 1 appears in October 1957 and is gone by January 1958. A year counter shows how many objects are in orbit, and a curve behind the track shows the total over time. Playback runs from 1 month/s to 8 years/s.
- Orbits come from snapshots of the U.S. Space Force element-set history (Space-Track `gp_history`): every 1 January since 1959, every quarter for the last ten years, and the moment of each timeline event. Every object, including ones that have since re-entered, is drawn on the orbit it had then, so orbital planes visibly drift as you scrub.
- **True positions:** when history mode isn't fast-forwarding, the history clock runs at real time. Within a few days of an SGP4-ready snapshot, every object is propagated with SGP4 from its own element set to that exact instant, so positions are real rather than illustrative. The note under the year says which mode is active. The Iridium–Cosmos event, for example, opens five minutes before the 2009 collision, with both satellites converging on their real orbits.
- Where there is no snapshot (the current year, or years not yet backfilled), objects still in orbit use today's orbits and re-entered ones their last known orbit. When no element set was ever published, the orbit is rebuilt from the catalogue's apogee, perigee and inclination. Debris appears once it was first tracked (its first element set), not on its parent object's launch date.
- Milestone markers on the time slider cover 22 events, from Sputnik 1 to the Cosmos 1408 test: firsts, space stations, constellations, debris events and famous re-entries. Clicking one jumps to that date and highlights the objects involved. Markers that are close together merge into a picker, and captions appear as playback passes each event.

**Your sky**
- Set your location in one of three ways: from the browser (geolocation), by clicking a point on the globe, or by typing latitude/longitude/elevation. Pasting "47.6, -122.3" and N/S/E/W suffixes both work. The location is saved in your browser only; it's never sent anywhere.
- Sky filter with three modes:
  - **Everything:** no filtering.
  - **Above horizon:** objects above a minimum elevation you set (0–60°).
  - **Visible to eye:** sunlit objects predicted brighter than magnitude 4.5, shown only while your sky is dark (Sun below −6°).
- The filtered list is sorted by elevation and shows azimuth/elevation for each object. Lines of sight are drawn from your location to the visible objects.
- A live sky plot (dome view) shows what's overhead, including the Sun and the selected object's track across your sky.
- The info panel adds live azimuth, elevation, range and predicted brightness from your location, and the next passes over the coming 48 hours. Each pass shows rise→set direction, duration, maximum elevation and its brightest predicted magnitude. Clicking a pass jumps time to it.
- **Brightness predictions:** each object's standard magnitude (how bright it is at 1000 km, half lit) comes from Mike McCants' published list where available, otherwise an estimate from its radar size. It is scaled for range, phase angle (how much of the lit side faces you) and atmospheric extinction.
- **Calendar and alerts:** download an object's visible passes for the next 7 days as an `.ics` calendar file (with a 10-minute reminder), or switch on alerts to get a browser notification 5 minutes before each visible pass while the tab is open. **Bright passes** in the sky section finds the visible passes of the brightest 180 objects over the next day, and exports them all to your calendar.
- **Sky view** (also `…/#v=sky`): stand at your location and look up.
  - The sky is coloured by the Sun's elevation: blue by day, through twilight, to a dark sky with real stars and the Milky Way. A low skyline marks the horizon, with compass points.
  - Satellites are drawn by predicted brightness: bright ones large, faint ones small, and those in Earth's shadow as dim dots, or hidden entirely with **Visible to eye**. The brightest are labelled with their magnitude. The selected object's path across the sky over ±10 minutes is drawn dashed.
  - Labels for bright stars, the Sun and the Moon (with its phase), plus optional constellation figures and an altitude/azimuth grid.
  - Drag to look around and scroll or pinch to zoom. On phones and tablets, **Point phone** uses the motion sensors and compass, so you can hold the phone up to the sky.
- **What did I see?** Enter when and roughly where you looked (and, optionally, which way it was moving). Every tracked object is propagated to that moment, and the sunlit, bright-enough candidates are ranked by how close they were to where you looked, how bright they were and their direction of travel. Groups of recently launched Starlink satellites are recognised as a "train". Picking a result sets the clock to that moment and points the sky view at it.

**Watch** (shortcut `R`; the badge counts anything happening in the next 24 hours)
- **Re-entries:**
  - Space-Track decay predictions and final TIP messages, each with a countdown, an uncertainty window and, where available, the predicted location marked on the globe.
  - Re-entries from the last 30 days, each of which can replay its final day in history mode.
  - Without Space-Track access the tab lists the lowest orbits instead.
- **Close approaches:**
  - Predicted near-misses from CelesTrak SOCRATES: miss distance, relative speed, maximum probability and time of closest approach (TCA), sortable by closest, soonest or most likely.
  - Clicking one sets the clock to two minutes before TCA and links the two objects with a line and a live distance readout.
- **Launches:**
  - Upcoming launches from The Space Devs' Launch Library 2, with countdowns, status, rocket, provider, pad, window and mission details.
  - Pads launching in the next 14 days are marked on the globe.
  - Launches from the last 30 days are grouped from the catalogue by international designator, so you can show every object a launch put up.

**About (Wikipedia)**
- The info panel shows the object's Wikipedia summary and image, matched exactly by COSPAR ID through Wikidata.
- When an object has no article of its own, the panel shows a related one instead: the debris event, the constellation, or the parent launch.
- These lookups go straight from your browser to Wikipedia and Wikidata.

**Insights**
- **Overview tab:** altitude distribution, launches per year, top owners, and an inclination-vs-altitude scatter plot.
- **Debris & crowding tab:**
  - A Gabbard diagram (apogee and perigee against orbital period), with one-click presets for the Fengyun-1C, Cosmos 2251, Iridium 33 and Cosmos 1408 debris clouds.
  - Crowding by altitude: objects per billion km³ in 20 km shells through low Earth orbit, stacked by type, with the most crowded shell labelled. Elliptical orbits are spread over the shells they cross, in proportion to the time spent in each.
- All charts are interactive: clicking a bar applies a filter, and hovering or clicking a point identifies or selects that object. In history mode every chart counts only what was in orbit at that date.
- In history mode, a debris fragment appears only once the snapshots show it being tracked, rather than on its parent object's launch date.

**Share, export and embed** (the **Share** menu)
- Shareable links: the URL holds the selected object, filters, colouring and (optionally) the time or history date and camera angle. Your location is included only if you switch it on. Short links like `…/#25544` still open straight onto the ISS.
- **Screenshot** (also `P`): a PNG of the view at full resolution, including the labels on screen and a caption with the date, what's shown and the data source.
- **CSV:** the filtered list as a spreadsheet: identifiers, type, owner, launch and re-entry dates, orbit (perigee, apogee, inclination, period, eccentricity), size, element-set epoch, and the current latitude, longitude and altitude. When your location is set, it also includes azimuth, elevation and predicted brightness. In history mode it lists what was in orbit at that date.
- **Record video:** records the globe, with its labels and a caption, to a WebM file (MP4 in Safari) at up to 720p, until you press **Stop & save** (5 minutes at most). **Record replay** captures the whole space age, 1957 to today, in about 40 seconds.
- **Embed:** generates an `<iframe>` snippet for a live, interactive globe of the current selection or filter, at a choice of sizes, with or without a caption and auto-rotation. See *Embedding* below.

**Installable app**
- Install it from the **Install** button (Chrome, Edge, Android), or in Safari on iPhone and iPad with Share → Add to Home Screen. It opens full screen, with shortcuts to the sky view, the ISS and the space-age replay.
- A service worker keeps the app and the last data it downloaded on the device. Repeat visits open from the cache, and offline the site still works, with a banner saying how old the data is. Data files are refreshed whenever they are more than 15 minutes old.
- Faster first load: the catalogue download starts in parallel with the scripts, the globe appears with small textures that are swapped for full resolution a moment later (skipped on slow or data-saver connections), and three.js is cached separately from the app, so a new deploy only re-downloads the app code.

**General**
- Responsive layout. On phones the panels become bottom sheets.

Keyboard: `P` screenshot · `/` search · `Esc` deselect (or leave the close-up or sky view) · `Space` pause · `[` `]` time warp · `N` live · `H` replay the space age · `R` watch (re-entries, close approaches, launches) · `F` follow · `I` insights · `L` layers · `?` help. With the scrub track focused, `←` `→` step through time (hold `Shift` for bigger steps), and `Home` / `End` jump to 1957 / now. In the sky view, the arrow keys look around and `+` / `−` zoom.

## Embedding

Add `?embed` to any link to get just the globe, with a small caption and an "Orbital Objects ↗" link back to the full site. The **Share → Embed** section builds the snippet for you:

```html
<iframe src="https://<user>.github.io/OrbitalObjects/?embed#s=25544" width="640" height="400" style="border:0;border-radius:12px;max-width:100%" loading="lazy" allow="fullscreen" title="Orbital Objects: ISS"></iframe>
```

- Everything after `#` works as in a normal link: `s=` selects (and follows) an object, `g=`, `q=`, `t=` and the other filters narrow what's shown, `c=` sets the colouring, and `v=3d` opens the close-up model.
- `&info=0` hides the caption, and `&rotate=0` stops the idle auto-rotation.
- The widget doesn't capture the host page's scrolling until someone clicks it, and never changes the full site's saved settings.
- The host page can control it with `postMessage`:
  - `{ type: 'orbital-objects:select', norad: 20580 }` (or `norad: null` to clear the selection);
  - `{ type: 'orbital-objects:search', query: 'starlink' }`.
- The widget announces each selection back with `{ type: 'orbital-objects:selected', norad, name }`.

## Deploying to GitHub Pages

1. In the repository on GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push to `main`, or run the **Build & deploy to GitHub Pages** workflow manually from the Actions tab.

The workflow (`.github/workflows/deploy.yml`):
- Fetches fresh orbital data on every deploy and also on a schedule every 6 hours, so the site stays current without any commits.
- Caches the raw API responses. If CelesTrak is down or rate-limits the runner, the build falls back to the last good copy, and failing that to the catalogue that is currently deployed.
- Refuses to deploy an empty or suspiciously small catalogue. A failed refresh leaves the previous site in place.
- On pull requests, only typechecks and builds against the offline sample.

### Optional: the full catalogue, including all debris

Without credentials, the catalogue is the union of all of CelesTrak's public GP groups: active satellites, stations, constellations, the major debris events and so on. That is roughly 15–20k objects.

To include every tracked object (30k+, with all debris and rocket bodies), create a free [Space-Track.org](https://www.space-track.org) account. Then add the repository secrets `SPACETRACK_USER` and `SPACETRACK_PASS` under **Settings → Secrets and variables → Actions**. The workflow picks them up automatically.

The same credentials also enable:
- Final orbits for re-entered objects in history mode (about 40k element sets, cached and refreshed weekly).
- Orbital snapshots for history mode (yearly, quarterly for the last decade, and one per timeline event), written to `history/<key>.bin` at about 26 bytes per object. They keep each object's original element set, including its epoch and drag term, so SGP4 can propagate them. A snapshot never changes once taken, so it is cached permanently. The backfill is spread across runs, 16 snapshots per run by default (events first, then recent quarters, then years); change this with the `HISTORY_SNAPSHOT_BUDGET` environment variable. Everything is available after a day or two of scheduled runs, and older yearly snapshots are upgraded to the SGP4-ready format along the way.
- Re-entry predictions and TIP messages.

Without them, history mode uses orbits reconstructed from the public SATCAT, and the re-entry panel shows recent re-entries plus the lowest orbits.

The build writes these files to `public/data/`:
- `catalog.json`: objects in orbit now.
- `history.json`: re-entered objects and the snapshot list, loaded only when history mode is opened.
- `history/*.bin`: orbital snapshots, loaded as history mode reaches them.
- `reentry.json`: predicted and recent re-entries.
- `conjunctions.json`: close approaches from CelesTrak SOCRATES (no account needed).
- `launches.json`: upcoming launches from Launch Library 2 (no account needed; the free tier allows about 15 requests an hour, far more than the 6-hourly schedule uses).
- `magnitudes.json`: standard magnitudes from Mike McCants' `qs.mag` (refreshed monthly). If it can't be fetched, the site estimates brightness from radar size.

The star field and constellation figures in `public/sky/` are static and committed. `node scripts/make-stars.mjs` rebuilds them from the HYG database and d3-celestial.

## Local development

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` builds a catalogue first if there isn't one: it tries the live sources and falls back to a synthetic sample.

The other data commands:

```bash
npm run data
```

Fetches live data from CelesTrak, plus Space-Track if credentials are set in the environment.

```bash
npm run data:sample
```

Writes a synthetic offline sample. The app shows a banner whenever this sample is loaded.

To produce a production build in `dist/`:

```bash
npm run build
```

## How it works

| Piece | Where |
| --- | --- |
| Data pipeline: CelesTrak GP groups + SATCAT (+ optional Space-Track), merged into one compact JSON file | `scripts/fetch-data.mjs` |
| SGP4 propagation of the whole catalogue in a Web Worker | `src/sim/propagator.worker.ts` |
| Snapshot → GPU interpolation: each object advances on its instantaneous orbital circle in the vertex shader, so 30k objects animate at 60 fps while the worker refreshes snapshots (faster under time warp) | `src/sim/propagator.ts`, `src/render/satellites.ts` |
| Earth, clouds, atmosphere | `src/render/earth.ts` |
| Stars, Milky Way, constellations, Moon, Sun | `src/render/celestial.ts`, `src/sim/astro.ts` |
| Close-up models (separate scene and depth range in metres, drawn over the globe) | `src/render/models.ts`, `src/render/closeup.ts` |
| Sky view: sky dome, ground, brightness-scaled satellites | `src/render/skyview.ts`, `src/ui/skyview.ts` |
| Brightness, passes, alerts, identification | `src/sim/brightness.ts`, `src/sim/observer.ts`, `src/ui/alerts.ts`, `src/ui/identify.ts` |
| Selected orbit, ground track, footprint, filtered-set orbits | `src/render/orbits.ts` |
| Export (CSV, PNG, video) and the embed widget | `src/ui/export.ts`, `src/ui/embed.ts` |
| Offline caching and install | `public/sw.js`, `public/manifest.webmanifest`, `src/ui/platform.ts` |
| UI: explorer, info panel, insights, time bar, overlays | `src/ui/` |

Stack: [Three.js](https://threejs.org), [satellite.js](https://github.com/shashwatak/satellite-js), TypeScript and Vite. There is no UI framework.

## Credits

- Orbital data: [CelesTrak](https://celestrak.org) (Dr T.S. Kelso) and [Space-Track.org](https://www.space-track.org), derived from the U.S. Space Force catalogue.
- Close approaches: [CelesTrak SOCRATES](https://celestrak.org/SOCRATES/).
- Launch schedule: [The Space Devs](https://thespacedevs.com) — Launch Library 2.
- Earth, night-lights and cloud textures: NASA Visible Earth (Blue Marble / Black Marble), as packaged in [three-globe](https://github.com/vasturiano/three-globe) (MIT).
- Stars: the [HYG database](https://github.com/astronexus/HYG-Database) v4.1 (CC BY-SA 4.0). Constellation figures: [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD 3-Clause). Moon texture: from the [three.js](https://threejs.org) examples (MIT).
- Standard magnitudes: Mike McCants' satellite magnitude list (`qs.mag`).
- Country borders: [Natural Earth](https://www.naturalearthdata.com) (public domain).

Positions are accurate to roughly a kilometre near each element set's epoch and degrade by a few kilometres per day after it. Classified objects are not published, so they don't appear.

## Roadmap

Planned and possible enhancements are listed in [ROADMAP.md](ROADMAP.md).
