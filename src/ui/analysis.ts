import type { App } from '../app';
import type { SatObject } from '../data/catalog';
import { ownerName } from '../data/codes';
import { loadLaunchStats, type LaunchStats } from '../data/more';
import { NEUTRAL, SLOTS, STATUS_COLORS } from '../data/model';
import { inGraveyard, lifetimeYears } from '../sim/lifetime';
import { fmt, fmtCompact, fmtInt, h, s } from './dom';

/**
 * More Insights tabs: constellation health, disposal compliance and launch
 * statistics. Drawn into chart shells made by insights.ts.
 */
export interface Shell {
  el: HTMLElement;
  plot: HTMLElement;
  svg(): { W: number; H: number; svg: SVGElement };
  setTable(head: string[], rows: string[][]): void;
}
type Tip = (e: MouseEvent, title: string, rows: [string, string, string?][]) => void;
type MakeShell = (title: string, desc: string, typeLegend: boolean, legend?: [string, string][]) => Shell;

const meanAlt = (o: SatObject) => (o.perigee + o.apogee) / 2;
const DAY = 86400e3;

// ---------- constellation health ----------
export const FLEETS: { key: string; label: string; re: RegExp }[] = [
  { key: 'starlink', label: 'Starlink', re: /^STARLINK/i },
  { key: 'oneweb', label: 'OneWeb', re: /^ONEWEB/i },
  { key: 'kuiper', label: 'Kuiper', re: /^KUIPER/i },
  { key: 'qianfan', label: 'Qianfan', re: /^QIANFAN|^G60/i },
  { key: 'guowang', label: 'Guowang', re: /^GUOWANG|^HULIANWANG/i },
];
export type FleetState = 'raising' | 'operational' | 'lowering' | 'reentered';
const STATE_COLOR: Record<FleetState, string> = { raising: SLOTS[3], operational: STATUS_COLORS.good, lowering: SLOTS[1], reentered: NEUTRAL };
const STATE_LABEL: Record<FleetState, string> = { raising: 'Raising', operational: 'At working altitude', lowering: 'Lowering / deorbiting', reentered: 'Re-entered' };

/** Working shells: altitudes where many of the fleet sit (5 km bins, local peaks). */
export function shells(objs: SatObject[]) {
  const bins = new Map<number, number>();
  for (const o of objs) if (o.ecc < 0.01) bins.set(Math.round(meanAlt(o) / 5), (bins.get(Math.round(meanAlt(o) / 5)) ?? 0) + 1);
  const min = Math.max(5, objs.length * 0.03);
  const peaks: number[] = [];
  for (const [b, n] of [...bins.entries()].sort((a, c) => c[1] - a[1])) {
    if (n < min) break;
    if (peaks.some((p) => Math.abs(p - b * 5) < 20)) continue;
    peaks.push(b * 5);
  }
  return peaks.sort((a, b) => a - b);
}

export function fleetState(app: App, o: SatObject, sh: number[], now: number): FleetState {
  if (o.decay || !app.isLiveObject(o)) return 'reentered';
  const man = app.manoeuvres?.byNorad.get(o.norad);
  if (man && now - man.tMs < 10 * DAY) {
    if (man.kind === 'raise') return 'raising';
    if (man.kind === 'lower') return 'lowering';
  }
  const a = meanAlt(o);
  const near = sh.length ? sh.reduce((b, x) => (Math.abs(x - a) < Math.abs(b - a) ? x : b), sh[0]) : a;
  if (Math.abs(a - near) <= 12) return 'operational';
  const age = o.launch ? (now - Date.parse(o.launch + 'T00:00:00Z')) / DAY : Infinity;
  // Young satellites below a shell are on their way up; old ones are coming down.
  return age < 200 && a < near ? 'raising' : 'lowering';
}

// ---------- disposal ----------
export type Disposal = 'le5' | 'le25' | 'gt25';
export const DISPOSAL_COLOR: Record<Disposal, string> = { le5: STATUS_COLORS.good, le25: STATUS_COLORS.warn, gt25: STATUS_COLORS.bad };
export const DISPOSAL_LABEL: Record<Disposal, string> = { le5: 'Down within 5 years', le25: 'Within 25 years', gt25: 'More than 25 years' };
const disposal = (o: SatObject): Disposal => {
  const y = lifetimeYears(o);
  return y <= 5 ? 'le5' : y <= 25 ? 'le25' : 'gt25';
};
/** Retired objects the disposal rules are about: dead payloads and rocket stages launched since 2000. */
const retired = (o: SatObject) => (o.type === 'R' || (o.type === 'P' && o.status === '-')) && (o.launchYear ?? 0) >= 2000;

