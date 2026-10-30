import type { App } from '../app';
import { REGIME_LABEL, RE, TYPE_LABEL, type SatObject } from '../data/catalog';
import { OPS_STATUS, ownerName, siteName } from '../data/codes';
import { statusTone } from '../data/model';
import { toTLE } from '../data/tle';
import { eciToGeodetic, gmst, inEclipse, sunDirectionEci } from '../sim/astro';
import { satrecFor, stateAt } from '../render/orbits';
import { observerSection } from './passes';
import { wikiFor } from '../data/wiki';
import { uncertaintyMs } from '../data/reentry';
import { fmtCountdown, fmtUncertainty, watchReentry } from './reentry';
import { compareSection } from './compare';
import { ICON_CUBE } from './closeup';
import { hasModel } from '../render/models';
import { describeManoeuvre } from '../data/changes';
import { showBreakup } from './watch';
import { $, fmt, fmtAge, fmtAgo, fmtDate, fmtDuration, fmtInt, fmtKm, fmtLat, fmtLon, fmtUtc, h, icon, ICONS, s } from './dom';

const base = import.meta.env.BASE_URL;
const ICON_COMPARE = '<path d="M7 4v16M17 4v16"/><path d="M3 8h8M13 16h8"/>';
const DEG = Math.PI / 180;

let mapImg: HTMLImageElement | null = null;
function mapImage() {
  if (!mapImg) {
    mapImg = new Image();
    mapImg.src = base + 'textures/earth-day.jpg';
  }
  return mapImg;
}

function rcsClass(rcs: number | null) {
  if (rcs == null) return '—';
  const cls = rcs < 0.1 ? 'small' : rcs < 1 ? 'medium' : 'large';
  return `${fmt(rcs, rcs < 1 ? 3 : 1)} m² · ${cls}`;
}

