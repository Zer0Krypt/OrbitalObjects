import { SPACE_AGE_START, type App } from '../app';
import { $, fmtAgo, fmtDate, fmtInt, fmtUtc, h, icon, ICONS } from './dom';
import { EVENT_COLORS, EVENTS, eventObjects, eventTime, type SpaceEvent } from '../data/events';

// Real-time warp rates (sim seconds per real second).
const RATES = [-86400, -3600, -600, -60, -10, 1, 10, 60, 600, 3600, 86400];
// History playback speeds (years of launches per real second).
const YEAR = 365.25 * 86400e3;
const HISTORY_SPEEDS = [1 / 12, 0.25, 0.5, 1, 2, 4, 8];

// The scrub track has two zones: history (1957 → 30 days ago) and a fine,
// real-propagation window (30 days ago → 7 days ahead) on the right.
const FINE_BACK = 30 * 86400e3;
const FINE_FWD = 7 * 86400e3;
const SPLIT = 0.8;

function rateLabel(r: number) {
  const a = Math.abs(r);
  const sign = r < 0 ? '−' : '';
  if (a < 60) return `${sign}${a}×`;
  if (a < 3600) return `${sign}${a / 60} min/s`;
  if (a < 86400) return `${sign}${a / 3600} h/s`;
  return `${sign}${a / 86400} d/s`;
}

function historyLabel(speed: number) {
  const yps = (speed * 1000) / YEAR;
  const hps = (speed * 1000) / 3600e3;
  if (hps < 24) return `${+hps.toFixed(1)} h/s`;
  if (hps < 24 * 28) return `${+(hps / 24).toFixed(1)} d/s`;
  if (yps < 1) return `${Math.round(yps * 12)} mo/s`;
  return `${+yps.toFixed(1)} yr/s`;
}

const ICON_HISTORY = '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/>';

