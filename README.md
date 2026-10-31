# Orbital Objects

An explorable, real-time 3D globe of every publicly tracked object orbiting Earth: working satellites, spent rocket bodies and debris. Positions are propagated live in the browser with SGP4/SDP4 from the latest published element sets.

**At a glance:** a live globe of ~30k objects with search and filters · per-object details, passes, brightness and Wikipedia · true-scale 3D models of the ISS, Hubble and Tiangong · the real sky (stars, planets, Moon, Sun) · a replay of the whole space age since 1957 on historical orbits · nine guided tours, owner profiles, debris/crowding charts and the GEO belt · coverage maps and a debris density cloud · a first-person sky view with phone AR guidance, cloud forecasts, pass alerts and "what did I just see?" · My satellites with alerts even when the site is closed · altitude histories, drag and space weather · Sun and Moon transits · spacecraft at L1, L2 and the Moon · re-entry, close-approach, launch, manoeuvre and breakup watch with launch day mode · share links, screenshots, posters, CSV, video, embeds · kiosk mode and sound · installable and offline-capable.

Contents: [Features](#features) · [Privacy](#privacy) · [Embedding](#embedding) · [Data status](#data-status) · [Background notifications](#background-notifications) · [Deploying to GitHub Pages](#deploying-to-github-pages) · [Local development](#local-development) · [How it works](#how-it-works) · [Credits](#credits) · [Roadmap](#roadmap)

## Features

**Globe**
- Day/night Earth shader using NASA Blue Marble and Black Marble imagery. It renders the real-time sun position, city lights on the night side, ocean sun glint, bump-mapped terrain, drifting clouds with cloud shadows, and an atmospheric scattering rim that turns orange at the terminator.
- Every catalogued object is drawn as a glowing point and animated at full frame rate (see *How it works*).
- Colour by object type, orbit regime, owner, operational status, launch year or **data age** (how old each object's element set is, from under a day to over a month). The palettes are checked for colour-blind separation.
- The real sky around it: about 26,000 stars to magnitude 7.5 from the HYG catalogue, placed and coloured by their true positions and colours, a faint Milky Way along the galactic plane, and optional constellation figures. The Moon is at its real position and distance, lit by the Sun with the correct phase, and darkens in Earth's shadow during a lunar eclipse.
- The Sun, Moon, stars and constellation figures can each be switched off under **Layers → Sky**.

**Up close** (the **See it up close** button on the ISS, Hubble and Tiangong, or `…/#s=25544&v=3d`)
- The camera flies in to a true-scale 3D model of the object, flying in its real attitude (station nose-forward, belly to Earth) at its real SGP4 position, with Earth below.
- Solar arrays turn to face the Sun. The model is lit by the real Sun and by blue light from Earth, and goes dark when the object passes into Earth's shadow.
- Drag to look around and scroll or pinch to zoom; zooming out far enough, or `Esc`, flies back to the globe.

**Search and explore**
- Search by name, NORAD ID, COSPAR ID, owner or mission group.
- Faceted filters (type, regime, status, owner, mission/constellation, launch year, altitude), each with live counts. The launch-year and altitude sliders show histograms.
- Quick views: ISS, Tiangong, Hubble, Starlink, GNSS, the GEO belt (also opens the GEO belt chart), debris, space stations and **Deep space**.
- **Beyond Earth orbit** (the *Deep space* quick view): zooms out to the Earth–Moon system and beyond, with spacecraft at the Sun–Earth L1 point (SOHO, ACE, DSCOVR, Wind), at L2 (JWST, Euclid) and in lunar orbit (LRO, Danuri, Chandrayaan-2, CAPSTONE), positioned from NASA JPL Horizons. Halo orbits are drawn over ±60 days in the frame that turns with the Sun–Earth line, so they show as loops around L1 and L2; the Moon's orbit and the L1/L2 points are marked. The panel lists each one's distance, signal time and a Wikipedia link. The markers also appear whenever you zoom far out.
- **My satellites:** star any object (☆ in the info panel, or `S`) to keep it in a list at the top of the explorer, with its next visible pass from your location (and the cloud forecast for it), a bell for alerts on each one or all at once, and a button to show just these on the globe. The list stays in your browser.
- **On this day:** a card with a space anniversary for today's date, from the timeline events, a list of famous dates or the catalogue's launch anniversaries, with a button that jumps there (into history mode, or straight to the object if it is still in orbit). Hide it until tomorrow with ×.
- When a filtered set is small (400 objects or fewer), each object's orbit is drawn as a faint ring.

**Info panel**
- Live altitude, velocity, latitude/longitude, sunlit or eclipse state, and orbit number.
- **Altitude history:** a chart of perigee and apogee over the object's whole life, from the history snapshots (yearly, then quarterly), and daily for famous objects such as the ISS, Hubble and Tiangong from Space-Track's archive: launch, orbit raising, reboosts and decay. Hover for the date and values.
- **Drag and decay** (below about 1,500 km): how fast the orbit is sinking right now, from its element set, a rough time left in orbit at today's rate, and the current solar flux and geomagnetic activity.
- **Element set:** its epoch and age, whether it comes from the public catalogue or the operator's own tracking (**Operator orbit** badge, CelesTrak SupGP, used for Starlink, OneWeb, GPS and other big fleets when it is about as recent as the public set), and a rough position uncertainty now: a few hundred metres at the epoch, growing by about a kilometre a day along the track.
- **Recent changes:** a badge and a short note when the object recently manoeuvred (how much its orbit changed and a rough Δv) or belongs to a launch whose debris count just jumped (a likely breakup). See *Watch*.
- Ground-track minimap with the day/night terminator and the object's visibility footprint.
- Altitude profile over the next orbit, and an orbit diagram drawn to scale.
- Full orbital elements, a reconstructed TLE (with a copy button), and launch and ownership details: owner, launch date and site, time in orbit, radar cross-section and status.
- The five nearest objects right now, mission groups, and links out to CelesTrak, N2YO, Heavens-Above, NASA NSSDCA and Wikipedia.
- **From your location** (once a location is set): live azimuth, elevation, range and brightness, the next passes, and buttons for pass alerts, calendar export and the sky view. See *Your sky*.
- **See it up close** on the ISS, Hubble and Tiangong opens the 3D model. Objects with a predicted re-entry show a countdown and, from a TIP message, the predicted location marked on the globe.
- **Compare:** pick any second object to see:
  - their distance over the coming day or more (SGP4), with the closest approach (time, distance, relative speed) and a jump-to button;
  - a side-by-side table of their orbits, and the angle between their orbit planes;
  - a live distance line between the two on the globe.

**Owner profiles** (from the owner badge in the info panel, or the › next to any owner in the explorer)
- Objects in orbit, active payloads, debris, rocket bodies, re-entered objects and payloads ever launched.
- Fleet in orbit over time since 1957, stacked by type and including re-entered objects.
- Spread across orbit regimes, payload status (active vs. inactive), top constellations and missions, launch sites (counted per launch), and notable objects: the oldest still in orbit, the newest, and the largest.

**Guided tours** (in the explorer, or share one with `…/#tour=starlink`)
- *The Fengyun-1C debris cloud*, *Building the ISS*, *The Starlink era*, *How crowded is low Earth orbit?*, *How GPS works*, *Molniya and Tundra orbits*, *The space race in orbit*, *Hubble's servicing missions* and *Kessler syndrome scenarios*.
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
- Set your location in one of three ways: from the browser (geolocation), by clicking a point on the globe, or by typing latitude/longitude/elevation. Pasting "47.6, -122.3" and N/S/E/W suffixes both work. The location is saved in your browser only; it's never sent anywhere unless you turn on the cloud forecast (see below).
- Sky filter with three modes:
  - **Everything:** no filtering.
  - **Above horizon:** objects above a minimum elevation you set (0–60°).
  - **Visible to eye:** sunlit objects predicted brighter than your sky's limit (magnitude 4.5 in a suburban sky), shown only while your sky is dark (Sun below −6°).
- **Your sky's darkness:** City, Suburbs, Rural or Dark site sets the faintest magnitude counted as visible (3.5 to 6.0) for the filter, passes, alerts and bright passes, and how many stars and how much of the Milky Way the sky view shows.
- **Cloud forecast** (off until you turn it on): hourly cloud cover from Open-Meteo for your location, shown on every pass in the info panel, My satellites and Bright passes. Bright passes under thick cloud (70% or more) are hidden and counted. Turning it on sends your location, rounded to about 10 km, to Open-Meteo.
- The filtered list is sorted by elevation and shows azimuth/elevation for each object. Lines of sight are drawn from your location to the visible objects.
- A live sky plot (dome view) shows what's overhead, including the Sun and the selected object's track across your sky.
- The info panel adds live azimuth, elevation, range and predicted brightness from your location, and the next passes over the coming 48 hours. Each pass shows rise→set direction, duration, maximum elevation and its brightest predicted magnitude. Clicking a pass jumps time to it.
- **Brightness predictions:** each object's standard magnitude (how bright it is at 1000 km, half lit) comes from Mike McCants' published list where available, otherwise an estimate from its radar size. It is scaled for range, phase angle (how much of the lit side faces you) and atmospheric extinction.
- **Calendar and alerts:** download an object's visible passes for the next 7 days as an `.ics` calendar file (with a 10-minute reminder), or switch on alerts to get a browser notification 5 minutes before each visible pass while the tab is open. **Bright passes** in the sky section finds the visible passes of the brightest 180 objects over the next day, and exports them all to your calendar.
- **Alerts when closed** (where the site has a push worker set up; see *Background notifications*): the same alerts arrive even when the site isn't open. Clicking one opens the sky view on that object.
- **Sun & Moon transits:** when the ISS, Tiangong, Hubble or your satellites cross the Sun or Moon as seen from within 100 km of you over the next 14 days (in the sky section, or for one object in its info panel). Each result says whether it crosses the disc from where you are, or how far away and in which direction the **centre line** runs, how wide the strip is from which it crosses the disc at all, and how long the crossing lasts (about a second). Clicking one draws the centre line and its strip on the globe and jumps to a minute before. Observe the Sun only with a proper solar filter.
- **Sky view** (also `…/#v=sky`): stand at your location and look up.
  - The sky is coloured by the Sun's elevation: blue by day, through twilight, to a dark sky with real stars and the Milky Way. A low skyline marks the horizon, with compass points.
  - Satellites are drawn by predicted brightness: bright ones large, faint ones small, and those in Earth's shadow as dim dots, or hidden entirely with **Visible to eye**. The brightest are labelled with their magnitude. The selected object's path across the sky over ±10 minutes is drawn dashed.
  - Labels for bright stars, the planets Mercury to Saturn, the Sun and the Moon (with its phase), plus optional constellation figures and an altitude/azimuth grid. Planets are placed from JPL's approximate orbital elements, with their brightness.
  - **Finding the selected object:** when it's off screen, an arrow at the edge points to it and says how far to turn and tilt. When it's below the horizon, a banner says when it next rises, where, and how high it will get.
  - **Observing aids:** binocular and telescope field-of-view circles (10×50 binoculars, a finder scope, a low-power telescope) centred where you're looking, and a red night-vision mode (also in Layers) that keeps your eyes dark-adapted.
  - Drag to look around and scroll or pinch to zoom. On phones and tablets, **Point phone** uses the motion sensors and compass, so you can hold the phone up to the sky.
- **Aurora:** NOAA's OVATION forecast (fetched live from NOAA, with the build's copy as a fallback) gives your chance of seeing the aurora overhead or low toward the pole, with any Kp storm forecast for the next day. **Aurora forecast** in Layers draws the oval on the globe and the flat map, fading on the day side, and the sky view adds a glow low toward the geomagnetic pole when it's likely.
- **Starlink trains:** recent Starlink batches still flying in a tight line (launched in the last 60 days, below 480 km and bunched within 40° of orbit), with how long the line is and their visible passes over the next 3 days. A pass in the next 18 hours is marked **Train tonight**; **Show the train** isolates it.
- **Radio passes:** passes above 10° in the next 12 hours of amateur radio satellites with live transmitters, day or night, with each one's downlink frequency. Frequencies come from SatNOGS DB.
- **Observation log:** **I saw it** in an object's details logs a sighting at the current time with its predicted position (azimuth/elevation and J2000 right ascension/declination) and brightness. Each entry can be edited with what you measured and a note. Export as CSV, or as IOD lines (the format amateur observers send to SeeSat-L) for entries with measured positions, under your COSPAR station number.
- **Alerts anywhere** (where the push worker is set up): the same pass alerts in an ntfy topic, a Discord or Slack channel (by webhook), or a calendar feed you subscribe to. The feed holds the next week's visible passes of your alerted satellites (or My satellites) and refreshes whenever you open the site.
- **What did I see?** Enter when and roughly where you looked (and, optionally, which way it was moving). Every tracked object is propagated to that moment, and the sunlit, bright-enough candidates are ranked by how close they were to where you looked, how bright they were and their direction of travel. Groups of recently launched Starlink satellites are recognised as a "train", and a bright planet near where you looked is suggested if what you saw wasn't moving. Picking a result sets the clock to that moment and points the sky view at it.

**Watch** (shortcut `R`; the badge counts anything happening in the next 24 hours)
- **Re-entries:**
  - Space-Track decay predictions and final TIP messages, each with a countdown, an uncertainty window and, where available, the predicted location marked on the globe.
  - Re-entries from the last 30 days, each of which can replay its final day in history mode.
  - Without Space-Track access the tab lists the lowest orbits instead.
- **Close approaches:**
  - Predicted near-misses from CelesTrak SOCRATES: miss distance, relative speed, maximum probability and time of closest approach (TCA), sortable by closest, soonest or most likely.
  - Clicking one sets the clock to two minutes before TCA and links the two objects with a line and a live distance readout.
  - **Geometry ›** on that readout opens the encounter in 3D, seen from the first object (radial, in-track and cross-track axes): the other object's path past it, the miss vector, and rough uncertainty ellipsoids that grow with each element set's age. A slider and Play run through the seconds around closest approach.
  - **How the prediction changed:** each data update keeps SOCRATES' prediction for the same encounter. The geometry view charts the predicted miss distance at each update, and the list marks encounters now predicted closer (▼) or farther apart (▲) than at first.
- **Launches:**
  - Upcoming launches from The Space Devs' Launch Library 2, with countdowns, status, rocket, provider, pad, window and mission details.
  - Pads launching in the next 14 days are marked on the globe.
  - Launches from the last 30 days are grouped from the catalogue by international designator, so you can show every object a launch put up.
  - **Launch day mode** (a pill at the top when a launch is less than a day away, or **Launch day mode** on any launch): a live T− countdown, the webcast, an ascent track drawn on the globe with a moving marker, a 10× preview of the ascent, and the new objects from the launch as they appear in the catalogue.
    - The track uses the best information available: once the launch's objects are catalogued, it ends where the first real element set puts them at orbit insertion and then follows that orbit; before that, when Launch Library lists the first stage's drone-ship landing, it heads along the bearing to that ship (which waits under the flight path); otherwise it uses the azimuth for the likely target orbit.
    - Published flight events (Max-Q, MECO, fairing, SECO…) set the timing of the climb and are marked along the track.
- **Manoeuvres:** satellites whose orbit changed between element sets by more than drag and fitting noise explain, over the last 14 days: raised, lowered or plane change, with the size of the change and a rough Δv. Show them all on the globe with one click.
- **What's new:** a daily digest worked out at each data update: newly catalogued objects grouped by launch, re-entries, manoeuvres and possible breakups, each day expandable and every item showable on the globe. It's also an Atom feed (`data/feed.xml`) for feed readers, linking back to each day (`#digest=YYYY-MM-DD`).
- **Eclipses:** every solar and lunar eclipse in the next 10 years, computed in the browser from the main terms of Meeus' lunar theory and a Sun with its largest perturbations. For 8 April 2024 it puts greatest eclipse at 18:17 UTC over 25.4° N, 104.4° W, about 4 minutes of totality in Dallas and a path about 200 km wide, close to NASA's figures. With your location set, each one says how much of the Sun is covered from where you are (or whether you're in the path), or for lunar eclipses whether the Moon is up. Clicking a solar eclipse draws its central line, the limits of totality or annularity and the limits of the partial eclipse on the globe, and the Moon's shadow darkens the Earth as it crosses (it is drawn during any eclipse; **Moon's shadow** in Layers). The card counts the satellites in the umbra and penumbra at that moment and can show them.
- **Deployments:** recent launches that put several satellites up at once. **Replay** draws them day by day from the element sets each had at the time: released together, drifting apart and climbing (or not) to their working orbits, with an altitude chart for every satellite, how far along the orbit they have spread and how many have reached the top. The history comes from Space-Track when configured, otherwise from the element sets collected at each data update since launch.
- **Breakups:** launches whose catalogued debris jumped between data updates, over the last 180 days, with the number of new pieces. Clicking one highlights the debris and its parent; each also appears on the history timeline.

**About (Wikipedia)**
- The info panel shows the object's Wikipedia summary and image, matched exactly by COSPAR ID through Wikidata.
- When an object has no article of its own, the panel shows a related one instead: the debris event, the constellation, or the parent launch.
- These lookups go straight from your browser to Wikipedia and Wikidata.

**Insights**
- **Overview tab:** altitude distribution, launches per year, top owners, and an inclination-vs-altitude scatter plot.
- **Space weather tab:** the solar cycle (monthly sunspot number since 1996 and NOAA's prediction), the daily 10.7 cm solar flux, the geomagnetic Kp index for the past week with NOAA's 3-day forecast (storm levels G1–G5 coloured), and how fast near-circular orbits are sinking right now by altitude. A busier Sun heats and swells the upper atmosphere, so low satellites decay faster; the history timeline marks the February 2022 storm that brought down new Starlink satellites, and the May 2024 Gannon storm.
- **GEO belt tab:** every object near geostationary orbit by longitude against its height above or below the belt. Satellites holding station sit on the line; drifting ones (with a tail showing a day's drift) and those retired to the graveyard orbit a few hundred km higher are coloured apart, with the protected ±200 km region marked.
- **Debris & crowding tab:**
  - A Gabbard diagram (apogee and perigee against orbital period), with one-click presets for the Fengyun-1C, Cosmos 2251, Iridium 33 and Cosmos 1408 debris clouds.
  - Crowding by altitude: objects per billion km³ in 20 km shells through low Earth orbit, stacked by type, with the most crowded shell labelled. Elliptical orbits are spread over the shells they cross, in proportion to the time spent in each.
- **Constellations tab:** Starlink, OneWeb, Kuiper, Qianfan and Guowang split into satellites still raising their orbit, at their working altitude, lowering or deorbiting, and re-entered. Working shells are found from where the fleet clusters; recent manoeuvres and launch dates decide which way the rest are heading. A scatter of altitude against launch date shows each batch climbing to its shell.
- **Disposal tab:** dead payloads and rocket stages in low orbit launched since 2000, by how long drag will take to bring them down: within 5 years (the US FCC rule for satellites launched since late 2024), within 25 years (the long-standing international guideline), or longer. By owner and by launch decade, plus retired geostationary satellites by whether they were moved to the graveyard orbit. Lifetimes come from each object's orbit and drag term with a standard atmosphere, so treat them as good to a factor of two.
- **Launches tab:** orbital launches per year since Sputnik by launch country (from the satellite catalogue, so only launches that reached orbit), and for recent years from Launch Library 2: launches and failures by provider and by rocket, and per year the share flying a reused booster and the booster landing success rate.
- All charts are interactive: clicking a bar applies a filter, and hovering or clicking a point identifies or selects that object. In history mode every chart counts only what was in orbit at that date.
- In history mode, a debris fragment appears only once the snapshots show it being tracked, rather than on its parent object's launch date.

**Share, export and embed** (the **Share** menu)
- Shareable links: the URL holds the selected object, filters, colouring and (optionally) the time or history date and camera angle. Your location is included only if you switch it on. Short links like `…/#25544` still open straight onto the ISS.
- **Screenshot** (also `P`): a PNG of the view at full resolution, including the labels on screen and a caption with the date, what's shown and the data source.
- **CSV:** the filtered list as a spreadsheet: identifiers, type, owner, launch and re-entry dates, orbit (perigee, apogee, inclination, period, eccentricity), size, element-set epoch, and the current latitude, longitude and altitude. When your location is set, it also includes azimuth, elevation and predicted brightness. In history mode it lists what was in orbit at that date.
- **Record video:** records the globe, with its labels and a caption, to a WebM file (MP4 in Safari) at up to 720p, until you press **Stop & save** (5 minutes at most). **Record replay** captures the whole space age, 1957 to today, in about 40 seconds.
- **Poster…:** a high-resolution image for printing: A4 portrait at 300 dpi, a 2400 px square or 4K wide. It renders the globe as framed on screen, with a title, the date, what's shown and a legend with counts. Pick a past date to show what was in orbit then, e.g. on your birthday.
- **Embed:** generates an `<iframe>` snippet (and a two-line script version) for a live, interactive globe of the current selection or filter, or the sky view from your location, at a choice of sizes, with or without a caption and auto-rotation. See *Embedding* below.

**Installable app**
- Install it from the **Install** button (Chrome, Edge, Android), or in Safari on iPhone and iPad with Share → Add to Home Screen. It opens full screen, with shortcuts to the sky view, the ISS and the space-age replay.
- A service worker keeps the app and the last data it downloaded on the device. Repeat visits open from the cache, and offline the site still works, with a banner saying how old the data is. Data files are refreshed whenever they are more than 15 minutes old.
- Faster first load: the catalogue download starts in parallel with the scripts, the globe appears with small textures that are swapped for full resolution a moment later (skipped on slow or data-saver connections), and three.js is cached separately from the app, so a new deploy only re-downloads the app code.

**Flat map** (`M`, or Layers → View): the whole world at once, with every shown object at the point beneath it, day and night with city lights, the selected object's ground track, your location and the aurora oval when that layer is on. Scroll to zoom, drag to pan, double-click to reset; hover to identify and click to select.

**Your own element sets, and other devices** (**Bring your own** in the explorer)
- Paste a two- or three-line element set (a cubesat before it's catalogued, a planned orbit) and it's drawn like any other object, marked **Your element set**. One with a NORAD number already in the catalogue replaces that object's orbit. Checksums are checked; sets are kept in your browser.
- **Use on another device** (where the push worker is set up): **Get a code** gives a 20-character code that carries your satellites, alerts, location, observation log, element sets and settings to another browser for 14 days. The data is encrypted in your browser with a key from the code before it's sent, so the worker only stores something it can't read.

**Layers** (shortcut `L`)
- Earth: clouds, atmosphere, country borders, latitude/longitude grid, glow (bloom).
- Sky: Sun, Moon, stars and Milky Way, planets, constellation figures, red night vision.
- Sky also has **Spacecraft beyond Earth orbit** (markers for the L1/L2 and lunar missions when zoomed out).
- Overlays: the selected object's ground track and visibility footprint, faint orbits for small filtered sets, station labels, filtered-out objects as faint "ghosts", lines of sight from your location, markers for upcoming launch sites, and the **debris density cloud**: tracked debris and spent stages binned by altitude and latitude and drawn as a glowing haze around Earth.
- **Aurora forecast**, **Van Allen radiation belts** (a ray-marched inner and outer belt shaped by an offset, tilted dipole, so the inner belt dips low over the South Atlantic; each object's details say how much of its orbit is spent in each belt), and **Moon's shadow during eclipses**.
- **Classified satellites (hobbyist-tracked, unofficial):** off by default. Adds the orbits of classified satellites that amateur observers have worked out (Mike McCants' list), marked **Unofficial orbit** in their details. They are less precise than catalogue orbits. Switching it reloads the page.
- **Coverage map:** for Starlink, OneWeb, Kuiper, Iridium, Globalstar, GPS, Galileo or all GNSS, a live heatmap on the globe of how many satellites each point can see above the system's minimum elevation, with the share of Earth covered and how many are above you right now (four are needed for a navigation fix).
- Camera & sound: rotate with Earth (keeps the ground fixed under the camera), auto-rotate when idle, and **Sound**: a soft chime, pitched by brightness and panned by direction, as each bright satellite rises above 10° from your location, and Sputnik's beep in the 1957 replay.
- Settings are remembered in your browser.

**General**
- **Glossary:** labels such as apogee, inclination, RAAN, B* or Kp are underlined; hover, focus or tap one for a plain-language definition. The full list is in About.
- **Orbit families:** colour by **Family** (sun-synchronous, polar, other low orbit, medium orbit, geostationary transfer, Molniya, Tundra, geosynchronous, other) and filter by it in the explorer. Each object's details name its family.
- Responsive layout. On phones the panels become bottom sheets.
- Colour-blind-safe palettes, charts with hover details and a **View as table** option, and reduced motion when the system asks for it.
- **Kiosk mode** (`K`, `?kiosk` in the address, or the About panel): full screen with no panels, slowly cycling through scenes (everything in orbit, the space station, Starlink coverage, the GEO belt, the debris haze, the space-age replay) with large captions. It keeps the screen awake where the browser allows, doesn't save any of its setting changes, and `Esc` leaves it.

Keyboard: `/` search · `Esc` deselect, close a panel, or leave the close-up or sky view · `Space` pause · `[` `]` time warp · `N` live · `H` replay the space age · `R` watch (re-entries, close approaches, launches) · `F` follow · `S` add to My satellites · `I` insights · `L` layers · `M` flat map · `P` screenshot · `K` kiosk mode · `?` help. In a guided tour, `←` `→` step back and forward. With the scrub track focused, `←` `→` step through time (hold `Shift` for bigger steps), and `Home` / `End` jump to 1957 / now. In the sky view, the arrow keys look around and `+` / `−` zoom.

## Privacy

The site is static: there is no server, account or tracking.
- Your location, settings, pass alerts and saved data stay in your browser (local storage and the service worker cache). A location is only put in a link if you switch on **Include my location** when sharing.
- The only requests your browser makes elsewhere are to Wikipedia and Wikidata, for the summary of a selected object; to NOAA for the latest aurora forecast (once you set a location or turn on the aurora layer; nothing about you is sent); and, only if you turn on the cloud forecast, to Open-Meteo with your location rounded to about 10 km. Webcast and mission links open the provider's page only when you click them.
- Pass alerts are local browser notifications, shown only while the tab is open. If you turn on **Alerts when closed**, the site sends the push worker your browser's push subscription and the times and texts of your upcoming alerts (which give away roughly where you are). It keeps them only until they are sent, at most 9 days, and deletes them when you turn the alerts off.
- **Alerts anywhere** sends the worker the ntfy topic or webhook address you enter, with the same alert times and texts, or the calendar of your passes for the feed. They expire after 9 days without a resync and are deleted when you turn them off.
- **Use on another device** sends the worker your saved data encrypted in the browser with a key derived from the code; only the first 8 characters of the code (the lookup id) reach the worker. It expires after 14 days.
- The aurora forecast is fetched from NOAA directly (no location is sent). Telescope control talks only to your own computer: Stellarium's Remote Control plugin on `127.0.0.1`, or a mount you connect over Web Serial.

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
- **The sky over a place:** `#v=sky&loc=51.48,0,0&look=180,40` embeds the sky view from that location (latitude, longitude, elevation in m), facing the given azimuth and elevation. Visitors look around by dragging; the location is never saved in their browser.

**With a script instead of an iframe.** The site serves `embed.js`, which defines an `<orbital-objects>` element that builds the iframe, sizes it and wraps the messages:

```html
<script type="module" src="https://<user>.github.io/OrbitalObjects/embed.js"></script>
<orbital-objects norad="25544" height="420"></orbital-objects>
<orbital-objects view="sky" lat="51.48" lon="0" look="180,40"></orbital-objects>
```

Attributes: `norad`, `search`, `view` (`globe` or `sky`), `lat`, `lon`, `look`, `caption="off"`, `rotate="off"`, `height` and `src`. The element fires `orbital-objects:selected` and has `select(norad)` and `search(text)` methods. The same code is in [`packages/embed`](packages/embed) as the `orbital-objects-embed` npm package, with a `createOrbitalObjects(container, options)` function and TypeScript types.

**oEmbed.** When the build knows the site's address (`SITE_URL`, set automatically by the deploy workflow), it adds an `oembed.json` endpoint and a discovery link to the page, so blog platforms that support oEmbed discovery can embed the live globe from a plain link. A static host can't tailor the response to each `?url=`, so it always describes the main globe.

## Data status

`status.html` (linked from the About panel) shows the state of the data pipeline from the last build: when each source was last fetched and whether this run got a fresh copy, fell back to the cached one or failed; how many objects came from CelesTrak and Space-Track, by type; what the site has to show (re-entries, close approaches, launches, magnitudes, manoeuvres, breakups, radio transmitters, the aurora forecast, launch statistics, classified orbits, the digest and deployments); and how far the history snapshot backfill has got, with an estimate of the runs left. It reads `data/status.json`, written at the end of `npm run data`.

## Background notifications

GitHub Pages can't send push messages, so pass alerts while the site is closed come from a small Cloudflare Worker in [`workers/push`](workers/push), with no dependencies (the free plan is plenty). The browser works out each visible pass itself and sends the worker only what to show and when; a cron trigger runs every minute and sends what is due with Web Push. To set it up:

1. `cd workers/push`, then `node keys.mjs` to make a VAPID key pair.
2. `npx wrangler kv namespace create PUSH_KV` and put the id in `wrangler.toml`, along with your site's origin in `ALLOWED_ORIGINS` and a contact address in `VAPID_SUBJECT`.
3. `npx wrangler secret put VAPID_PRIVATE_JWK` and paste the private key from step 1, then `npx wrangler deploy`.
4. In the GitHub repository, add the variables `PUSH_URL` (the worker's URL) and `VAPID_PUBLIC_KEY` (the public key from step 1) under **Settings → Secrets and variables → Actions → Variables**, and redeploy. The **Alerts when closed** switch appears in the sky section.

The same worker also runs **Alerts anywhere** (ntfy, Discord and Slack webhooks and the calendar feed: only the services' own webhook addresses are accepted, so it can't be used to post anywhere else; add self-hosted ntfy servers to `NTFY_HOSTS`, comma-separated) and **Use on another device** (encrypted blobs under `sync:` keys, kept 14 days). These need only `PUSH_URL`, not the VAPID keys.

`node workers/push/test.mjs` checks the encryption against the worked example in RFC 8291, the VAPID signature, the scheduling, channel delivery and URL checks, the calendar feed and sync. On iPhone and iPad, web push works only once the site is added to the Home Screen.

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
- `manoeuvres.json`, `breakups.json`: changes detected against the previous build.
- `spaceweather.json`: solar flux, sunspot numbers and Kp from NOAA SWPC (no account needed).
- `deepspace.json`: positions of spacecraft at L1, L2 and the Moon from JPL Horizons (no account needed).
- `althistory/`: perigee and apogee of every object at every snapshot, in 64 shards loaded one at a time, and with Space-Track, daily histories of a few famous objects from `gp_history` (refreshed monthly).
- `status.json`: the run's report, shown on `status.html`.

The catalogue also takes CelesTrak's operator-supplied **SupGP** orbits for Starlink, OneWeb, Planet, Iridium, GPS, GLONASS, SES, Intelsat, Telesat, ORBCOMM, Kuiper, Meteosat and the ISS (no account needed), where they are about as recent as the public element set.

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
| Data pipeline: CelesTrak GP groups + SATCAT (+ optional Space-Track), merged into one compact JSON file; re-entries, SOCRATES, Launch Library and magnitudes alongside | `scripts/fetch-data.mjs`, `scripts/magnitudes.mjs` |
| Manoeuvre and breakup detection: each build compares the catalogue with the previous one (kept in `.data-cache`) | `scripts/changes.mjs`, `src/data/changes.ts` |
| Pipeline status page | `status.html`, `src/status/` |
| SatNOGS transmitters, OVATION aurora, launch statistics, classified element sets, daily digest and Atom feed, deployment histories | `scripts/more.mjs`, `src/data/more.ts` |
| Eclipses (Meeus lunar theory, shadow geometry, paths, local circumstances) and the shadow on the globe | `src/sim/eclipse.ts`, `src/ui/eclipses.ts`, `src/render/layers.ts` |
| Aurora, radiation belts (offset dipole, L-shells) and the flat map | `src/render/layers.ts`, `src/sim/belts.ts`, `src/ui/flatmap.ts` |
| Starlink trains, radio passes and Doppler, observation log (IOD), telescope and Stellarium links | `src/sim/trains.ts`, `src/ui/skytools.ts`, `src/ui/radio.ts`, `src/ui/obslog.ts`, `src/ui/telescope.ts` |
| Constellation health, disposal (orbital lifetime), launch statistics; deployment replay; digest | `src/ui/analysis.ts`, `src/sim/lifetime.ts`, `src/ui/deploy.ts`, `src/ui/digest.ts` |
| Orbit families, glossary, your element sets, sync, alert channels | `src/sim/families.ts`, `src/ui/glossary.ts`, `src/ui/mine.ts`, `src/ui/channels.ts` |
| SupGP, space weather, Horizons, close-approach history, altitude history, launch details | `scripts/extras.mjs` |
| Push worker for background alerts (Web Push, VAPID, aes128gcm) | `workers/push/`, `src/ui/push.ts`, `public/sw.js` |
| Historical snapshots: planning, `gp_history` queries and the compact binary format | `scripts/snapshots.mjs`, `src/data/snapshots.ts` |
| Offline sample data and the static star field | `scripts/make-sample-data.mjs`, `scripts/make-stars.mjs` |
| SGP4 propagation of the whole catalogue in a Web Worker | `src/sim/propagator.worker.ts` |
| Snapshot → GPU interpolation: each object advances on its instantaneous orbital circle in the vertex shader, so 30k objects animate at 60 fps while the worker refreshes snapshots (faster under time warp) | `src/sim/propagator.ts`, `src/render/satellites.ts` |
| History mode: every object ever catalogued on one GPU layer (two-body motion between snapshots, or SGP4 true positions), launch and re-entry flashes, timeline events | `src/render/historyPoints.ts`, `src/ui/timeline.ts`, `src/data/events.json` |
| Earth, clouds, atmosphere | `src/render/earth.ts` |
| Stars, Milky Way, constellations, planets, Moon, Sun | `src/render/celestial.ts`, `src/sim/astro.ts`, `src/sim/planets.ts` |
| Coverage heatmaps and the ray-marched debris density cloud | `src/render/coverage.ts`, `src/render/debrisCloud.ts`, `src/ui/coverage.ts` |
| GEO belt chart, close-approach geometry, launch day mode | `src/ui/geobelt.ts`, `src/ui/conjunction.ts`, `src/ui/launchday.ts` |
| Altitude history, drag, space weather charts, element accuracy | `src/ui/objectdetail.ts`, `src/ui/spaceweatherCharts.ts`, `src/data/althistory.ts`, `src/sim/accuracy.ts` |
| Sun and Moon transits (centre line on the WGS-84 ellipsoid) | `src/sim/transits.ts`, `src/ui/transits.ts` |
| Beyond Earth orbit and the cislunar view | `src/data/deepspace.ts`, `src/ui/deepspace.ts` |
| Close-up models (separate scene and depth range in metres, drawn over the globe) | `src/render/models.ts`, `src/render/closeup.ts` |
| Sky view: sky dome, ground, brightness-scaled satellites | `src/render/skyview.ts`, `src/ui/skyview.ts` |
| Brightness, sky quality, passes, alerts, identification, cloud forecast | `src/sim/brightness.ts`, `src/sim/observer.ts`, `src/ui/alerts.ts`, `src/ui/identify.ts`, `src/data/weather.ts` |
| My satellites, On this day | `src/ui/watchlist.ts`, `src/ui/onthisday.ts`, `src/data/onthisday.json` |
| Selected orbit, ground track, footprint, filtered-set orbits | `src/render/orbits.ts` |
| Export (CSV, PNG, video, posters) and the embed widget, script and oEmbed | `src/ui/export.ts`, `src/ui/poster.ts`, `src/ui/embed.ts`, `packages/embed/`, `vite.config.ts` |
| Kiosk mode and sound | `src/ui/kiosk.ts`, `src/ui/sound.ts` |
| Offline caching and install | `public/sw.js`, `public/manifest.webmanifest`, `src/ui/platform.ts` |
| Tours, insights (Gabbard, crowding), owner profiles, compare, watch panel | `src/ui/tours.ts`, `src/ui/insights.ts`, `src/ui/profile.ts`, `src/ui/compare.ts`, `src/ui/watch.ts` |
| UI: explorer, info panel, time bar, overlays, share links | `src/ui/` |

Stack: [Three.js](https://threejs.org), [satellite.js](https://github.com/shashwatak/satellite-js), TypeScript and Vite. There is no UI framework.

## Credits

- Orbital data: [CelesTrak](https://celestrak.org) (Dr T.S. Kelso) and [Space-Track.org](https://www.space-track.org), derived from the U.S. Space Force catalogue.
- Close approaches: [CelesTrak SOCRATES](https://celestrak.org/SOCRATES/).
- Launch schedule: [The Space Devs](https://thespacedevs.com) — Launch Library 2.
- Earth, night-lights and cloud textures: NASA Visible Earth (Blue Marble / Black Marble), as packaged in [three-globe](https://github.com/vasturiano/three-globe) (MIT).
- Stars: the [HYG database](https://github.com/astronexus/HYG-Database) v4.1 (CC BY-SA 4.0). Constellation figures: [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD 3-Clause). Moon texture: from the [three.js](https://threejs.org) examples (MIT).
- Standard magnitudes: Mike McCants' satellite magnitude list (`qs.mag`).
- Planet positions: E.M. Standish, *Keplerian Elements for Approximate Positions of the Major Planets* (JPL); planet brightness after Mallama & Hilton (2018).
- Cloud forecast: [Open-Meteo](https://open-meteo.com) (CC BY 4.0), only when turned on.
- Operator-supplied orbits: [CelesTrak SupGP](https://celestrak.org/NORAD/elements/supplemental/).
- Space weather: [NOAA Space Weather Prediction Center](https://www.swpc.noaa.gov).
- Spacecraft beyond Earth orbit: [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/).
- Country borders: [Natural Earth](https://www.naturalearthdata.com) (public domain).
- Radio transmitters: [SatNOGS DB](https://db.satnogs.org) (CC BY-SA 4.0).
- Aurora forecast: NOAA SWPC's [OVATION](https://www.swpc.noaa.gov/products/aurora-30-minute-forecast) model.
- Launch history: the satellite catalogue and [Launch Library 2](https://thespacedevs.com).
- Classified-satellite orbits (optional): Mike McCants' hobbyist-tracked element sets (`classfd.tle`).
- Eclipses: the lunar theory and Sun formulas from Jean Meeus, *Astronomical Algorithms*.

Positions are accurate to roughly a kilometre near each element set's epoch and degrade by a few kilometres per day after it. Classified objects are not published, so they don't appear unless you switch on the unofficial hobbyist-tracked layer.

## Roadmap

Planned and possible enhancements are listed in [ROADMAP.md](ROADMAP.md).