const kv = (pairs: [string, string | Node][], one = false) =>
  h('dl', { class: 'kv' + (one ? ' one' : '') }, ...pairs.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', { title: typeof v === 'string' ? v : '' }, v))));

export function mountInfo(app: App) {
  const root = $('#info');
  let liveEls: Record<string, HTMLElement> = {};
  let minimap: HTMLCanvasElement | null = null;
  let track: { lat: number; lon: number; t: number }[] = [];
  let trackBuiltAt = -Infinity;
  let nearestBox: HTMLElement | null = null;
  let skySec: ReturnType<typeof observerSection> | null = null;
  let predCountdown: (() => void) | null = null;
  let cmpSec: ReturnType<typeof compareSection> | null = null;
  let modelBtn: HTMLButtonElement | null = null;
  function syncModelBtn() {
    if (!modelBtn) return;
    const on = app.closeup.active && app.closeup.phase !== 'out';
    modelBtn.replaceChildren(
      icon(ICON_CUBE),
      h('span', null, h('b', null, on ? 'Back to the globe' : 'See it up close'), h('small', null, on ? 'Leave the close-up view (Esc)' : 'True-scale 3D model, lit by the real Sun')),
      h('span', { class: 'arrow' }, on ? '×' : '›'),
    );
  }
  app.on('closeup', syncModelBtn);
  let nearestAt = 0;
  let lastLive = 0;
  let followBtn: HTMLButtonElement | null = null;
  let starBtn: HTMLButtonElement | null = null;
  app.on('watchlist', () => starBtn?.setAttribute('aria-pressed', String(app.isWatched(app.selected))));
  app.on('watch', () => app.selected && build(app.selected));
  let profileBox: HTMLElement | null = null;
  let profileAt = -Infinity;
  let diagramMarker: SVGElement | null = null;

  function build(o: SatObject | null) {
    root.hidden = !o;
    if (!o) {
      root.replaceChildren();
      return;
    }
    const t = app.clock.now();
    const color = app.colorsHex[o.idx];
    const status = OPS_STATUS[o.status];
    const tone = statusTone(o);
    const groups = o.groups.map((g) => app.cat.groups[g]).filter(Boolean);
    const gone = !!o.decay;
    const pred = app.reentryByNorad.get(o.norad) ?? null;

    const close = h('button', { class: 'close', 'aria-label': 'Close details', onclick: () => app.select(null) }, icon(ICONS.close));
    const star = h('button', {
      class: 'star',
      'aria-pressed': String(app.isWatched(o)),
      'aria-label': 'Add to My satellites',
      title: 'Add to My satellites (S)',
      onclick: () => app.toggleWatchlist(o),
    }, icon(ICONS.star));
    starBtn = star;
    const man = app.manoeuvres?.byNorad.get(o.norad) ?? null;
    const breakup = app.breakups?.items.find((b) => o.cospar.startsWith(b.cospar)) ?? null;
    const head = h(
      'div',
      { class: 'info-head', style: `background:linear-gradient(180deg, ${color}26, transparent 85%)` },
      close,
      gone ? null : star,
      h('div', { class: 'eyebrow' }, gone ? `${TYPE_LABEL[o.type]} · Re-entered` : `${TYPE_LABEL[o.type]} · ${REGIME_LABEL[o.regime]}`),
      h('h2', null, o.name),
      h('div', { class: 'ids' }, h('span', null, 'NORAD ', h('b', null, String(o.norad))), h('span', null, 'COSPAR ', h('b', null, o.cospar || '—')), h('span', null, 'Owner ', h('b', null, o.owner))),
      h(
        'div',
        { class: 'badges' },
        h('span', { class: 'badge' }, h('i', { style: `background:${color};box-shadow:0 0 6px ${color}` }), TYPE_LABEL[o.type]),
        gone ? h('span', { class: 'badge bad' }, statusIcon('bad'), `Re-entered ${fmtDate(o.decay!)}`) : null,
        !gone && o.type === 'P' && status ? h('span', { class: `badge ${tone === 'muted' ? '' : tone}` }, statusIcon(tone), status.label) : null,
        pred ? h('span', { class: 'badge warn' }, statusIcon('warn'), 'Re-entry predicted') : null,
        man && !gone ? h('span', { class: 'badge man', title: describeManoeuvre(man) }, `Manoeuvred ${fmtAgo(Date.now() - man.tMs)}`) : null,
        breakup && !gone ? h('span', { class: 'badge bad', title: `${breakup.added} new pieces detected` }, o.type === 'D' ? 'Recent breakup debris' : 'Broke up recently') : null,
        h('button', { class: 'badge link', title: `${ownerName(o.owner)}: owner profile`, onclick: () => app.setProfile(o.owner) }, ownerName(o.owner), ' ›'),
        ...groups.slice(0, 3).map((g) => h('span', { class: 'badge' }, g.label)),
      ),
    );

    followBtn = h('button', { class: 'btn', 'aria-pressed': String(app.following), onclick: () => app.setFollowing(!app.following) }, icon(ICONS.follow), 'Follow');
    const actions = h(
      'div',
      { class: 'info-actions' },
      h('button', { class: 'btn primary', onclick: () => app.flyTo(o) }, icon(ICONS.target), 'Focus'),
      followBtn,
      h('button', { class: 'btn', 'data-share': '', onclick: () => document.getElementById('btn-share')?.click() }, icon(ICONS.share), 'Share'),
      h(
        'button',
        {
          class: 'btn',
          'aria-pressed': String(app.comparePicking || !!app.compare),
          title: 'Compare with another object',
          onclick: () => (app.comparePicking ? app.setComparePicking(false) : app.setComparePicking(true)),
        },
        icon(ICON_COMPARE),
        app.comparePicking ? 'Pick…' : 'Compare',
      ),
    );
    cmpSec = app.compare && !gone ? compareSection(app, o, app.compare) : null;

    // Live telemetry
    const cell = (k: string, label: string) => {
      const v = h('div', { class: 'v' }, '—');
      liveEls[k] = v;
      return h('div', null, h('div', { class: 'l' }, label), v);
    };
    liveEls = {};
    const live = h('div', { class: 'live' }, cell('alt', 'Altitude'), cell('vel', 'Velocity'), cell('lit', 'Illumination'), cell('lat', 'Latitude'), cell('lon', 'Longitude'), cell('rev', 'Orbit no.'));

    // Ground track minimap
    minimap = h('canvas', { width: 744, height: 372, 'aria-label': 'Ground track map' });
    trackBuiltAt = -Infinity;
    const mapSec = h('div', { class: 'isec' }, h('h3', null, 'Ground track', h('span', null, '±1 orbit')), h('div', { class: 'minimap' }, minimap));

    // Altitude profile
    profileBox = h('div');
    profileAt = -Infinity;
    const profSec = h('div', { class: 'isec' }, h('h3', null, 'Altitude profile', h('span', null, `next ${fmtDuration(o.period)}`)), profileBox);

    // Orbit
    const diagram = orbitDiagram(o, color);
    diagramMarker = diagram.marker;
    const orbitSec = h(
      'div',
      { class: 'isec' },
      h('h3', null, 'Orbit', h('span', null, o.regime)),
      h(
        'div',
        { class: 'orbit-diagram' },
        diagram.svg,
        kv(
          [
            ['Apogee', `${fmtKm(o.apogee)} km`],
            ['Perigee', `${fmtKm(o.perigee)} km`],
            ['Period', fmtDuration(o.period)],
            ['Inclination', `${fmt(o.incl, 2)}°`],
            ['Eccentricity', fmt(o.ecc, 5)],
          ],
          true,
        ),
      ),
      kv([
        ['Semi-major axis', `${fmtKm(o.sma)} km`],
        ['Mean motion', `${fmt(o.meanMotion, 4)} rev/d`],
        ['RAAN', `${fmt(o.raan, 2)}°`],
        ['Arg. of perigee', `${fmt(o.argp, 2)}°`],
        ['Mean anomaly', `${fmt(o.ma, 2)}°`],
        ['Orbit class', o.incl > 95 && o.incl < 105 && o.regime === 'LEO' ? 'Sun-synchronous' : o.incl > 90 ? 'Retrograde' : o.incl > 80 ? 'Polar' : o.incl < 5 ? 'Equatorial' : 'Prograde'],
      ]),
    );

    // Identity & launch
    const launchSec = h(
      'div',
      { class: 'isec' },
      h('h3', null, 'Launch & ownership'),
      kv(
        [
          ['Owner / operator', `${ownerName(o.owner)} (${o.owner})`],
          ['Launch date', o.launch ? fmtDate(o.launch) : '—'],
          ['Launch site', o.site ? `${siteName(o.site)}` : '—'],
          ...(gone
            ? ([
                ['Re-entered', fmtDate(o.decay!)],
                ['Time in orbit', o.launch ? fmtAge(o.launch, Date.parse(o.decay! + 'T12:00:00Z')) : '—'],
              ] as [string, string][])
            : ([['Time in orbit', o.launch ? fmtAge(o.launch, t) : '—']] as [string, string][])),
          ['Object type', TYPE_LABEL[o.type]],
          ['Operational status', status ? status.label : o.type === 'P' ? 'Unknown' : 'Inert'],
          ['Radar cross-section', rcsClass(o.rcs)],
        ],
        true,
      ),
    );

    // Element set
    const elemGone = gone
      ? h(
          'div',
          { class: 'isec' },
          h('h3', null, o.approx ? 'Orbit (reconstructed)' : 'Final element set'),
          o.approx
            ? h('p', { class: 'sky-hint', style: 'margin:0' }, "No element set is published for this object, so its orbit's size, shape and tilt come from the catalogue's last recorded apogee, perigee and inclination. Its orientation and position along the orbit are illustrative.")
            : kv([
                ['Epoch (UTC)', o.epoch.replace('T', ' ').slice(0, 19)],
                ['Shown with', 'Two-body orbit (no drag)'],
              ]),
        )
      : null;
    const [l1, l2] = toTLE(o);
    const tle = h('pre', { class: 'tle' }, `${o.name}\n${l1}\n${l2}`);
    const elemSec = h(
      'div',
      { class: 'isec' },
      h('h3', null, 'Element set', h('span', null, `#${o.elset}`)),
      kv([
        ['Epoch (UTC)', o.epoch.replace('T', ' ').slice(0, 19)],
        ['Age', fmtAgo(t - o.epochMs)],
        ['B* drag', o.bstar.toExponential(3)],
        ['ṅ / 2', o.ndot.toExponential(3)],
        ['Rev at epoch', fmtInt(o.revs)],
        ['Propagator', 'SGP4 / SDP4'],
      ]),
      h('div', { style: 'height:10px' }),
      tle,
      h(
        'div',
        { style: 'margin-top:8px' },
        h('button', { class: 'btn', onclick: () => navigator.clipboard?.writeText(tle.textContent || '').catch(() => {}) }, 'Copy TLE'),
      ),
    );

    skySec?.dispose();
    skySec = observerSection(app, o);
    nearestBox = h('div', { class: 'facet' });
    nearestAt = 0;
    const nearSec = h('div', { class: 'isec' }, h('h3', null, 'Nearest objects', h('span', null, 'right now')), nearestBox);

    const groupSec = groups.length
      ? h(
          'div',
          { class: 'isec' },
          h('h3', null, 'Groups'),
          h(
            'div',
            { class: 'chips' },
            ...o.groups.map((gi) =>
              h('button', { class: 'chip', onclick: () => app.setFilters({ groups: new Set([gi]) }) }, app.cat.groups[gi]?.label ?? '?'),
            ),
          ),
        )
      : null;

    const q = encodeURIComponent(o.name);
    const linkSec = h(
      'div',
      { class: 'isec' },
      h('h3', null, 'External references'),
      h(
        'div',
        { class: 'links' },
        h('a', { href: `https://celestrak.org/satcat/table-satcat.php?CATNR=${o.norad}`, target: '_blank', rel: 'noopener' }, 'CelesTrak SATCAT ↗'),
        h('a', { href: `https://www.n2yo.com/satellite/?s=${o.norad}`, target: '_blank', rel: 'noopener' }, 'N2YO ↗'),
        h('a', { href: `https://www.heavens-above.com/satinfo.aspx?satid=${o.norad}`, target: '_blank', rel: 'noopener' }, 'Heavens-Above ↗'),
        o.cospar ? h('a', { href: `https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=${o.cospar.replace(/^(\d{4})-(\d{3})(\w+)$/, '$1-$2$3')}`, target: '_blank', rel: 'noopener' }, 'NASA NSSDCA ↗') : null,
        h('a', { href: `https://en.wikipedia.org/w/index.php?search=${q}`, target: '_blank', rel: 'noopener' }, 'Wikipedia ↗'),
      ),
    );

    // Wikipedia
    const about = h('div', { class: 'isec about', hidden: true });
    wikiFor(o, app.cat).then((w) => {
      if (!w || app.selected !== o) return;
      about.hidden = false;
      about.replaceChildren(
        h('h3', null, 'About', h('span', null, 'Wikipedia')),
        w.note ? h('div', { class: 'about-note' }, w.note, ': ', h('b', null, w.title)) : '',
        h(
          'div',
          { class: 'about-body' },
          w.thumb ? h('img', { src: w.thumb.src, alt: '', loading: 'lazy', class: 'about-img', referrerpolicy: 'no-referrer' }) : null,
          h('p', { class: 'about-text' }, w.extract),
        ),
        h(
          'div',
          { class: 'about-foot' },
          h('a', { href: w.url, target: '_blank', rel: 'noopener' }, 'Read on Wikipedia ↗'),
          h('span', null, 'Text CC BY-SA 4.0'),
        ),
      );
    });

    // Predicted re-entry
    let predSec: HTMLElement | null = null;
    if (pred) {
      const cd = h('b', { class: 'mono' });
      const syncCd = () => (cd.textContent = fmtCountdown(pred.decayMs - Date.now()));
      syncCd();
      predCountdown = syncCd;
      predSec = h(
        'div',
        { class: 'isec pred' },
        h('h3', null, 'Predicted re-entry', h('span', null, pred.source === 'tip' ? 'TIP message' : 'decay prediction')),
        h('div', { class: 'pred-main' }, cd, h('span', null, `${fmtUtc(pred.decayMs, false)} UTC ${fmtUncertainty(uncertaintyMs(pred, Date.now()))}`)),
        pred.tip?.lat != null && pred.tip?.lon != null
          ? h('p', { class: 'sky-hint', style: 'margin:6px 0 0' }, `Predicted location ${fmtLat(pred.tip.lat)}, ${fmtLon(pred.tip.lon)} (marked on the globe). With a ${fmtUncertainty(uncertaintyMs(pred, Date.now()))} window it could come down anywhere along its track during that time.`)
          : null,
        h('button', { class: 'btn', style: 'margin-top:10px', onclick: () => app.openWatch('reentry') }, 'Open re-entry watch'),
      );
    } else predCountdown = null;

    // Detected changes: a manoeuvre, or a breakup this object belongs to.
    const changeSec =
      !gone && (man || breakup)
        ? h(
            'div',
            { class: 'isec' },
            h('h3', null, 'Recent changes', h('span', null, 'between data updates')),
            man
              ? h(
                  'p',
                  { class: 'sky-hint', style: 'margin:0 0 6px' },
                  h('b', null, describeManoeuvre(man)),
                  ` — detected in the element set of ${fmtUtc(man.tMs, false)} UTC, ${man.kind === 'plane' ? `inclination ${man.diDeg > 0 ? '+' : ''}${man.diDeg.toFixed(3)}°` : `orbit ${man.daKm > 0 ? 'higher' : 'lower'} by ${Math.abs(man.daKm).toFixed(1)} km than drag explains`}.`,
                )
              : null,
            breakup
              ? h(
                  'p',
                  { class: 'sky-hint', style: 'margin:0' },
                  `Launch ${breakup.cospar} ${o.type === 'D' ? '' : '('}${breakup.parent?.name ?? ''}${o.type === 'D' ? '' : ')'} gained ${fmtInt(breakup.added)} catalogued debris pieces since ${fmtDate(breakup.first.slice(0, 10))}: a likely breakup. `,
                  h('button', { class: 'link', onclick: () => showBreakup(app, breakup, app.cat.objects.slice(0, app.liveCount).filter((x) => x.type === 'D' && x.cospar.startsWith(breakup.cospar)), breakup.parent ? app.cat.byNorad.get(breakup.parent.norad) : undefined) }, 'Show the debris'),
                )
              : null,
          )
        : null;

    const goneSec = gone
      ? h(
          'div',
          { class: 'isec pred gone' },
          h('h3', null, 'No longer in orbit'),
          h('p', { class: 'sky-hint', style: 'margin:0 0 10px' }, `Launched ${o.launch ? fmtDate(o.launch) : '—'} and re-entered ${fmtDate(o.decay!)} after ${o.launch ? fmtAge(o.launch, Date.parse(o.decay! + 'T12:00:00Z')) : 'an unknown time'} in orbit.`),
          h('button', { class: 'btn', onclick: () => watchReentry(app, o.norad, o.decay!) }, 'Replay its last day'),
        )
      : null;

    // Famous objects have a true-scale 3D model.
    modelBtn = hasModel(o.norad) && !gone
      ? h('button', { class: 'model-cta', onclick: () => (app.closeup.active ? app.exitCloseup() : app.enterCloseup(o)), title: 'A true-scale 3D model' })
      : null;
    syncModelBtn();
    const modelSec = modelBtn;

    const body = gone
      ? [goneSec, about, orbitSec, launchSec, elemGone, linkSec]
      : [modelSec, cmpSec?.el, predSec, changeSec, live, about, skySec.el, mapSec, profSec, orbitSec, launchSec, nearSec, groupSec, elemSec, linkSec];
    root.replaceChildren(head, actions, h('div', { class: 'scroll', style: 'flex:1' }, ...body));
    if (gone) followBtn.disabled = !app.history;
    updateLive(true);
  }

  function statusIcon(tone: string) {
    const paths: Record<string, string> = {
      good: '<path d="M2 6.5 5 9.5 10 3" stroke="currentColor" stroke-width="2" fill="none"/>',
      warn: '<path d="M6 1 11 10H1z"/>',
      bad: '<path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="2"/>',
      muted: '<circle cx="6" cy="6" r="4"/>',
    };
    const el = s('svg', { viewBox: '0 0 12 12' });
    el.innerHTML = paths[tone] ?? paths.muted;
    return el;
  }

  function updateLive(force = false) {
    const o = app.selected;
    if (!o) return;
    const now = performance.now();
    if (!force && now - lastLive < 200) return;
    lastLive = now;
    predCountdown?.();
    // Re-entered objects have no live state.
    if (o.decay) return;
    const t = app.clock.now();
    const rec = satrecFor(o);
    const st = rec ? stateAt(rec, t) : null;
    if (!st) {
      for (const el of Object.values(liveEls)) el.textContent = '—';
      return;
    }
    const p = st.position;
    const v = st.velocity;
    const g = gmst(t);
    const geo = eciToGeodetic(p.x, p.y, p.z, g);
    const speed = Math.hypot(v.x, v.y, v.z);
    const eclipse = inEclipse(p.x, p.y, p.z, sunDirectionEci(t));
    const set = (k: string, val: string, unit?: string) => {
      const el = liveEls[k];
      if (!el) return;
      el.replaceChildren(val, unit ? h('small', null, unit) : '');
    };
    set('alt', fmtKm(geo.alt), 'km');
    set('vel', fmt(speed, 3), 'km/s');
    set('lat', fmtLat(geo.lat));
    set('lon', fmtLon(geo.lon));
    liveEls.lit?.replaceChildren(icon(eclipse ? ICONS.moon : ICONS.sun, 'lit-ico'), eclipse ? ' Eclipse' : ' Sunlit');
    liveEls.lit?.querySelector('svg')?.setAttribute('style', `display:inline-block;width:14px;height:14px;vertical-align:-2px;fill:none;stroke:${eclipse ? '#9aa3b5' : '#fab219'};stroke-width:1.8`);
    const revs = o.revs + Math.floor(((t - o.epochMs) / 60000) / o.period);
    set('rev', fmtInt(Math.max(0, revs)));

    // Minimap
    if (minimap) drawMinimap(o, t, geo, g);

    // Altitude marker / orbit diagram marker
    const nu = trueAnomaly(o, t);
    if (diagramMarker) {
      const { x, y } = diagramPoint(o, nu);
      diagramMarker.setAttribute('cx', String(x));
      diagramMarker.setAttribute('cy', String(y));
    }
    if (profileBox && Math.abs(t - profileAt) > (o.period * 60000) / 60) {
      profileAt = t;
      profileBox.replaceChildren(altitudeProfile(o, t));
    }

    if (now - nearestAt > 2000) {
      nearestAt = now;
      renderNearest(o, t);
    }
    if (followBtn) followBtn.setAttribute('aria-pressed', String(app.following));
    skySec?.update(t);
    cmpSec?.update(t);
  }

  function drawMinimap(o: SatObject, t: number, geo: { lat: number; lon: number; alt: number }, g: number) {
    const c = minimap!;
    const W = c.width;
    const H = c.height;
    const x = (lon: number) => ((lon + 180) / 360) * W;
    const y = (lat: number) => ((90 - lat) / 180) * H;
    const ctx = c.getContext('2d')!;
    const img = mapImage();
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, W, H);
    if (img.complete && img.naturalWidth) {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(img, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(3,6,14,0.35)';
    ctx.fillRect(0, 0, W, H);

    // Night side shading
    const sun = sunDirectionEci(t);
    const sunLon = Math.atan2(sun[1], sun[0]) - g;
    const dec = Math.asin(sun[2]);
    ctx.fillStyle = 'rgba(0,2,10,0.55)';
    ctx.beginPath();
    for (let i = 0; i <= 180; i++) {
      const lon = -180 + i * 2;
      const lat = Math.atan(-Math.cos(lon * DEG - sunLon) / Math.tan(dec || 1e-6)) / DEG;
      if (i === 0) ctx.moveTo(x(lon), y(lat));
      else ctx.lineTo(x(lon), y(lat));
    }
    const pole = dec > 0 ? -90 : 90;
    ctx.lineTo(x(180), y(pole));
    ctx.lineTo(x(-180), y(pole));
    ctx.closePath();
    ctx.fill();

    // Graticule
    ctx.strokeStyle = 'rgba(160,190,255,0.08)';
    ctx.lineWidth = 1;
    for (let lon = -150; lon < 180; lon += 30) {
      ctx.beginPath();
      ctx.moveTo(x(lon), 0);
      ctx.lineTo(x(lon), H);
      ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y(lat));
      ctx.lineTo(W, y(lat));
      ctx.stroke();
    }

    // Ground track
    const span = Math.min(o.period * 60000, 12 * 3600e3);
    if (Math.abs(t - trackBuiltAt) > span / 60) {
      trackBuiltAt = t;
      track = [];
      const rec = satrecFor(o);
      if (rec)
        for (let i = 0; i <= 360; i++) {
          const ts = t + ((i / 360) * 2 - 1) * span;
          const st = stateAt(rec, ts);
          if (!st) continue;
          const gg = eciToGeodetic(st.position.x, st.position.y, st.position.z, gmst(ts));
          track.push({ lat: gg.lat, lon: gg.lon, t: ts });
        }
    }
    const color = app.colorsHex[o.idx];
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1];
      const b = track[i];
      if (Math.abs(a.lon - b.lon) > 180) continue;
      const future = b.t > t;
      ctx.strokeStyle = future ? color : 'rgba(200,210,230,0.35)';
      ctx.globalAlpha = future ? 1 - ((b.t - t) / span) * 0.6 : 0.3 + (1 - (t - b.t) / span) * 0.5;
      ctx.beginPath();
      ctx.moveTo(x(a.lon), y(a.lat));
      ctx.lineTo(x(b.lon), y(b.lat));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Footprint
    const lam = Math.acos(Math.min(1, RE / (RE + Math.max(0, geo.alt))));
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let prevX: number | null = null;
    const la1 = geo.lat * DEG;
    const lo1 = geo.lon * DEG;
    for (let i = 0; i <= 96; i++) {
      const az = (i / 96) * Math.PI * 2;
      const la = Math.asin(Math.sin(la1) * Math.cos(lam) + Math.cos(la1) * Math.sin(lam) * Math.cos(az));
      const lo = lo1 + Math.atan2(Math.sin(az) * Math.sin(lam) * Math.cos(la1), Math.cos(lam) - Math.sin(la1) * Math.sin(la));
      let lon = lo / DEG;
      lon = ((((lon + 180) % 360) + 360) % 360) - 180;
      const px = x(lon);
      const py = y(la / DEG);
      if (prevX === null || Math.abs(px - prevX) > W / 2) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      prevX = px;
    }
    ctx.stroke();

    // Current position
    const cx = x(geo.lon);
    const cy = y(geo.lat);
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.3, color + 'aa');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderNearest(o: SatObject, t: number) {
    if (!nearestBox) return;
    const self = app.prop.position(o.idx, t, { x: 0, y: 0, z: 0 });
    const best: { i: number; d: number }[] = [];
    const tmp = { x: 0, y: 0, z: 0 };
    const valid = app.prop.valid;
    for (let i = 0; i < app.prop.count; i++) {
      if (i === o.idx || !valid[i] || !app.launched(i)) continue;
      app.prop.position(i, t, tmp);
      const d = (tmp.x - self.x) ** 2 + (tmp.y - self.y) ** 2 + (tmp.z - self.z) ** 2;
      if (best.length < 5 || d < best[best.length - 1].d) {
        best.push({ i, d });
        best.sort((a, b) => a.d - b.d);
        if (best.length > 5) best.pop();
      }
    }
    const maxD = Math.sqrt(best[best.length - 1]?.d ?? 1);
    nearestBox.replaceChildren(
      ...best.map(({ i, d }) => {
        const n = app.cat.objects[i];
        const km = Math.sqrt(d) * 6371;
        return h(
          'button',
          { class: 'frow', 'aria-pressed': 'true', onclick: () => app.select(n, { fly: true }), title: n.name },
          h('i', { class: 'sw', style: `background:${app.colorsHex[i]};border-radius:50%` }),
          h('span', { class: 'lbl' }, n.name, h('small', null, String(n.norad))),
          h('span', { class: 'n' }, `${fmtKm(km)} km`),
          h('span', { class: 'bar' }, h('i', { style: `width:${(Math.sqrt(d) / maxD) * 100}%;background:${app.colorsHex[i]}` })),
        );
      }),
    );
  }

  app.on('selection', () => {
    if (app.selected?.norad !== root.dataset.norad) {
      root.dataset.norad = String(app.selected?.norad ?? '');
      build(app.selected);
    }
    if (followBtn) followBtn.setAttribute('aria-pressed', String(app.following));
  });
  app.on('colors', () => build(app.selected));
  app.on('observer', () => build(app.selected));
  app.on('weather', () => build(app.selected));
  app.on('reentry', () => build(app.selected));
  app.on('compare', () => {
    build(app.selected);
    pickHint.hidden = !app.comparePicking;
    if (app.comparePicking && app.selected) pickHint.firstChild!.textContent = `Pick an object to compare with ${app.selected.name} — on the globe, in the list or in a chart`;
  });
  // Closing the encounter line ends the comparison too.
  app.on('pair', () => {
    if (app.compare && app.pair?.label !== 'Compare') app.clearCompare();
  });
  const pickHint = h('div', { class: 'pick-hint compare-hint', hidden: true }, h('span'), h('kbd', null, 'Esc'), 'to cancel');
  document.getElementById('app')!.append(pickHint);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.comparePicking) {
      e.stopImmediatePropagation();
      app.setComparePicking(false);
    }
  }, true);
  app.on('frame', () => updateLive());
}

