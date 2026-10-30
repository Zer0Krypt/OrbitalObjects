# orbital-objects-embed

Put a live 3D globe of everything in Earth orbit, or the sky over a place,
on your own page. A thin wrapper around the `?embed` view of
[Orbital Objects](https://github.com/Zer0Krypt/OrbitalObjects).

## Without a build step

```html
<script type="module" src="https://zer0krypt.github.io/OrbitalObjects/embed.js"></script>

<orbital-objects norad="25544" height="420"></orbital-objects>
<orbital-objects view="sky" lat="51.48" lon="0" look="180,40"></orbital-objects>
```

## From npm

```js
import 'orbital-objects-embed'; // registers <orbital-objects>
import { createOrbitalObjects } from 'orbital-objects-embed';

const view = createOrbitalObjects(document.querySelector('#globe'), { search: 'starlink', height: 480 });
view.on(({ norad, name }) => console.log('selected', norad, name));
view.select(25544);
```

## Attributes and options

| Attribute | Option | Meaning |
| --- | --- | --- |
| `norad` | `norad` | Select an object by NORAD number (changing the attribute reselects) |
| `search` | `search` | Filter, e.g. `starlink` |
| `view` | `view` | `globe` (default) or `sky` |
| `lat`, `lon` | `lat`, `lon` | Where the sky view looks from |
| `look` | `look` | Initial sky-view direction, `azimuth,elevation` |
| `caption="off"` | `caption: false` | Hide the caption |
| `rotate="off"` | `rotate: false` | Don't auto-rotate |
| `height` | `height` | Height in pixels (default 420) |
| `src` | `src` | Another deployment of the site |

The element fires `orbital-objects:selected` (detail `{ norad, name }`) when
someone picks an object inside the view, and has `select(norad)` and
`search(text)` methods.
