type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) applyAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag: string, attrs?: Record<string, unknown> | null, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVGNS, tag) as SVGElement;
  if (attrs) applyAttrs(el, attrs);
  append(el, children);
  return el;
}

function applyAttrs(el: Element, attrs: Record<string, unknown>) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el: Element, children: Child[]) {
  for (const c of children.flat(Infinity as 1) as Child[]) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export function icon(path: string, cls = '') {
  const el = s('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true' });
  el.innerHTML = path;
  return el;
}

export const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  follow: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v12M7 8l5-5 5 5"/>',
  orbit: '<ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-20 12 12)"/><circle cx="12" cy="12" r="3"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  rew: '<path d="M11 6v12L3 12zM20 6v12l-8-6z"/>',
  ffw: '<path d="M13 6v12l8-6zM4 6v12l8-6z"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
};

// ---------- formatting ----------
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const fmtInt = (n: number) => nf0.format(n);
export const fmt = (n: number, d = 1) =>
  Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';

export function fmtKm(km: number) {
  if (!Number.isFinite(km)) return '—';
  if (Math.abs(km) >= 10000) return `${fmtInt(km)}`;
  return fmt(km, km < 1000 ? 1 : 0);
}

export function fmtCompact(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

export function fmtDuration(min: number) {
  if (!Number.isFinite(min)) return '—';
  if (min < 120) return `${fmt(min, 1)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h < 48) return `${h} h ${String(m).padStart(2, '0')} m`;
  return `${fmt(min / 1440, 2)} d`;
}

export function fmtAgo(ms: number) {
  const s = Math.abs(ms) / 1000;
  const suffix = ms >= 0 ? 'ago' : 'ahead';
  if (s < 90) return `${Math.round(s)} s ${suffix}`;
  if (s < 5400) return `${Math.round(s / 60)} min ${suffix}`;
  if (s < 172800) return `${fmt(s / 3600, 1)} h ${suffix}`;
  if (s < 86400 * 365 * 2) return `${Math.round(s / 86400)} days ${suffix}`;
  return `${fmt(s / (86400 * 365.25), 1)} yr ${suffix}`;
}

export function fmtAge(fromIso: string, now: number) {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return '—';
  const days = (now - t) / 86400000;
  if (days < 60) return `${Math.max(0, Math.round(days))} days`;
  if (days < 730) return `${fmt(days / 30.44, 0)} months`;
  return `${fmt(days / 365.25, 1)} years`;
}

export function fmtUtc(ms: number, withSeconds = true) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${withSeconds ? ':' + p(d.getUTCSeconds()) : ''}`;
}

export function fmtDate(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fmtLat(lat: number) {
  return `${fmt(Math.abs(lat), 2)}° ${lat >= 0 ? 'N' : 'S'}`;
}
export function fmtLon(lon: number) {
  return `${fmt(Math.abs(lon), 2)}° ${lon >= 0 ? 'E' : 'W'}`;
}

export function debounce<T extends (...a: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
