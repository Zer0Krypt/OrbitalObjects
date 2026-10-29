# Roadmap

Ideas for Orbital Objects, grouped by theme. Effort is a rough guide: **S** is a few hours, **M** is about a day, **L** is a bigger project.

## Done

| Feature | Notes |
| --- | --- |
| Live globe, search, filters, info panel, insights | Initial release. |
| Time scrubber and space-age replay | History timeline back to October 1957. |
| Your sky | Device, globe-pick or manual location; above-horizon and naked-eye filters; sky plot; pass predictions. |
| **Shareable state links** | The URL holds the selected object, filters, colouring, time or history date, and camera. Your location is included only if you opt in. Old `#25544` links still work. |
| **Wikipedia summaries** | Exact match by COSPAR ID through Wikidata. Otherwise falls back to the debris event, the constellation, or the parent launch's article. |
| **Real history, including re-entered objects** | `history.json` holds every catalogued object that has re-entered. Final orbits come from Space-Track and are refreshed weekly; where none is published, the orbit is reconstructed from SATCAT. Objects are drawn by a separate two-body GPU layer only in history mode, appear at launch and disappear at re-entry. |
| **History timeline events** | 22 milestones on the time slider, colour-coded by kind (firsts, stations, constellations, debris events, re-entries). Clicking one jumps there and highlights the objects involved; close-together markers merge into a picker, and captions appear during playback. |
| **Historical element sets** | Yearly 1 January snapshots from Space-Track `gp_history`. Every object is drawn on the orbit it had that year. Backfilled 12 years per build and cached permanently. |
| **Re-entry watch** | Space-Track decay predictions and TIP messages (countdowns, uncertainty windows, predicted locations), plus re-entries from the last 30 days with a "replay its last day" view. |

## History, further

- **Finer snapshots (M):** quarterly or monthly snapshots for the last decade, when constellations change fastest.
- **True positions along the orbit (L):** propagate each snapshot to the exact date with SGP4 instead of a two-body orbit, so positions are real rather than illustrative.

## Topical and newsworthy

- **Close approaches (M):** CelesTrak's free SOCRATES report of predicted near-misses. Show the two objects, the miss distance and probability, and an animation to the moment of closest approach.
- **Upcoming launches (M):** the Launch Library 2 API (from The Space Devs). Launch-site markers with countdowns, with new objects linked to their launch.

## Your sky, taken further

- **Sky view or AR mode (L):** a first-person view from your location with real stars and satellites crossing the sky. On phones it would use the motion sensors so you can point the phone at the sky.
- **Pass alerts and calendar export (S):** download visible passes as an `.ics` file, or get a browser notification while the tab is open.
- **Brightness predictions (M):** use published brightness ratings for well-known satellites (e.g. Mike McCants' data) to estimate how bright each pass will be. This would make "visible to eye" more accurate.
- **"What did I just see?" (M):** enter a time and direction to get the likely candidates. Starlink "trains" are a common question.

## Storytelling and data views

- **Guided tours (M):** scripted stories that drive the camera, filters and time: the Fengyun-1C debris cloud, building the ISS, the Starlink era, how crowded LEO is.
- **Gabbard diagram (S):** perigee and apogee height against orbital period, the classic chart for debris clouds.
- **Crowding by altitude (M):** object density by altitude shell, showing where collision risk is concentrated.
- **Owner pages (M):** a profile per country or company: fleet over time, spread across orbits, and active vs. dead.
- **Compare two objects (S):** the distance between them over time and when they're closest.

## Richer object detail

- **3D models of famous objects when zoomed in (M):** ISS, Hubble, Tiangong.
- **Moon at its real position, and stars in the correct orientation (S–M).**

## Sharing and platform

- **Export (S):** CSV of the filtered list, a screenshot, and possibly a video recording of a replay.
- **Installable app and smoother loading (M):** make the site installable on phones and desktops, and load faster on slow connections.
- **Embeddable widget (M):** a small globe for a single object or filter, for use on other sites.
