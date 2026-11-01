# Changelog

What's new in each version of Orbital Objects. The version shown in the app's About panel matches the newest entry here. Versions follow [semantic versioning](https://semver.org): a new minor version adds features, a new patch version fixes things.

## 1.7.0 — 2026-11-01

**Added**
- An **Alerts & sound** menu (the bell in the top bar, or `A`) with everything that makes a sound or tells you something:
  - **Sound:** on or off, volume, a chime with each alert, Sputnik's beep in the replay, and a test button.
  - **Rising satellites:** be told when satellites climb past an elevation you choose. Pick which ones (bright ones you could see, My satellites, ones with pass alerts, or anything), and whether only when the Sun is at least a chosen angle below your horizon. Hear a chime, see a pop-up, and/or get a system notification while the tab is in the background.
  - **Pass alerts:** choose how early to be warned, only visible passes or all of them, and a minimum height. See which satellites you have alerts on, and add all their passes to your calendar.
  - **Browser notifications:** allow them, and send a test.
  - **When the site is closed:** push notifications to this device, and ntfy, Discord, Slack and calendar alerts, each with its status and a **Send test** button.
- Explanations for every control: hover over (or focus, or long-press) any button, switch, tab or number to see what it does. Switch them off in Layers → **Explanations on hover**.

**Changed**
- Sound, alerts and notifications have moved out of Layers and the Your sky section into the new menu. The rising-satellite chime is now off until you turn it on there, so the site stays quiet unless you ask.
- Pass alerts, the push notifications and the alert channels all follow the new pass settings.

## 1.6.0 — 2026-11-01

**Changed**
- Selecting an object now shows only that object (and anything it's compared with or paired with in a close approach). Everything else fades to ghosts, the "Shown" count drops to match, and a note in the explorer offers **Show all**. Changing a filter, searching or picking a constellation shows the filtered set again. Hand-picked sets such as a breakup's debris, a Starlink train or My satellites stay in view around the selection. Switch it off in Layers → **Show only the selected object**.
- Every section of the left-hand panel can be collapsed or expanded by clicking its heading. The panel remembers which ones you closed.
- The Layers menu now scrolls and fits on screen.
- A version number and this changelog. About shows the version and a **What's new** button, and a note appears once after each update.

**Fixed**
- The Watch panel's tabs (Re-entries, Approaches, Launches…) were squeezed onto one line and hard to read. They now wrap onto two rows as proper buttons. The Insights tabs get the same treatment.

## 1.5.0 — 2026-10-31

**Added**
- *Your sky:* radio passes with live Doppler-corrected frequencies (SatNOGS), Starlink train forecasts, the aurora forecast (NOAA OVATION) on the globe and in the sky view, solar and lunar eclipses with paths and the Moon's shadow on the globe, an observation log with IOD export, and links to Stellarium and GoTo telescope mounts.
- *Watch:* What's new (a daily digest, also an Atom feed), Eclipses and Deployments (a day-by-day replay of recent multi-satellite launches).
- *Insights:* Constellations (health of the megaconstellations), Disposal (who leaves dead objects in orbit) and Launches (launches per year, providers, rockets, booster reuse).
- Optional hobbyist-tracked classified satellites, your own element sets, a flat map view (`M`), orbit families as a colour mode and filter, the Van Allen radiation belts, glossary tooltips, alerts in ntfy, Discord, Slack or a calendar feed, and moving your settings to another device with a code.

## 1.4.0 — 2026-10-30

**Added**
- Operator-supplied orbits (CelesTrak SupGP), element-set age and accuracy, each object's altitude history, space weather and drag, how close-approach predictions changed, real launch trajectories in launch day mode, Sun and Moon transits, and spacecraft beyond Earth orbit (L1, L2 and the Moon).
- Pass alerts while the site is closed, through a small push service.

## 1.3.0 — 2026-10-30

**Added**
- Manoeuvre and breakup detection, and a data status page.
- Planets in the sky view, light-pollution settings, an opt-in cloud forecast, guidance to find objects in the sky view, and observing aids (night vision, binocular and telescope fields of view).
- My satellites, On this day, five more guided tours and launch day mode.
- The GEO belt view, coverage maps, the debris density cloud and close-approach geometry in 3D.
- More embed options, kiosk mode, sound, and poster export.

## 1.2.0 — 2026-10-29

**Added**
- Guided tours, the Gabbard diagram, crowding by altitude, owner profiles and comparing two objects.
- Real stars, the Moon at its real position, 3D models of the ISS, Hubble and Tiangong, brightness predictions, pass alerts and calendar export, "What did I see?" and the sky view.
- Export (screenshots, CSV, video), the installable app with offline use, and the embeddable widget.

## 1.1.0 — 2026-10-29

**Added**
- Real history including objects that have re-entered, historical orbits and timeline events, and true positions in the past.
- Re-entry watch, close approaches and upcoming launches.
- Wikipedia summaries and shareable links.

## 1.0.0 — 2026-10-29

**Added**
- The live 3D globe of every tracked object in Earth orbit, with search, filters, colour modes, the info panel and Insights.
- The time scrubber and space-age replay back to 1957.
- Your location, the sky filter, the sky plot and pass predictions.