const COUNTRY_COLOR: Record<string, string> = { US: SLOTS[0], RU: SLOTS[2], CN: SLOTS[1], EU: SLOTS[6], IN: SLOTS[5], JP: SLOTS[4], NZ: SLOTS[7] };

export function mountAnalysis(app: App, chartShell: MakeShell, tip: Tip, untip: () => void, redraw: () => void) {
  // ---------- constellations ----------
  const fleetBars = chartShell('Constellation health', 'Each megaconstellation’s satellites: still climbing, at their working altitude, coming down, or already re-entered · from current orbits and recent manoeuvres', false, (Object.keys(STATE_LABEL) as FleetState[]).map((k) => [STATE_LABEL[k], STATE_COLOR[k]]));
  const fleetScatter = chartShell('Altitude by launch date', 'Every satellite of one constellation: newer batches climb from their release altitude to the working shells (dashed) · hover to identify, click to select', false);
  const fleetChips = h('div', { class: 'chips gabbard-presets' });
  fleetScatter.el.insertBefore(fleetChips, fleetScatter.plot);
  let fleet = 'starlink';

  // ---------- disposal ----------
  const dispOwners = chartShell('Disposal compliance by owner', 'Dead payloads and rocket stages in low orbit launched since 2000, by how long drag will take to bring them down', false, (Object.keys(DISPOSAL_LABEL) as Disposal[]).map((k) => [DISPOSAL_LABEL[k], DISPOSAL_COLOR[k]]));
  const dispEra = chartShell('By launch decade', 'The same objects by when they were launched, payloads and rocket stages separately', false, (Object.keys(DISPOSAL_LABEL) as Disposal[]).map((k) => [DISPOSAL_LABEL[k], DISPOSAL_COLOR[k]]));
  const dispGeo = chartShell('Retired in geostationary orbit', 'Dead satellites near GEO since 2000: moved up to the graveyard orbit (at least 200 km above GEO), or left in the busy belt', false, [
    ['Graveyard', STATUS_COLORS.good],
    ['Left near GEO', STATUS_COLORS.bad],
  ]);
  const dispNote = h('span', { class: 'chart-note' });
  dispGeo.el.append(dispNote);

  // ---------- launches ----------
  const COUNTRIES = ['US', 'CN', 'RU', 'EU', 'IN', 'JP', 'NZ'];
  const launchYears = chartShell('Orbital launches per year', 'Successful launches by where they flew from, since Sputnik · hover for numbers', false, [...COUNTRIES.map((c) => [c === 'RU' ? 'Russia / USSR' : c === 'EU' ? 'Europe' : c === 'NZ' ? 'New Zealand' : c === 'US' ? 'United States' : c === 'CN' ? 'China' : c === 'IN' ? 'India' : 'Japan', COUNTRY_COLOR[c]] as [string, string]), ['Other', NEUTRAL]]);
  const launchProviders = chartShell('Launch providers', 'Launches by company or agency in recent years, failures in red', false, [
    ['Launches', SLOTS[0]],
    ['Failures', STATUS_COLORS.bad],
  ]);
  const launchRockets = chartShell('Rockets', 'Launches by rocket in recent years, failures in red', false, [
    ['Launches', SLOTS[0]],
    ['Failures', STATUS_COLORS.bad],
  ]);
  const launchReuse = chartShell('Reuse and success', 'Per year: launches, the share flying a booster that had flown before, booster landings that succeeded, and launch success', false, [
    ['Launches', '#3a4458'],
    ['Reused booster', SLOTS[3]],
    ['Landing success', SLOTS[2]],
    ['Launch success', SLOTS[0]],
  ]);
  let stats: LaunchStats | null = null;
  let statsLoading = false;
  let statsTried = false;

  const grids = {
    constellations: h('div', { class: 'insights-grid two', hidden: true }, fleetBars.el, fleetScatter.el),
    disposal: h('div', { class: 'insights-grid', hidden: true }, dispOwners.el, dispEra.el, dispGeo.el),
    launches: h('div', { class: 'insights-grid', hidden: true }, launchYears.el, launchProviders.el, launchRockets.el, launchReuse.el),
  };

  // ---------- drawing helpers ----------
  /** Horizontal stacked bars: rows of [label, segments[[value, color, name]]]. */
  function hbars(c: Shell, rows: { label: string; segs: [number, string, string][]; title?: string; onClick?: () => void }[], percent: boolean, padL = 96) {
    const { W, H, svg } = c.svg();
    const pad = { l: padL, r: 46, t: 2, b: 2 };
    const max = Math.max(1, ...rows.map((r) => r.segs.reduce((a, x) => a + x[0], 0)));
    const rh = (H - pad.t - pad.b) / Math.max(rows.length, 1);
    const bh = Math.min(15, rh - 5);
    rows.forEach((r, i) => {
      const total = r.segs.reduce((a, x) => a + x[0], 0);
      const y = pad.t + i * rh + (rh - bh) / 2;
      const scale = (W - pad.l - pad.r) / (percent ? Math.max(1, total) : max);
      svg.append(s('text', { class: 'tick', x: pad.l - 8, y: y + bh / 2 + 3.5, 'text-anchor': 'end', style: 'fill:#b4bccc;font-family:var(--sans);font-size:11px' }, r.label.length > 16 ? r.label.slice(0, 15) + '…' : r.label));
      let x = pad.l;
      for (const [v, col] of r.segs) {
        if (v <= 0) continue;
        svg.append(s('rect', { class: 'mark', x, y, width: Math.max(1, v * scale), height: bh, fill: col }));
        x += v * scale;
      }
      svg.append(s('text', { class: 'tick', x: x + 6, y: y + bh / 2 + 3.5 }, fmtCompact(total)));
      const hit = s('rect', { class: 'hit', x: 0, y: pad.t + i * rh, width: W, height: rh });
      hit.addEventListener('mousemove', (e) => tip(e as MouseEvent, r.title ?? r.label, [...r.segs.map(([v, col, name]) => [name, `${fmtInt(v)}${total ? ` (${Math.round((v / total) * 100)}%)` : ''}`, col] as [string, string, string]), ['Total', fmtInt(total)]]));
      hit.addEventListener('mouseleave', untip);
      if (r.onClick) hit.addEventListener('click', r.onClick);
      svg.append(hit);
    });
    if (!rows.length) svg.append(s('text', { class: 'tick', x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'Nothing to show'));
  }
  const empty = (c: Shell, msg: string) => {
    const { W, H, svg } = c.svg();
    svg.append(s('text', { class: 'tick', x: W / 2, y: H / 2, 'text-anchor': 'middle' }, msg));
  };

  // ---------- constellations ----------
  function fleetObjects(key: string) {
    const f = FLEETS.find((x) => x.key === key)!;
    const gi = app.cat.groups.findIndex((g) => g.key === key);
    return app.cat.objects.filter((o) => o.type === 'P' && (f.re.test(o.name) || (gi >= 0 && o.groups.includes(gi))));
  }
  function drawConstellations() {
    void app.ensureHistory();
    const now = Date.now();
    const rows: Parameters<typeof hbars>[1] = [];
    const table: string[][] = [];
    for (const f of FLEETS) {
      const objs = fleetObjects(f.key);
      if (!objs.length) continue;
      const sh = shells(objs.filter((o) => app.isLiveObject(o)));
      const n: Record<FleetState, number> = { raising: 0, operational: 0, lowering: 0, reentered: 0 };
      for (const o of objs) n[fleetState(app, o, sh, now)]++;
      rows.push({
        label: f.label,
        segs: (Object.keys(n) as FleetState[]).map((k) => [n[k], STATE_COLOR[k], STATE_LABEL[k]]),
        title: `${f.label}${sh.length ? ` · shells ${sh.map((x) => `${x} km`).join(', ')}` : ''}`,
        onClick: () => {
          fleet = f.key;
          drawConstellations();
        },
      });
      table.push([f.label, ...(Object.keys(n) as FleetState[]).map((k) => fmtInt(n[k])), sh.join(', ')]);
    }
    hbars(fleetBars, rows, false, 70);
    fleetBars.setTable(['Constellation', ...Object.values(STATE_LABEL), 'Shells (km)'], table);
    if (app.historyStatus !== 'ready') fleetBars.el.querySelector('p')!.textContent = 'Each megaconstellation’s satellites: still climbing, at their working altitude, coming down, or re-entered (loading re-entries…)';

    fleetChips.replaceChildren(...FLEETS.filter((f) => rows.some((r) => r.label === f.label)).map((f) => h('button', { class: 'chip', 'aria-pressed': String(f.key === fleet), onclick: () => ((fleet = f.key), drawConstellations()) }, f.label)));
    // Scatter for one fleet.
    const objs = fleetObjects(fleet).filter((o) => app.isLiveObject(o) && o.launch);
    const plot = fleetScatter.plot;
    let canvas = plot.querySelector('canvas');
    if (!canvas) {
      canvas = h('canvas');
      plot.replaceChildren(canvas);
      canvas.addEventListener('mousemove', (e) => {
        const r = canvas!.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        let best: (typeof pts)[number] | null = null;
        let bd = 60;
        for (const p of pts) {
          const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        hit = best?.o ?? null;
        canvas!.style.cursor = best ? 'pointer' : '';
        app.setHover(hit);
        if (!best) return untip();
        tip(e, best.o.name, [['Launched', best.o.launch], ['Mean altitude', `${fmtInt(meanAlt(best.o))} km`], ['State', STATE_LABEL[best.st]]]);
      });
      canvas.addEventListener('mouseleave', () => (untip(), app.setHover(null)));
      canvas.addEventListener('click', () => hit && app.select(hit, { fly: true }));
    }
    const W = plot.clientWidth || 400;
    const H = plot.clientHeight || 200;
    const dpr = Math.min(2, window.devicePixelRatio);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const g = canvas.getContext('2d')!;
    g.scale(dpr, dpr);
    const pad = { l: 40, r: 8, t: 8, b: 20 };
    const ts = objs.map((o) => Date.parse(o.launch + 'T00:00:00Z'));
    const tMin = Math.min(...ts);
    const tMax = Math.max(now, ...ts);
    const alts = objs.map(meanAlt);
    const aMin = Math.floor((Math.min(250, ...alts) - 10) / 50) * 50;
    const aMax = Math.ceil((Math.max(...alts) + 10) / 50) * 50;
    const X = (t: number) => pad.l + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - pad.l - pad.r);
    const Y = (a: number) => H - pad.b - ((a - aMin) / Math.max(1, aMax - aMin)) * (H - pad.t - pad.b);
    g.font = '10px "JetBrains Mono Variable", monospace';
    g.fillStyle = '#545c6e';
    g.strokeStyle = 'rgba(160,190,255,0.08)';
    for (let a = aMin; a <= aMax; a += aMax - aMin > 400 ? 100 : 50) {
      g.beginPath();
      g.moveTo(pad.l, Y(a));
      g.lineTo(W - pad.r, Y(a));
      g.stroke();
      g.fillText(String(a), 4, Y(a) + 3);
    }
    for (let y = new Date(tMin).getUTCFullYear() + 1; y <= new Date(tMax).getUTCFullYear(); y++) g.fillText(String(y), X(Date.UTC(y, 0, 1)) - 12, H - 6);
    const sh = shells(objs);
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(12,163,12,0.5)';
    for (const a of sh) {
      g.beginPath();
      g.moveTo(pad.l, Y(a));
      g.lineTo(W - pad.r, Y(a));
      g.stroke();
    }
    g.setLineDash([]);
    const pts: { x: number; y: number; o: SatObject; st: FleetState }[] = [];
    objs.forEach((o, i) => {
      const st = fleetState(app, o, sh, now);
      const x = X(ts[i]) + ((o.norad * 7919) % 100) / 100 - 0.5;
      const y = Y(alts[i]);
      pts.push({ x, y, o, st });
      g.fillStyle = STATE_COLOR[st];
      g.globalAlpha = 0.75;
      g.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    });
    g.globalAlpha = 1;
    let hit: SatObject | null = null;
    fleetScatter.setTable(['Satellite', 'Launched', 'Altitude (km)', 'State'], pts.slice(0, 3000).map((p) => [p.o.name, p.o.launch, fmtInt(meanAlt(p.o)), STATE_LABEL[p.st]]));
  }

  // ---------- disposal ----------
  function drawDisposal() {
    const live = app.cat.objects.slice(0, app.liveCount).filter(retired);
    const leo = live.filter((o) => o.perigee < 2000);
    const byOwner = new Map<string, Record<Disposal, number>>();
    for (const o of leo) {
      const r = byOwner.get(o.owner) ?? { le5: 0, le25: 0, gt25: 0 };
      r[disposal(o)]++;
      byOwner.set(o.owner, r);
    }
    const top = [...byOwner.entries()].sort((a, b) => b[1].le5 + b[1].le25 + b[1].gt25 - (a[1].le5 + a[1].le25 + a[1].gt25)).slice(0, 10);
    hbars(
      dispOwners,
      top.map(([k, r]) => ({ label: ownerName(k), title: `${ownerName(k)} · ${fmtInt(r.le5 + r.le25 + r.gt25)} retired objects in low orbit`, segs: (Object.keys(DISPOSAL_LABEL) as Disposal[]).map((d) => [r[d], DISPOSAL_COLOR[d], DISPOSAL_LABEL[d]]), onClick: () => app.setFilters({ owners: new Set([k]) }) })),
      true,
    );
    dispOwners.setTable(['Owner', ...Object.values(DISPOSAL_LABEL), 'Within 25 years'], top.map(([k, r]) => [ownerName(k), fmtInt(r.le5), fmtInt(r.le25), fmtInt(r.gt25), `${Math.round(((r.le5 + r.le25) / Math.max(1, r.le5 + r.le25 + r.gt25)) * 100)}%`]));

    const eras: [string, number, number][] = [
      ['2000–09', 2000, 2009],
      ['2010–19', 2010, 2019],
      ['2020 on', 2020, 9999],
    ];
    const rows: Parameters<typeof hbars>[1] = [];
    for (const [label, a, b] of eras)
      for (const [t, tl] of [
        ['P', 'payloads'],
        ['R', 'stages'],
      ] as [string, string][]) {
        const r = { le5: 0, le25: 0, gt25: 0 };
        for (const o of leo) if (o.type === t && o.launchYear! >= a && o.launchYear! <= b) r[disposal(o)]++;
        rows.push({ label: `${label} ${tl}`, segs: (Object.keys(DISPOSAL_LABEL) as Disposal[]).map((d) => [r[d], DISPOSAL_COLOR[d], DISPOSAL_LABEL[d]]) });
      }
    hbars(dispEra, rows, true, 104);
    dispEra.setTable(['Launched', ...Object.values(DISPOSAL_LABEL)], rows.map((r) => [r.label, ...r.segs.map((x) => fmtInt(x[0]))]));

    const geo = live.filter((o) => o.type === 'P' && o.perigee > 34000 && o.apogee < 40000);
    const g = new Map<string, [number, number]>();
    for (const o of geo) {
      const v = g.get(o.owner) ?? [0, 0];
      v[inGraveyard(o) ? 0 : 1]++;
      g.set(o.owner, v);
    }
    const gTop = [...g.entries()].sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1])).slice(0, 6);
    hbars(dispGeo, gTop.map(([k, v]) => ({ label: ownerName(k), segs: [[v[0], STATUS_COLORS.good, 'Graveyard'], [v[1], STATUS_COLORS.bad, 'Left near GEO']] })), true);
    dispGeo.setTable(['Owner', 'Graveyard', 'Left near GEO'], gTop.map(([k, v]) => [ownerName(k), fmtInt(v[0]), fmtInt(v[1])]));
    const ok = leo.filter((o) => disposal(o) !== 'gt25').length;
    const ok5 = leo.filter((o) => disposal(o) === 'le5').length;
    dispNote.textContent = `${fmtInt(leo.length)} retired objects in low orbit: ${Math.round((ok / Math.max(1, leo.length)) * 100)}% will be down within 25 years (the international guideline), ${Math.round((ok5 / Math.max(1, leo.length)) * 100)}% within 5 (the US FCC rule for satellites launched since late 2024). Lifetimes are rough: from today’s orbit and a typical drag, good to a factor of two.`;
  }

  // ---------- launches ----------
  function drawLaunches() {
    if (!stats) {
      if (!statsTried) {
        statsTried = true;
        statsLoading = true;
        void loadLaunchStats().then((d) => {
          stats = d;
          statsLoading = false;
          redraw();
        });
      }
      for (const c of [launchYears, launchProviders, launchRockets, launchReuse]) empty(c, statsLoading ? 'Loading…' : 'Launch statistics are unavailable');
      return;
    }
    // 1. per year by country (stacked columns)
    {
      const ys = stats.satcat.years;
      const { W, H, svg } = launchYears.svg();
      const pad = { l: 34, r: 6, t: 6, b: 18 };
      const max = Math.max(1, ...ys.map((y) => y[1]));
      const y0 = ys[0]?.[0] ?? 1957;
      const y1 = ys[ys.length - 1]?.[0] ?? new Date().getUTCFullYear();
      const bw = (W - pad.l - pad.r) / Math.max(1, y1 - y0 + 1);
      const Y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
      for (let v = 100; v <= max; v += max > 250 ? 100 : 50) {
        svg.append(s('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
        svg.append(s('text', { class: 'tick', x: pad.l - 5, y: Y(v) + 3, 'text-anchor': 'end' }, String(v)));
      }
      for (const [y, total, by] of ys) {
        const x = pad.l + (y - y0) * bw;
        let acc = 0;
        for (const c of [...COUNTRIES, 'XX']) {
          const v = c === 'XX' ? total - COUNTRIES.reduce((a, k) => a + (by[k] ?? 0), 0) : (by[c] ?? 0);
          if (v <= 0) continue;
          svg.append(s('rect', { class: 'mark', x: x + 0.5, y: Y(acc + v), width: Math.max(1, bw - 1), height: Y(acc) - Y(acc + v), fill: COUNTRY_COLOR[c] ?? NEUTRAL }));
          acc += v;
        }
        const hit = s('rect', { class: 'hit', x, y: pad.t, width: bw, height: H - pad.t - pad.b });
        hit.addEventListener('mousemove', (e) =>
          tip(e as MouseEvent, `${y}: ${total} launches`, Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => [stats!.countries[k] ?? k, fmtInt(v), COUNTRY_COLOR[k] ?? NEUTRAL])),
        );
        hit.addEventListener('mouseleave', untip);
        svg.append(hit);
      }
      for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) svg.append(s('text', { class: 'tick', x: pad.l + (y - y0) * bw, y: H - 4, 'text-anchor': 'middle' }, String(y)));
      launchYears.setTable(['Year', 'Launches', ...COUNTRIES, 'Other'], ys.map(([y, t, by]) => [String(y), fmtInt(t), ...COUNTRIES.map((c) => fmtInt(by[c] ?? 0)), fmtInt(t - COUNTRIES.reduce((a, k) => a + (by[k] ?? 0), 0))]));
    }
    const r = stats.recent;
    if (!r) {
      for (const c of [launchProviders, launchRockets, launchReuse]) empty(c, 'Launch Library history is still being collected');
      return;
    }
    const sub = `${r.from.slice(0, 4)}–${r.to.slice(0, 4)}`;
    launchProviders.el.querySelector('p')!.textContent = `Launches by company or agency, ${sub} (${fmtInt(r.count)} launches), failures in red`;
    launchRockets.el.querySelector('p')!.textContent = `Launches by rocket, ${sub}, failures in red`;
    hbars(launchProviders, r.providers.slice(0, 10).map(([name, n, f]) => ({ label: name.replace(/ \(.*\)$/, '').replace('China Aerospace Science and Technology Corporation', 'CASC'), title: name, segs: [[n - f, SLOTS[0], 'Successful'], [f, STATUS_COLORS.bad, 'Failed']] })), false, 110);
    launchProviders.setTable(['Provider', 'Launches', 'Failures', 'Success rate'], r.providers.map(([n, c, f]) => [n, fmtInt(c), fmtInt(f), `${fmt(((c - f) / Math.max(1, c)) * 100, 1)}%`]));
    hbars(launchRockets, r.rockets.slice(0, 10).map(([name, n, f]) => ({ label: name, segs: [[n - f, SLOTS[0], 'Successful'], [f, STATUS_COLORS.bad, 'Failed']] })), false, 110);
    launchRockets.setTable(['Rocket', 'Family', 'Launches', 'Failures'], r.rockets.map(([n, c, f, fam]) => [n, fam, fmtInt(c), fmtInt(f)]));
    // 4. reuse and success per year
    {
      const { W, H, svg } = launchReuse.svg();
      const pad = { l: 34, r: 34, t: 8, b: 18 };
      const ys = r.years;
      const max = Math.max(1, ...ys.map((y) => y[1]));
      const bw = (W - pad.l - pad.r) / Math.max(1, ys.length);
      const Y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
      const P = (f: number) => H - pad.b - f * (H - pad.t - pad.b);
      ys.forEach(([y, n], i) => {
        svg.append(s('rect', { class: 'mark', x: pad.l + i * bw + bw * 0.2, y: Y(n), width: bw * 0.6, height: Y(0) - Y(n), fill: '#3a4458' }));
        svg.append(s('text', { class: 'tick', x: pad.l + i * bw + bw / 2, y: H - 4, 'text-anchor': 'middle' }, String(y)));
      });
      for (const [k, col, f] of [
        [3, SLOTS[3], (y: (typeof ys)[number]) => y[3] / Math.max(1, y[1])],
        [2, SLOTS[2], (y: (typeof ys)[number]) => (y[5] ? y[6] / y[5] : NaN)],
        [1, SLOTS[0], (y: (typeof ys)[number]) => (y[1] - y[2]) / Math.max(1, y[1])],
      ] as [number, string, (y: (typeof ys)[number]) => number][]) {
        void k;
        const d = ys.map((y, i) => [pad.l + i * bw + bw / 2, f(y)] as [number, number]).filter((p) => Number.isFinite(p[1]));
        svg.append(s('path', { d: d.map(([x, v], i) => `${i ? 'L' : 'M'}${x},${P(v)}`).join(''), fill: 'none', stroke: col, 'stroke-width': 2 }));
        for (const [x, v] of d) svg.append(s('circle', { cx: x, cy: P(v), r: 2.5, fill: col }));
      }
      for (const v of [0.5, 1]) svg.append(s('text', { class: 'tick', x: W - pad.r + 4, y: P(v) + 3 }, `${v * 100}%`));
      svg.append(s('text', { class: 'tick', x: pad.l - 5, y: Y(max) + 8, 'text-anchor': 'end' }, String(max)));
      ys.forEach((y, i) => {
        const hit = s('rect', { class: 'hit', x: pad.l + i * bw, y: pad.t, width: bw, height: H - pad.t - pad.b });
        hit.addEventListener('mousemove', (e) =>
          tip(e as MouseEvent, String(y[0]), [
            ['Launches', fmtInt(y[1])],
            ['Failures', fmtInt(y[2])],
            ['Reused boosters', `${fmtInt(y[3])} (${Math.round((y[3] / Math.max(1, y[1])) * 100)}% of launches)`],
            ['Booster landings', y[5] ? `${fmtInt(y[6])} of ${fmtInt(y[5])} attempts` : '—'],
          ]),
        );
        hit.addEventListener('mouseleave', untip);
        svg.append(hit);
      });
      launchReuse.setTable(['Year', 'Launches', 'Failures', 'Reused boosters', 'Landing attempts', 'Landings'], ys.map((y) => [String(y[0]), fmtInt(y[1]), fmtInt(y[2]), fmtInt(y[3]), fmtInt(y[5]), fmtInt(y[6])]));
    }
  }

  return {
    grids,
    draw(tab: 'constellations' | 'disposal' | 'launches') {
      if (tab === 'constellations') drawConstellations();
      else if (tab === 'disposal') drawDisposal();
      else drawLaunches();
    },
    scope(tab: 'constellations' | 'disposal' | 'launches') {
      if (tab === 'launches') return stats ? `${fmtInt(stats.satcat.years.reduce((a, y) => a + y[1], 0))} orbital launches since 1957${stats.sample ? ' · sample data' : ''}` : '';
      if (tab === 'disposal') return 'Dead payloads and rocket stages, today’s orbits';
      return 'Megaconstellations, today’s orbits';
    },
  };
}