export function mountTimeline(app: App) {
  const root = $('#timebar');

  // ---------- scrub track ----------
  const canvas = h('canvas', { class: 'scrub-bg' });
  const fill = h('div', { class: 'scrub-fill' });
  const thumb = h('div', { class: 'scrub-thumb' });
  const nowMark = h('div', { class: 'scrub-now' });
  const split = h('div', { class: 'scrub-split' });
  const tip = h('div', { class: 'scrub-tip', hidden: true });
  const marks = h('div', { class: 'scrub-events' });
  const scrub = h(
    'div',
    { class: 'scrub', role: 'slider', tabindex: '0', 'aria-label': 'Scrub time. Left: history since 1957, right: the last 30 days and next 7 days' },
    canvas,
    fill,
    split,
    nowMark,
    thumb,
    marks,
    tip,
  );
  const ticks = h('div', { class: 'scrub-ticks' });

  // ---------- controls ----------
  const date = h('div', { class: 'd' });
  const sub = h('div', { class: 's' }, h('i', { class: 'live-dot' }), h('span'));
  const play = h('button', { class: 'tb play', 'aria-label': 'Play / pause (Space)', title: 'Play / pause (Space)' });
  const slower = h('button', { class: 'tb', 'aria-label': 'Slower', title: 'Slower ( [ )' }, icon(ICONS.rew));
  const faster = h('button', { class: 'tb', 'aria-label': 'Faster', title: 'Faster ( ] )' }, icon(ICONS.ffw));
  const speed = h('div', { class: 'speed', 'aria-live': 'polite' });
  const replay = h('button', { class: 'tb-replay', title: 'Replay the space age from 1957 (H)' }, icon(ICON_HISTORY), h('span', null, 'Replay 1957→'));
  const now = h('button', { class: 'tb-now', title: 'Return to live time (N)' }, 'LIVE');

  // ---------- history HUD ----------
  const hudYear = h('div', { class: 'hud-year' });
  const hudNote = h('div', { class: 'hud-note' });
  let noteFor = '';
  const syncNote = () => {
    const st = app.historyStatus;
    const snap = app.historyLayer?.snapshotYear ?? null;
    const key = `${st}:${snap}:${app.snapshotYears.length}`;
    if (key === noteFor) return;
    noteFor = key;
    const reentered = `${fmtInt(app.historyInfo.count)} objects that have since re-entered`;
    hudNote.textContent =
      st === 'loading'
        ? 'Loading objects that have since re-entered…'
        : st !== 'ready'
          ? "Showing objects still in orbit today on their launch dates; re-entered objects couldn't be loaded."
          : snap !== null
            ? `Orbits as they were on 1 January ${snap}, from the U.S. Space Force element-set history. Includes ${reentered}. Positions along each orbit are illustrative.`
            : app.snapshotYears.length
              ? `Today's orbits for objects still in orbit and last known orbits for the ${reentered} (no yearly snapshot near this date).`
              : `Includes ${reentered}, on their last known orbits${app.historyInfo.approx ? ` (${fmtInt(app.historyInfo.approx)} reconstructed from catalogue summaries)` : ''}. Today's objects are shown on today's orbits.`;
  };
  const hudCount = h('div', { class: 'hud-count' });
  const hudEvent = h('div', { class: 'hud-event', hidden: true });
  const hud = h(
    'div',
    { class: 'history-hud', hidden: true, 'aria-live': 'off' },
    hudYear,
    hudCount,
    hudEvent,
    hudNote,
  );
  document.getElementById('app')!.append(hud);

  root.append(
    h('div', { class: 'scrub-wrap' }, scrub, ticks),
    h('div', { class: 'tb-row' }, h('div', { class: 'clock' }, date, sub), h('div', { class: 'tb-sep' }), slower, play, faster, speed, h('div', { class: 'tb-sep' }), replay, now),
  );

  // ---------- mapping ----------
  const fineStart = () => Date.now() - FINE_BACK;
  function toFrac(t: number) {
    const fs = fineStart();
    if (t <= fs) return Math.max(0, (SPLIT * (t - SPACE_AGE_START)) / (fs - SPACE_AGE_START));
    return Math.min(1, SPLIT + ((1 - SPLIT) * (t - fs)) / (FINE_BACK + FINE_FWD));
  }
  function fromFrac(f: number) {
    const fs = fineStart();
    if (f <= SPLIT) return SPACE_AGE_START + (f / SPLIT) * (fs - SPACE_AGE_START);
    return fs + ((f - SPLIT) / (1 - SPLIT)) * (FINE_BACK + FINE_FWD);
  }
  /** Time the thumb represents right now. */
  const current = () => (app.history ? app.history.cutoff : app.clock.now());

  function seek(t: number) {
    if (t < fineStart()) {
      app.setHistory({ cutoff: t, playing: false });
    } else {
      app.exitHistory();
      app.clock.set(t);
    }
  }

  // ---------- ticks ----------
  function renderTicks() {
    const items: [number, string, string?][] = [];
    const every = scrub.clientWidth < 520 ? 20 : 10;
    for (let y = 1960; y <= new Date().getUTCFullYear(); y += every) items.push([toFrac(Date.UTC(y, 0, 1)), String(y)]);
    items.push([toFrac(fineStart() + 1), '−30d', 'fine']);
    items.push([toFrac(Date.now()), 'Now', 'now']);
    // Drop decade labels that would collide with the fine-zone labels.
    const kept = items.filter(([f, , k]) => k || f < SPLIT - 0.045);
    ticks.replaceChildren(...kept.map(([f, l, k]) => h('span', { class: k ? `t-${k}` : '', style: `left:${(f * 100).toFixed(2)}%` }, l)));
    split.style.left = `${SPLIT * 100}%`;
    renderMarks();
  }

  // ---------- background: objects in orbit over time ----------
  let launches = new Float64Array(0);
  let decays = new Float64Array(0);
  function rebuildSeries() {
    const l: number[] = [];
    const d: number[] = [];
    for (const o of app.visibleList) {
      const t = app.launchMs[o.idx];
      if (!Number.isFinite(t)) continue;
      l.push(t);
      if (o.decay) d.push(Date.parse(o.decay + 'T12:00:00Z'));
    }
    launches = Float64Array.from(l).sort();
    decays = Float64Array.from(d).sort();
    drawBg();
  }
  const below = (arr: Float64Array, t: number) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (arr[m] <= t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  /** Objects (passing filters) in orbit at t: launched and not yet re-entered. */
  const countBy = (t: number) => below(launches, t) - below(decays, t);
  function drawBg() {
    const dpr = Math.min(2, window.devicePixelRatio);
    const W = scrub.clientWidth;
    const H = scrub.clientHeight;
    if (!W) return;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext('2d')!;
    g.scale(dpr, dpr);
    const steps = Math.round(W);
    const vals = new Float64Array(steps + 1);
    let total = 1;
    for (let x = 0; x <= steps; x++) total = Math.max(total, (vals[x] = countBy(fromFrac(x / steps))));
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= steps; x++) {
      const y = H - 2 - (vals[x] / total) * (H - 6);
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(85,152,231,0.42)');
    grd.addColorStop(1, 'rgba(85,152,231,0.04)');
    g.fillStyle = grd;
    g.fill();
    g.strokeStyle = 'rgba(134,182,239,0.7)';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let x = 0; x <= steps; x++) {
      const y = H - 2 - (vals[x] / total) * (H - 6);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // Fine zone tint
    g.fillStyle = 'rgba(124,196,255,0.05)';
    g.fillRect(SPLIT * W, 0, W - SPLIT * W, H);
  }

  // ---------- pointer ----------
  let dragging = false;
  const fracAt = (e: PointerEvent) => {
    const r = scrub.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  function showTip(f: number) {
    const t = fromFrac(f);
    tip.hidden = false;
    tip.style.left = `${f * 100}%`;
    const inHistory = f < SPLIT;
    tip.replaceChildren(
      h('b', null, inHistory ? fmtDate(new Date(t).toISOString().slice(0, 10)) : fmtUtc(t, false) + ' UTC'),
      h('span', null, inHistory ? `${fmtInt(countBy(t))} objects in orbit` : fmtAgo(Date.now() - t)),
    );
  }
  scrub.addEventListener('pointerdown', (e) => {
    dragging = true;
    scrub.setPointerCapture(e.pointerId);
    scrub.classList.add('dragging');
    seek(fromFrac(fracAt(e)));
    showTip(fracAt(e));
  });
  scrub.addEventListener('pointermove', (e) => {
    const f = fracAt(e);
    showTip(f);
    if (dragging) seek(fromFrac(f));
  });
  const end = () => {
    dragging = false;
    scrub.classList.remove('dragging');
  };
  scrub.addEventListener('pointerup', end);
  scrub.addEventListener('pointercancel', end);
  scrub.addEventListener('pointerleave', () => {
    if (!dragging) tip.hidden = true;
  });
  scrub.addEventListener('keydown', (e) => {
    const t = current();
    const hist = !!app.history;
    const stepMs = hist ? (e.shiftKey ? YEAR : YEAR / 12) : e.shiftKey ? 86400e3 : 3600e3;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') seek(t - stepMs);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') seek(t + stepMs);
    else if (e.key === 'Home') seek(SPACE_AGE_START);
    else if (e.key === 'End') {
      app.exitHistory();
      app.clock.resetToNow();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  // ---------- buttons ----------
  const step = (dir: 1 | -1) => {
    if (app.history) {
      const cur = HISTORY_SPEEDS.findIndex((y) => Math.abs((y * YEAR) / 1000 - app.history!.speed) < 1);
      const i = Math.max(0, Math.min(HISTORY_SPEEDS.length - 1, (cur < 0 ? 4 : cur) + dir));
      app.setHistory({ speed: (HISTORY_SPEEDS[i] * YEAR) / 1000, playing: true });
      return;
    }
    const c = app.clock;
    let i = RATES.indexOf(c.rate);
    if (i < 0) i = RATES.indexOf(1);
    i = Math.max(0, Math.min(RATES.length - 1, i + dir));
    c.setRate(RATES[i]);
    if (c.paused) c.setPaused(false);
  };
  const togglePlay = () => {
    if (app.history) app.setHistory({ playing: !app.history.playing });
    else app.clock.setPaused(!app.clock.paused);
  };
  const goLive = () => {
    app.exitHistory();
    app.clock.resetToNow();
  };
  // ---------- events ----------
  let captionUntil = 0;
  function showCaption(e: SpaceEvent, ms = 4500) {
    hudEvent.hidden = false;
    hudEvent.style.setProperty('--ev', EVENT_COLORS[e.kind]);
    hudEvent.replaceChildren(h('b', null, e.title), h('span', null, e.text));
    hudEvent.classList.remove('in');
    void hudEvent.offsetWidth; // restart the entrance animation
    hudEvent.classList.add('in');
    captionUntil = performance.now() + ms;
  }

  /** Jump to an event and highlight the objects involved. */
  function openEvent(e: SpaceEvent) {
    const t = eventTime(e);
    app.select(null);
    // Re-entries: start just before and play slowly through the moment.
    if (e.kind === 'reentry') app.setHistory({ cutoff: t - 86400e3, playing: true, speed: (6 * 3600e3) / 1000 });
    else app.setHistory({ cutoff: t + 2 * 86400e3, playing: false });
    showCaption(e, 7000);
    const apply = () => {
      const gi = (k: string) => app.cat.groups.findIndex((g) => g.key === k);
      const objs = eventObjects(e, app.cat.objects, gi);
      if (objs.length) app.setFilters({ ids: new Set(objs.map((o) => o.norad)), idsLabel: e.title });
      const focus = e.focus ? app.cat.objects.find((o) => o.cospar === e.focus) : undefined;
      if (focus) app.select(focus, { fly: true });
      else app.flyHome();
    };
    // Objects that have since re-entered exist only once history data loads.
    if (app.historyStatus === 'ready' || app.historyStatus === 'error') apply();
    else {
      const off = app.on('history', () => {
        if (app.historyStatus === 'loading') return;
        off();
        apply();
      });
    }
  }

  // Markers; events closer than ~14px merge into one cluster with a picker.
  const picker = h('div', { class: 'ev-picker', hidden: true, role: 'menu' });
  root.append(picker);
  function renderMarks() {
    const W = scrub.clientWidth;
    if (!W) return;
    const clusters: SpaceEvent[][] = [];
    let lastX = -Infinity;
    for (const e of EVENTS) {
      const x = toFrac(eventTime(e)) * W;
      if (x - lastX < 14 && clusters.length) clusters[clusters.length - 1].push(e);
      else clusters.push([e]);
      lastX = x;
    }
    marks.replaceChildren(
      ...clusters.map((list) => {
        const first = list[0];
        const label = list.length === 1 ? `${first.title}, ${fmtDate(first.date)}` : `${list.length} events: ${list.map((e) => e.title).join(', ')}`;
        const m = h('button', {
          class: `ev-mark${list.length > 1 ? ' many' : ''}`,
          'aria-label': label,
          style: `--ev:${EVENT_COLORS[first.kind]};left:${(toFrac(eventTime(first)) * 100).toFixed(2)}%`,
        });
        if (list.length > 1) m.append(h('i', null, String(list.length)));
        // Don't let a click on a marker start a scrub.
        m.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        m.addEventListener('pointermove', (ev) => ev.stopPropagation());
        m.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (list.length === 1) return openEvent(first);
          picker.replaceChildren(
            ...list.map((e) =>
              h(
                'button',
                {
                  style: `--ev:${EVENT_COLORS[e.kind]}`,
                  onclick: () => {
                    picker.hidden = true;
                    openEvent(e);
                  },
                },
                h('i'),
                h('b', null, e.title),
                h('span', null, fmtDate(e.date)),
              ),
            ),
          );
          picker.hidden = false;
          const r = m.getBoundingClientRect();
          const rr = root.getBoundingClientRect();
          picker.style.left = `${Math.max(8, Math.min(rr.width - 268, r.left - rr.left - 20))}px`;
        });
        m.addEventListener('pointerenter', () => {
          tip.hidden = false;
          tip.style.left = m.style.left;
          tip.replaceChildren(
            ...(list.length === 1
              ? [h('b', null, first.title), h('span', null, `${fmtDate(first.date)} · click to go there`)]
              : [h('b', null, `${list.length} events`), h('span', null, list.map((e) => e.title).join(' · '))]),
          );
        });
        m.addEventListener('pointerleave', () => (tip.hidden = true));
        return m;
      }),
    );
  }
  document.addEventListener('pointerdown', (e) => {
    if (!picker.hidden && !picker.contains(e.target as Node)) picker.hidden = true;
  });

  // Captions as playback passes an event.
  let lastCut = -Infinity;
  app.on('history', () => {
    const hs = app.history;
    if (!hs) {
      lastCut = -Infinity;
      // An event's highlight belongs to history mode; drop it on the way out.
      if (app.filters.ids && EVENTS.some((e) => e.title === app.filters.idsLabel)) app.setFilters({ ids: null, idsLabel: '' });
      return;
    }
    if (hs.playing && lastCut > -Infinity) {
      const passed = EVENTS.filter((e) => {
        const t = eventTime(e);
        return t > lastCut && t <= hs.cutoff;
      });
      if (passed.length) showCaption(passed[passed.length - 1]);
    }
    lastCut = hs.cutoff;
  });

  const startReplay = () => {
    app.select(null);
    app.setHistory({ cutoff: SPACE_AGE_START, playing: true, speed: (2 * YEAR) / 1000 });
    app.zoomTo(Math.max(app.stage.camera.position.length(), 4.6));
  };
  slower.onclick = () => step(-1);
  faster.onclick = () => step(1);
  play.onclick = togglePlay;
  now.onclick = goLive;
  replay.onclick = startReplay;

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === ']') step(1);
    else if (e.key === '[') step(-1);
    else if (e.key === 'n' || e.key === 'N') goLive();
    else if (e.key === 'h' || e.key === 'H') startReplay();
  });

  // ---------- sync ----------
  const syncButtons = () => {
    const hs = app.history;
    const paused = hs ? !hs.playing : app.clock.paused;
    play.replaceChildren(icon(paused ? ICONS.play : ICONS.pause));
    speed.textContent = hs ? (hs.playing ? historyLabel(hs.speed) : 'paused') : app.clock.paused ? 'paused' : rateLabel(app.clock.rate);
    root.classList.toggle('is-history', !!hs);
    hud.hidden = !hs;
    document.body.classList.toggle('history-mode', !!hs);
  };
  app.clock.onChange(syncButtons);
  app.on('history', syncButtons);
  app.on('history', syncNote);
  syncButtons();

  let last = 0;
  let lastYear = '';
  let lastW = 0;
  app.on('frame', () => {
    // The track has no width until the app is shown; draw once it does.
    if (scrub.clientWidth !== lastW) {
      lastW = scrub.clientWidth;
      renderTicks();
      drawBg();
    }
    const f = toFrac(current());
    const pct = `${(f * 100).toFixed(3)}%`;
    thumb.style.left = pct;
    fill.style.width = pct;
    nowMark.style.left = `${toFrac(Date.now()) * 100}%`;

    const t = performance.now();
    if (t - last < 80) return;
    last = t;
    const hs = app.history;
    if (hs) {
      const d = new Date(hs.cutoff);
      date.textContent = fmtDate(d.toISOString().slice(0, 10));
      (sub.lastChild as HTMLElement).textContent = 'History · launch date';
      sub.classList.remove('is-live');
      const y = String(d.getUTCFullYear());
      if (y !== lastYear) {
        lastYear = y;
        hudYear.textContent = y;
      }
      hudCount.textContent = `${fmtInt(app.historyShown)} ${app.historyShown === 1 ? 'object' : 'objects'} in orbit`;
      if (!hudEvent.hidden && performance.now() > captionUntil) hudEvent.hidden = true;
      now.classList.remove('on');
      scrub.setAttribute('aria-valuetext', date.textContent);
      return;
    }
    lastYear = '';
    const sim = app.clock.now();
    date.textContent = fmtUtc(sim) + ' UTC';
    const live = app.clock.isLive;
    sub.classList.toggle('is-live', live);
    const off = sim - Date.now();
    (sub.lastChild as HTMLElement).textContent = live
      ? 'Live · real time'
      : app.clock.paused
        ? `Paused · ${fmtAgo(-off).replace('ahead', 'ahead of now').replace('ago', 'before now')}`
        : `Simulated · ${fmtAgo(-off).replace('ago', 'behind')}`;
    now.classList.toggle('on', live);
    scrub.setAttribute('aria-valuetext', date.textContent);
  });

  app.on('filters', rebuildSeries);
  // Ticks drift as "now" moves; refresh occasionally.
  setInterval(renderTicks, 60e3);
  renderTicks();
  requestAnimationFrame(rebuildSeries);
}
