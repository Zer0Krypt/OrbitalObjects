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
| **Finer snapshots** | Quarterly snapshots for the last ten years, plus one at the moment of each timeline event. |
| **True positions** | Snapshots keep original element sets; when not fast-forwarding, history mode propagates them with SGP4 to the exact instant, so positions are real near any snapshot. |
| **Close approaches** | CelesTrak SOCRATES in the Watch panel: miss distance, speed, probability and TCA, with a jump-to-encounter view that links the two objects with a live distance. |
| **Upcoming launches** | Launch Library 2 in the Watch panel, with countdowns, mission details and pad markers on the globe; recent launches are grouped from the catalogue. |
| **Guided tours** | Fengyun-1C, Building the ISS, The Starlink era, How crowded is LEO: scripted steps driving time, filters, camera and charts, with narration computed from the data; shareable via `#tour=…`. |
| **Gabbard diagram** | Insights → Debris & crowding, with presets for the major debris clouds. |
| **Crowding by altitude** | Objects per 10⁹ km³ in 20 km LEO shells, time-weighted across elliptical orbits; history-aware. |
| **Owner pages** | Profile per owner/operator: fleet over time, orbit spread, payload status, groups, launch sites, notable objects. |
| **Compare two objects** | Distance over time with closest approach, side-by-side orbits, plane angle, live distance line. |
| **Sky view and AR mode** | First-person sky from your location: sky colour by Sun elevation, real stars and constellations, satellites sized by predicted brightness, labels and paths; drag/zoom, or point a phone at the sky using its motion sensors. |
| **Pass alerts and calendar export** | `.ics` download of visible passes (per object, or the brightest 180 over the next day), and browser notifications 5 minutes before visible passes while the tab is open. |
| **Brightness predictions** | Standard magnitudes from Mike McCants' `qs.mag` (estimated from radar size otherwise), scaled for range, phase and extinction; used by the naked-eye filter, passes and the sky view. |
| **"What did I just see?"** | Time, direction and motion in; ranked sunlit candidates out, with Starlink trains recognised. |
| **3D models of famous objects** | True-scale ISS, Hubble and Tiangong in their real attitude, arrays tracking the Sun, lit by the Sun and Earth, dark in eclipse. |
| **Real Moon and star field** | HYG stars in their true orientation and colours, Milky Way, constellation figures, the Moon at its real position and phase; Sun, Moon and stars toggle individually. |
| **Re-entry watch** | Space-Track decay predictions and TIP messages (countdowns, uncertainty windows, predicted locations), plus re-entries from the last 30 days with a "replay its last day" view. |

## Sharing and platform

- **Export (S):** CSV of the filtered list, a screenshot, and possibly a video recording of a replay.
- **Installable app and smoother loading (M):** make the site installable on phones and desktops, and load faster on slow connections.
- **Embeddable widget (M):** a small globe for a single object or filter, for use on other sites.
