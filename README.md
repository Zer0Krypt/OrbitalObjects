# Orbital Objects

An explorable, real-time 3D globe of every publicly tracked object orbiting Earth: working satellites, spent rocket bodies and debris. Positions are propagated live in the browser with SGP4/SDP4 from the latest published element sets.

## Features

**Globe**
- Day/night Earth shader using NASA Blue Marble and Black Marble imagery. It renders the real-time sun position, city lights on the night side, ocean sun glint, bump-mapped terrain, drifting clouds with cloud shadows, and an atmospheric scattering rim that turns orange at the terminator.
- Every catalogued object is drawn as a glowing point and animated at full frame rate (see *How it works*).
- Colour by object type, orbit regime, owner, operational status or launch year. The palettes are checked for colour-blind separation.

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

**Time**
- Run live, pause, or warp time from −1 day/s to +1 day/s, and jump back to the present.

**Insights**
- Altitude distribution, launches per year, top owners, and an inclination-vs-altitude scatter plot.
- All charts are interactive: clicking a bar applies a filter, and hovering or clicking a scatter point identifies or selects that object.

**General**
- Deep links: `…/#25544` opens straight onto the ISS.
- Responsive layout. On phones the panels become bottom sheets.

Keyboard: `/` search · `Esc` deselect · `Space` pause · `[` `]` time warp · `N` live · `F` follow · `I` insights · `L` layers · `?` help.

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
| Earth, clouds, atmosphere, stars, sun | `src/render/earth.ts` |
| Selected orbit, ground track, footprint, filtered-set orbits | `src/render/orbits.ts` |
| UI: explorer, info panel, insights, time bar, overlays | `src/ui/` |

Stack: [Three.js](https://threejs.org), [satellite.js](https://github.com/shashwatak/satellite-js), TypeScript and Vite. There is no UI framework.

## Credits

- Orbital data: [CelesTrak](https://celestrak.org) (Dr T.S. Kelso) and [Space-Track.org](https://www.space-track.org), derived from the U.S. Space Force catalogue.
- Earth, night-lights, cloud and star textures: NASA Visible Earth (Blue Marble / Black Marble), as packaged in [three-globe](https://github.com/vasturiano/three-globe) (MIT).
- Country borders: [Natural Earth](https://www.naturalearthdata.com) (public domain).

Positions are accurate to roughly a kilometre near each element set's epoch and degrade by a few kilometres per day after it. Classified objects are not published, so they don't appear.
