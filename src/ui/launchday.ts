import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import type { Launch } from '../data/watch';
import { eciToGeodetic, gmst, latLonToScene } from '../sim/astro';
import { satrecFor, stateAt } from '../render/orbits';
import { fmtInt, fmtUtc, h, icon, ICONS } from './dom';

/**
 * Launch day mode: follow one launch with a live countdown, its webcast, an
 * estimated ascent track on the globe and the new objects as they appear in
 * the catalogue.
 *
 * The ascent is a sketch built from the best information available:
 *  1. once the launch's objects are catalogued, it ends where the first real
 *     element set puts them at orbit insertion, then follows that orbit;
 *  2. otherwise, when Launch Library lists the first stage's drone-ship
 *     landing, it heads for that point (it sits under the flight path);
 *  3. otherwise, the azimuth that reaches the likely target inclination.
 * The climb's timing uses the published SECO time when there is one.
 */

const DEG = Math.PI / 180;
const RE = 6371;
const ASCENT_S = 540;
const COAST_S = 25 * 60;
const EARTH_RATE = 360 / 86164; // deg/s
const ROCKET = '<path d="M12 2c3 2.5 4.5 6 4.5 10.5L14 16h-4l-2.5-3.5C7.5 8 9 4.5 12 2z"/><circle cx="12" cy="9" r="1.6"/><path d="M10 16l-1.5 4M14 16l1.5 4M12 17v4"/>';

/** Best guess at the target orbit's inclination and the climb's final altitude. */
export function targetOrbit(l: Launch): { incl: number; alt: number; south: boolean; note: string } {
  const lat = Math.abs(l.lat ?? 28.5);
  const name = `${l.name} ${l.mission ?? ''}`;
  const orbit = (l.orbit ?? '').toUpperCase();
  if (/STARLINK/i.test(name)) return (l.lon ?? 0) < -100 ? { incl: 53, alt: 280, south: true, note: 'Starlink shell, 53°' } : { incl: 43, alt: 280, south: false, note: 'Starlink shell, 43°' };
  if (/SHENZHOU|TIANZHOU/i.test(name)) return { incl: 41.5, alt: 210, south: false, note: 'to Tiangong, 41.5°' };
  if (orbit === 'ISS' || /\b(CRS|CREW|AX-|AXIOM|CYGNUS|PROGRESS|SOYUZ MS|DRAGON|HTV|STARLINER)\b/i.test(name)) return { incl: 51.6, alt: 210, south: false, note: 'to the ISS, 51.6°' };
  if (orbit === 'SSO') return { incl: 97.6, alt: 500, south: true, note: 'sun-synchronous, ~97.6°' };
  if (orbit === 'PO' || /POLAR/.test(orbit)) return { incl: 90, alt: 500, south: true, note: 'polar' };
  if (orbit === 'MEO') return { incl: 55, alt: 300, south: false, note: 'navigation orbit, ~55°' };
  if (/GTO|GEO|GSO/.test(orbit)) return { incl: lat, alt: 200, south: false, note: 'geostationary transfer: due east' };
  if (/TLI|LUNAR|HELIO|L1|L2/.test(orbit)) return { incl: lat, alt: 200, south: false, note: 'to the Moon or beyond: due east' };
  return { incl: lat, alt: 250, south: false, note: 'low Earth orbit, due east' };
}

/** Launch azimuth (deg from north) that reaches inclination `incl` from latitude `lat`. */
function azimuth(lat: number, incl: number, south: boolean) {
  const s = Math.cos(incl * DEG) / Math.cos(lat * DEG);
  const b = Math.abs(s) >= 1 ? (s > 0 ? 90 : -90) : Math.asin(s) / DEG;
  return south ? 180 - b : b;
}

/** Point at angular distance `d` (rad) along azimuth `az` from lat/lon. */
function along(lat: number, lon: number, az: number, d: number) {
  const p1 = lat * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(az * DEG));
  const l2 = lon * DEG + Math.atan2(Math.sin(az * DEG) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / DEG, l2 / DEG] as const;
}

/** Initial bearing (deg) and angular distance (rad) between two points. */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const az = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / DEG;
  const d = Math.acos(Math.max(-1, Math.min(1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl))));
  return { az: (az + 360) % 360, d };
}