// ---------- helpers ----------
function solveKepler(M: number, e: number) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-10) break;
  }
  return E;
}

function trueAnomaly(o: SatObject, t: number) {
  const M = (o.ma * DEG + ((t - o.epochMs) / 86400000) * o.meanMotion * 2 * Math.PI) % (2 * Math.PI);
  const E = solveKepler(M, o.ecc);
  return 2 * Math.atan2(Math.sqrt(1 + o.ecc) * Math.sin(E / 2), Math.sqrt(1 - o.ecc) * Math.cos(E / 2));
}

function diagramGeom(o: SatObject) {
  const size = 132;
  // Drawn to scale: the whole ellipse (or Earth, if larger) fits the box.
  const scale = (size / 2 - 10) / Math.max(o.sma * (1 + o.ecc), RE * 1.3);
  const a = o.sma * scale;
  const b = a * Math.sqrt(1 - o.ecc * o.ecc);
  const c = a * o.ecc;
  const cx = size / 2;
  const cy = size / 2;
  // Earth at the right focus, so perigee points right and apogee left.
  return { size, scale, a, b, c, cx, cy, fx: cx + c };
}

function diagramPoint(o: SatObject, nu: number) {
  const g = diagramGeom(o);
  const r = (o.sma * (1 - o.ecc * o.ecc)) / (1 + o.ecc * Math.cos(nu));
  return { x: g.fx + r * g.scale * Math.cos(nu), y: g.cy - r * g.scale * Math.sin(nu) };
}