export interface Profile {
  az: number;
  alt: number;
  /** Seconds from liftoff to orbit insertion (SECO). */
  tIns: number;
  /** Angular distance (rad) flown by insertion, when pinned to a real point. */
  dIns: number | null;
  source: 'catalog' | 'landing' | 'estimate';
  note: string;
  /** The catalogued object whose orbit the track follows after insertion. */
  real: SatObject | null;
}

/** Where a real object is (Earth-fixed lat/lon, km altitude) at a moment. */
function realAt(o: SatObject, ms: number) {
  const rec = satrecFor(o);
  const st = rec ? stateAt(rec, ms) : null;
  if (!st) return null;
  return eciToGeodetic(st.position.x, st.position.y, st.position.z, gmst(ms));
}

/** Build the ascent profile for a launch from the best information available. */
export function profileFor(l: Launch, candidates: SatObject[] = []): Profile {
  const tgt = targetOrbit(l);
  const seco = l.timeline?.find((e) => /^SECO/i.test(e.abbrev) && e.t > 240 && e.t < 1500);
  const tIns = seco?.t ?? ASCENT_S;
  const base = { alt: tgt.alt, tIns, dIns: null, real: null };
  const est: Profile = { ...base, az: azimuth(l.lat!, tgt.incl, tgt.south), source: 'estimate', note: `estimated: ${tgt.note}` };
  // 2. The drone ship waits under the flight path.
  let guess = est;
  const ld = l.landing;
  if (ld) {
    const b = bearing(l.lat!, l.lon!, ld.lat, ld.lon);
    const km = b.d * RE;
    if (km > 100 && km < 1500) guess = { ...base, az: b.az, source: 'landing', note: `heading for the ${ld.abbrev || ld.name} landing zone, ${Math.round(km)} km downrange` };
  }
  // 1. The real orbit: of the objects launched that day, the one passing closest to where the
  //    track expects insertion (several launches can share a date).
  let best: { o: SatObject; p: NonNullable<ReturnType<typeof realAt>>; km: number } | null = null;
  const ins = ascentAt(l, tIns, guess);
  for (const o of candidates) {
    const p = realAt(o, l.netMs + tIns * 1000);
    if (!p) continue;
    const km = bearing(ins.lat, ins.lon, p.lat, p.lon).d * RE;
    if (!best || km < best.km) best = { o, p, km };
  }
  if (best && best.km < 3000) {
    // Aim at where the orbit was at insertion, in the frame the ascent is flown in.
    const b = bearing(l.lat!, l.lon!, best.p.lat, best.p.lon + EARTH_RATE * tIns);
    return { az: b.az, alt: best.p.alt, tIns, dIns: b.d, real: best.o, source: 'catalog', note: `following the catalogued orbit of ${best.o.name}` };
  }
  return guess;
}

/** Lat, lon (Earth-fixed) and altitude `t` seconds after liftoff. */
export function ascentAt(l: Launch, t: number, prof: Profile) {
  const tIns = prof.tIns;
  // After insertion, a catalogued object's real orbit takes over.
  if (prof.real && t > tIns) {
    const p = realAt(prof.real, l.netMs + t * 1000);
    if (p) return { lat: p.lat, lon: p.lon, alt: p.alt };
  }
  const v = Math.sqrt(398600 / (RE + prof.alt));
  const dFull = prof.dIns ?? (v * tIns) / 2.7 / (RE + prof.alt * 0.5);
  let alt: number;
  let ang: number;
  if (t <= tIns) {
    const s = Math.max(0, t) / tIns;
    alt = prof.alt * (1 - (1 - s) ** 1.6);
    ang = dFull * s ** 2.7;
  } else {
    alt = prof.alt;
    ang = dFull + (v * (t - tIns)) / (RE + prof.alt);
  }
  // Fly the great circle in the inertial frame; the ground turns under it.
  const [la, lo] = along(l.lat!, l.lon!, prof.az, ang);
  return { lat: la, lon: lo - EARTH_RATE * Math.max(0, t), alt };
}

export function mountLaunchDay(app: App) {
  // ---------- globe: track and marker ----------
  const N = 160;
  const mat = new LineMaterial({ linewidth: 2.6, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const line = new Line2(new LineGeometry(), mat);
  line.frustumCulled = false;
  const syncRes = () => mat.resolution.set(app.stage.renderer.domElement.clientWidth, app.stage.renderer.domElement.clientHeight);
  syncRes();
  app.stage.onResize(syncRes);
  line.renderOrder = 6;
  line.visible = false;
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.009, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  marker.visible = false;
  marker.renderOrder = 7;
  app.earth.group.add(line, marker);

  // ---------- panel ----------
  const pill = h('button', { class: 'ld-pill', hidden: true });
  const title = h('h3');
  const sub = h('p', { class: 'ld-sub' });
  const clock = h('div', { class: 'ld-clock mono' });
  const phase = h('div', { class: 'ld-phase' });
  const facts = h('dl', { class: 'kv one ld-facts' });
  const actions = h('div', { class: 'sky-actions' });
  const newObjs = h('div', { class: 'ld-new' });
  const panel = h(
    'div',
    { class: 'ld-panel', hidden: true, role: 'dialog', 'aria-label': 'Launch day' },
    h('button', { class: 'close', 'aria-label': 'Leave launch day mode', onclick: () => follow(null) }, icon(ICONS.close)),
    h('div', { class: 'eyebrow' }, icon(ROCKET), 'Launch day'),
    title,
    sub,
    h('div', { class: 'ld-count' }, clock, phase),
    facts,
    actions,
    newObjs,
    h(
      'p',
      { class: 'ld-foot' },
      'The ascent on the globe is a sketch: it uses the published flight events and landing zone when Launch Library lists them, and snaps to the real orbit once the new objects are catalogued. Times often slip.',
    ),
  );
  document.getElementById('app')!.append(pill, panel);

  let current: Launch | null = null;
  let dismissed = '';

  const upcoming = () => (app.launches?.upcoming ?? []).filter((l) => l.netMs > Date.now() - 3 * 3600e3).sort((a, b) => a.netMs - b.netMs);

  let prof: Profile | null = null;
  const eventEls: { el: HTMLElement; pos: THREE.Vector3 }[] = [];
  const overlay = document.getElementById('overlay')!;
  function drawTrack(l: Launch) {
    for (const e of eventEls) e.el.remove();
    eventEls.length = 0;
    if (l.lat === null || l.lon === null) {
      line.visible = false;
      prof = null;
      return;
    }
    const day = new Date(l.netMs).toISOString().slice(0, 10);
    const cands = app.cat.objects.slice(0, app.liveCount).filter((o) => o.launch === day && o.type === 'P');
    prof = profileFor(l, cands);
    const ASC = prof.tIns;
    const pos: number[] = [];
    const col: number[] = [];
    const v = new THREE.Vector3();
    const total = ASC + COAST_S;
    const a = new THREE.Color(0xff8a3d);
    const b = new THREE.Color(0x7cc4ff);
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) ** 1.5 * total;
      const p = ascentAt(l, t, prof);
      latLonToScene(p.lat, p.lon, 1 + p.alt / RE, v);
      pos.push(v.x, v.y, v.z);
      const c = a.clone().lerp(b, Math.min(1, t / ASC));
      const fade = t > ASC ? 1 - 0.75 * ((t - ASC) / COAST_S) : 1;
      col.push(c.r * fade, c.g * fade, c.b * fade);
    }
    const g = new LineGeometry();
    g.setPositions(pos);
    g.setColors(col);
    line.geometry.dispose();
    line.geometry = g;
    line.visible = true;
    // Published flight events (MECO, SECO…) as labelled points along the track.
    for (const e of l.timeline ?? []) {
      if (e.t > total || /landing/i.test(e.abbrev)) continue;
      const p = ascentAt(l, e.t, prof);
      // Early events bunch up near the pad: only engine cutoffs get a text label.
      const key = /^(MECO|SECO)/i.test(e.abbrev);
      const el = h('div', { class: 'ld-event', hidden: true }, h('i'), key ? h('span', null, `${e.abbrev} T+${fmtClock(e.t)}`) : null);
      el.title = `${e.name} (T+${fmtClock(e.t)})`;
      overlay.append(el);
      eventEls.push({ el, pos: latLonToScene(p.lat, p.lon, 1 + p.alt / RE) });
    }
    if (l.landing && prof.source !== 'catalog') {
      const el = h('div', { class: 'ld-event land', hidden: true }, h('i'), h('span', null, l.landing.abbrev || 'Landing'));
      el.title = `${l.landing.name}: first-stage landing${l.landing.downrangeKm ? `, ${l.landing.downrangeKm} km downrange` : ''}`;
      overlay.append(el);
      eventEls.push({ el, pos: latLonToScene(l.landing.lat, l.landing.lon, 1.001) });
    }
  }
  const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const vv = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  function placeEvents() {
    const cam = app.stage.camera;
    const W = app.stage.renderer.domElement.clientWidth;
    const H = app.stage.renderer.domElement.clientHeight;
    const show = line.visible;
    for (const e of eventEls) {
      vv.copy(e.pos).applyAxisAngle(yAxis, app.earth.group.rotation.y);
      const facing = vv.dot(cam.position.clone().sub(vv)) > 0;
      vv.project(cam);
      e.el.hidden = !show || !facing || vv.z > 1;
      if (!e.el.hidden) e.el.style.transform = `translate(${((vv.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((1 - (vv.y * 0.5 + 0.5)) * H).toFixed(1)}px)`;
    }
  }

  /** Catalogue objects launched on the day of this launch, grouped by launch. */
  function catalogued(l: Launch) {
    const day = new Date(l.netMs).toISOString().slice(0, 10);
    const groups = new Map<string, SatObject[]>();
    for (const o of app.cat.objects.slice(0, app.liveCount)) {
      if (o.launch !== day) continue;
      const k = o.cospar.slice(0, 8);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(o);
    }
    return [...groups.entries()];
  }

  function renderStatic() {
    const l = current!;
    drawTrack(l);
    const pr = prof as Profile | null;
    title.textContent = l.mission ?? l.name;
    sub.textContent = [l.rocket, l.provider].filter(Boolean).join(' · ');
    facts.replaceChildren(
      ...([
        ['Launch site', [l.pad, l.location].filter(Boolean).join(', ') || '—'],
        ['Target orbit', l.orbit ?? '—'],
        ['Track', pr ? `${pr.note[0].toUpperCase()}${pr.note.slice(1)}` : 'No pad location'],
        ...((l.timeline ?? []).length ? [['Flight events', (l.timeline ?? []).filter((e) => e.t < 4000).map((e) => `${e.abbrev} ${fmtClock(e.t)}`).join(' · ')] as [string, string]] : []),
        ['Liftoff (NET)', `${fmtUtc(l.netMs, false)} UTC`],
        ['Status', l.statusName ?? l.status ?? '—'],
      ] as [string, string][]).map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))),
    );
    const webcast = l.vidUrl ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${l.mission ?? l.name} launch live`)}`;
    actions.replaceChildren(
      ...[
      h('a', { class: 'btn primary', href: webcast, target: '_blank', rel: 'noopener' }, l.vidUrl ? 'Watch the webcast ↗' : 'Find the webcast ↗'),
      l.lat !== null ? h('button', { class: 'btn', onclick: () => app.flyToLatLon(l.lat!, l.lon!, 2.6) }, 'Fly to the pad') : null,
      l.lat !== null
        ? h(
            'button',
            {
              class: 'btn',
              title: 'Replay the estimated ascent at 10× speed',
              onclick: () => {
                app.exitHistory();
                app.select(null);
                app.clock.set(l.netMs - 20e3);
                app.clock.setRate(10);
                app.clock.setPaused(false);
                app.flyToLatLon(l.lat!, l.lon!, 2.4);
              },
            },
            'Preview the ascent',
          )
        : null,
      l.infoUrl ? h('a', { class: 'btn', href: l.infoUrl, target: '_blank', rel: 'noopener' }, 'Mission page ↗') : null,
      ].filter((x) => x !== null),
    );
    renderNew();
  }

  function renderNew() {
    const l = current;
    if (!l) return;
    const groups = catalogued(l);
    const launched = Date.now() > l.netMs;
    newObjs.replaceChildren(
      h('h4', { class: 'rw-h', style: 'margin:10px 0 6px' }, 'New objects in the catalogue'),
      ...(groups.length
        ? groups.map(([des, objs]) => {
            const lead = objs.find((o) => o.type === 'P') ?? objs[0];
            return h(
              'button',
              {
                class: 'rw-row',
                onclick: () => {
                  app.exitHistory();
                  app.setFilters({ ids: new Set(objs.map((o) => o.norad)), idsLabel: `Launch ${des}` });
                  app.select(lead, { fly: true });
                },
              },
              h('i', { class: 'd', style: `background:${app.colorsHex[lead.idx]};color:${app.colorsHex[lead.idx]}` }),
              h('span', { class: 't' }, h('b', null, lead.name), h('span', null, `${des} · launched ${lead.launch}`)),
              h('span', { class: 'r' }, h('b', null, fmtInt(objs.length)), h('small', null, objs.length === 1 ? 'object' : 'objects')),
            );
          })
        : [
            h(
              'p',
              { class: 'rw-empty', style: 'margin:0' },
              launched
                ? 'Nothing from this launch is catalogued yet. New objects usually appear within a day or two; the data refreshes every six hours.'
                : 'After launch, the new satellites and stages show up here once they are catalogued, usually within a day or two.',
            ),
          ]),
    );
  }

  function tick() {
    const l = current;
    // The pill: the next launch within a day, unless dismissed.
    const next = upcoming().find((x) => x.netMs - Date.now() < 86400e3 && x.netMs > Date.now() - 3600e3);
    pill.hidden = !next || !!current || dismissed === next.id || document.body.classList.contains('embed');
    if (next && !pill.hidden) {
      const dt = next.netMs - Date.now();
      pill.replaceChildren(icon(ROCKET), h('span', null, h('b', null, next.mission ?? next.name), ` · ${(next.rocket ?? '').replace(/ Block \d+$/, '')}`), h('em', { class: 'mono' }, fmtT(dt)), h('span', { class: 'ld-go' }, 'Follow ›'));
      pill.onclick = () => follow(next);
    }
    if (!l) return;
    const wall = Date.now() - l.netMs;
    clock.textContent = fmtT(-wall);
    const t = (app.clock.now() - l.netMs) / 1000;
    phase.textContent =
      wall < -3600e3 ? (l.status && /go/i.test(l.status) ? 'Go for launch' : 'Waiting for launch') : wall < 0 ? 'Countdown' : wall < (prof?.tIns ?? ASCENT_S) * 1000 ? (prof?.source === 'catalog' ? 'Ascent' : 'Ascent (estimated)') : wall < 2 * 3600e3 ? 'In orbit, if all went to plan' : 'Launched';
    placeEvents();
    // The marker follows the simulation clock, so "Preview the ascent" works.
    if (prof && l.lat !== null && t >= 0 && t <= prof.tIns + COAST_S && !app.history) {
      const p = ascentAt(l, t, prof);
      latLonToScene(p.lat, p.lon, 1 + p.alt / RE, marker.position);
      marker.visible = true;
    } else marker.visible = false;
  }

  function fmtT(ms: number) {
    const s = Math.abs(Math.round(ms / 1000));
    const d = Math.floor(s / 86400);
    const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `T${ms >= 0 ? '−' : '+'}${d ? `${d}d ` : ''}${hh}:${mm}:${ss}`;
  }

  function follow(l: Launch | null) {
    if (!l && current) dismissed = current.id;
    current = l;
    panel.hidden = !l;
    document.body.classList.toggle('launch-day', !!l);
    if (!l) {
      line.visible = marker.visible = false;
      for (const e of eventEls) e.el.hidden = true;
      if (app.clock.rate === 10) app.clock.resetToNow();
      tick();
      return;
    }
    app.exitHistory();
    renderStatic();
    if (l.lat !== null) app.flyToLatLon(l.lat, l.lon!, 2.8);
    tick();
  }
  app.followLaunch = (id: string) => {
    const l = app.launches?.upcoming.find((x) => x.id === id);
    if (l) follow(l);
  };

  app.on('frame', () => current && tick());
  app.on('history', () => (line.visible = !!current && !app.history && current.lat !== null));
  app.on('skyview', () => (line.visible = !!current && !app.skyView.active && current.lat !== null));
  app.on('watch', () => {
    if (current) {
      current = app.launches?.upcoming.find((x) => x.id === current!.id) ?? current;
      renderStatic();
    }
    tick();
  });
  setInterval(() => {
    if (!current) tick();
  }, 1000);
  setInterval(renderNew, 60e3);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current && !(e.target instanceof HTMLInputElement)) follow(null);
  });
}