function orbitDiagram(o: SatObject, color: string) {
  const g = diagramGeom(o);
  const svg = s('svg', { viewBox: `0 0 ${g.size} ${g.size}`, role: 'img', 'aria-label': 'Orbit shape to scale' });
  const re = Math.max(RE * g.scale, 3);
  const defs = s('defs');
  defs.innerHTML = `<radialGradient id="eg" cx="35%" cy="35%"><stop offset="0" stop-color="#5598e7"/><stop offset="1" stop-color="#0d2c5c"/></radialGradient>`;
  svg.append(defs);
  svg.append(s('circle', { cx: g.fx, cy: g.cy, r: re + 1.5, fill: 'rgba(85,152,231,0.18)' }));
  svg.append(s('circle', { cx: g.fx, cy: g.cy, r: re, fill: 'url(#eg)' }));
  svg.append(s('ellipse', { cx: g.cx, cy: g.cy, rx: g.a, ry: g.b, fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-opacity': 0.9 }));
  // Apsides
  const peri = diagramPoint(o, 0);
  const apo = diagramPoint(o, Math.PI);
  svg.append(s('line', { x1: apo.x, y1: apo.y, x2: peri.x, y2: peri.y, stroke: 'rgba(160,190,255,0.2)', 'stroke-dasharray': '2 3' }));
  if (o.ecc > 0.01) {
    svg.append(s('circle', { cx: peri.x, cy: peri.y, r: 2.5, fill: '#cde2fb' }));
    svg.append(s('text', { x: peri.x + 4, y: peri.y - 5, fill: '#7c8598', 'font-size': 8, 'font-family': 'var(--mono)' }, 'P'));
    svg.append(s('circle', { cx: apo.x, cy: apo.y, r: 2.5, fill: '#cde2fb' }));
    svg.append(s('text', { x: apo.x - 9, y: apo.y - 5, fill: '#7c8598', 'font-size': 8, 'font-family': 'var(--mono)' }, 'A'));
  }
  const marker = s('circle', { cx: peri.x, cy: peri.y, r: 4, fill: '#fff', stroke: color, 'stroke-width': 2 });
  svg.append(marker);
  return { svg, marker };
}

function altitudeProfile(o: SatObject, t: number) {
  const rec = satrecFor(o);
  const W = 372;
  const H = 92;
  const pad = { l: 34, r: 6, t: 8, b: 16 };
  const svg = s('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Altitude over the next orbit' });
  const pts: { m: number; alt: number }[] = [];
  const periodMs = o.period * 60000;
  if (rec)
    for (let i = 0; i <= 120; i++) {
      const ts = t + (i / 120) * periodMs;
      const st = stateAt(rec, ts);
      if (!st) continue;
      const geo = eciToGeodetic(st.position.x, st.position.y, st.position.z, gmst(ts));
      pts.push({ m: (i / 120) * o.period, alt: geo.alt });
    }
  const marker = s('circle', { r: 3.5, fill: '#fff' });
  if (pts.length < 2) return svg;
  let lo = Math.min(...pts.map((p) => p.alt));
  let hi = Math.max(...pts.map((p) => p.alt));
  if (hi - lo < 2) {
    lo -= 1;
    hi += 1;
  }
  const X = (m: number) => pad.l + (m / o.period) * (W - pad.l - pad.r);
  const Y = (a: number) => pad.t + (1 - (a - lo) / (hi - lo)) * (H - pad.t - pad.b);
  for (const v of [lo, (lo + hi) / 2, hi]) {
    svg.append(s('line', { class: 'grid', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
    svg.append(s('text', { x: pad.l - 4, y: Y(v) + 3, 'text-anchor': 'end' }, fmtKm(v)));
  }
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(s('text', { x: X(f * o.period), y: H - 3, 'text-anchor': f === 0 ? 'start' : f === 1 ? 'end' : 'middle' }, f === 0 ? 'now' : `+${fmtDuration(f * o.period).replace(' min', 'm')}`));
  }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.m).toFixed(1)},${Y(p.alt).toFixed(1)}`).join('');
  const color = '#5598e7';
  const defs = s('defs');
  defs.innerHTML = `<linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`;
  svg.append(defs);
  svg.append(s('path', { d: `${d}L${X(pts[pts.length - 1].m)},${H - pad.b}L${X(0)},${H - pad.b}Z`, fill: 'url(#ag)' }));
  svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  marker.setAttribute('cx', String(X(0)));
  marker.setAttribute('cy', String(Y(pts[0].alt)));
  svg.append(marker);
  return svg;
}
