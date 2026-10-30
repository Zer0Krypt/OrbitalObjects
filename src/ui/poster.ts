import type { App } from '../app';
import { colorFor, legendFor } from '../data/model';
import { download } from './export';
import { describeView } from './export';
import { fmtInt, h, icon, ICONS } from './dom';

/**
 * Poster export: a high-resolution render of the current view with a title,
 * date and legend, e.g. "Everything in orbit on my birthday".
 */

type Format = 'portrait' | 'square' | 'landscape';
const FORMATS: Record<Format, { label: string; w: number; h: number; globe: [number, number] }> = {
  portrait: { label: 'Print, portrait · 2480 × 3508 (A4 at 300 dpi)', w: 2480, h: 3508, globe: [2480, 2480] },
  square: { label: 'Square · 2400 × 2400', w: 2400, h: 2400, globe: [2400, 2400] },
  landscape: { label: 'Wide · 3840 × 2160 (4K)', w: 3840, h: 2160, globe: [3840, 2160] },
};

const nextFrames = (app: App, n: number) =>
  new Promise<void>((resolve) => {
    let k = 0;
    const off = app.on('frame', () => {
      if (++k >= n) {
        off();
        resolve();
      }
    });
  });

/** Wait until history mode has loaded the objects and positions for its date. */
async function historySettled(app: App) {
  for (let i = 0; i < 100 && app.historyStatus === 'loading'; i++) await new Promise((r) => setTimeout(r, 100));
  await nextFrames(app, 12);
}

function legendRows(app: App) {
  const list = app.history ? app.inOrbitList().filter((o) => app.visible[o.idx]) : app.visibleList;
  const counts = new Map<string, number>();
  for (const o of list) {
    const c = colorFor(o, app.colorMode);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return legendFor(app.colorMode)
    .map((it) => ({ ...it, n: counts.get(it.color) ?? 0 }))
    .filter((it) => it.n > 0)
    .slice(0, 8);
}

export async function renderPoster(app: App, fmt: Format, title: string, date: number | null) {
  const F = FORMATS[fmt];
  const max = app.stage.maxRenderSize;
  const k = Math.min(1, max / Math.max(F.w, F.h));
  const W = Math.round(F.w * k);
  const H = Math.round(F.h * k);
  const gw = Math.round(F.globe[0] * k);
  const gh = Math.round(F.globe[1] * k);
  // A chosen date shows the sky as it was (history mode).
  if (date !== null && Math.abs(date - Date.now()) > 86400e3) {
    app.select(null);
    app.setHistory({ cutoff: date, playing: false });
    await historySettled(app);
  } else await nextFrames(app, 2);

  const r = app.stage.renderer;
  const screenPx = r.domElement.clientHeight * r.getPixelRatio();
  const boost = Math.max(1, gh / screenPx);
  // Points are sized in pixels: scale them so the poster looks like the screen.
  const points = [app.sats.material.uniforms, app.historyLayer?.material.uniforms].filter((u) => !!u);
  const stars = app.celestial.starUniforms;
  const px0 = stars.uPx.value;
  const globe = app.stage.renderOffscreen(
    gw,
    gh,
    () => {
      for (const u of points) u.uBoost.value = boost;
      stars.uPx.value = px0 * boost;
    },
    () => {
      for (const u of points) u.uBoost.value = 1;
      stars.uPx.value = px0;
    },
    fmt === 'landscape' ? 0.17 : 0,
  );

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#02040a';
  g.fillRect(0, 0, W, H);
  g.drawImage(globe, 0, 0);
  const u = W / 1000; // layout unit
  const when = app.history?.cutoff ?? app.clock.now();
  const dateText = new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const sub = describeView(app);
  const legend = legendRows(app);

  // Where the text goes: below the globe, or over a darkened edge.
  let x = 60 * u;
  let y: number;
  if (fmt === 'portrait') {
    const grd = g.createLinearGradient(0, gh - 260 * u, 0, gh);
    grd.addColorStop(0, 'rgba(2,4,10,0)');
    grd.addColorStop(1, 'rgba(2,4,10,1)');
    g.fillStyle = grd;
    g.fillRect(0, gh - 260 * u, W, 260 * u);
    y = gh + 40 * u;
  } else if (fmt === 'square') {
    const grd = g.createLinearGradient(0, H * 0.55, 0, H);
    grd.addColorStop(0, 'rgba(2,4,10,0)');
    grd.addColorStop(1, 'rgba(2,4,10,0.95)');
    g.fillStyle = grd;
    g.fillRect(0, H * 0.55, W, H * 0.45);
    y = H - 330 * u;
  } else {
    const grd = g.createLinearGradient(0, 0, W * 0.5, 0);
    grd.addColorStop(0, 'rgba(2,4,10,0.95)');
    grd.addColorStop(1, 'rgba(2,4,10,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W * 0.5, H);
    x = 50 * u;
    y = H * 0.2;
  }
  const font = (weight: number, size: number, mono = false) => `${weight} ${size * u}px ${mono ? '"JetBrains Mono Variable", ui-monospace, monospace' : '"Inter Variable", Inter, system-ui, sans-serif'}`;
  g.textBaseline = 'top';
  g.fillStyle = '#9fb3d6';
  g.font = font(600, 15);
  g.fillText('ORBITAL OBJECTS', x, y);
  y += 34 * u;
  g.fillStyle = '#eaeef6';
  // Wrap the title to the text column.
  const maxW = fmt === 'landscape' ? W * 0.38 : W - 2 * x;
  let size = fmt === 'landscape' ? 44 : 64;
  g.font = font(650, size);
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > 3) {
    size *= 0.75;
    g.font = font(650, size);
  }
  for (const l of lines.slice(0, 4)) {
    g.fillText(l, x, y);
    y += size * 1.12 * u;
  }
  y += 12 * u;
  g.fillStyle = '#ffd27a';
  g.font = font(500, 22, true);
  g.fillText(dateText, x, y);
  y += 38 * u;
  g.fillStyle = '#b4bccc';
  g.font = font(500, 17);
  g.fillText(sub, x, y);
  y += 44 * u;
  // Legend: colour, label, count.
  g.font = font(500, 15);
  let lx = x;
  const colW = fmt === 'landscape' ? maxW / 2 : (W - 2 * x) / 2;
  legend.forEach((it, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    lx = x + col * colW;
    const ly = y + row * 30 * u;
    g.fillStyle = it.color;
    g.beginPath();
    g.arc(lx + 7 * u, ly + 9 * u, 6 * u, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d6dce8';
    g.fillText(it.label, lx + 22 * u, ly);
    g.fillStyle = '#7c8598';
    g.font = font(500, 14, true);
    g.fillText(fmtInt(it.n), lx + 22 * u + g.measureText(it.label).width * (15 / 14) + 12 * u, ly + 1 * u);
    g.font = font(500, 15);
  });
  // Credits along the bottom.
  g.font = font(400, 12);
  g.fillStyle = '#6b7385';
  g.textBaseline = 'bottom';
  g.fillText(`Positions computed with SGP4 from public element sets · Data: ${app.cat.source} · Earth: NASA Blue Marble`, x, H - 34 * u);
  return c;
}

/** The "Poster" dialog, opened from the share menu. */
export function mountPoster(app: App) {
  const titleIn = h('input', { type: 'text', class: 'share-url', maxlength: 90, 'aria-label': 'Poster title' });
  const dateIn = h('input', { type: 'date', class: 'share-url', 'aria-label': 'Date to show', min: '1957-10-04' });
  const fmtSel = h('select', { class: 'sky-select', 'aria-label': 'Poster size' }, ...(Object.entries(FORMATS) as [Format, (typeof FORMATS)[Format]][]).map(([k, f]) => h('option', { value: k }, f.label)));
  const go = h('button', { class: 'btn primary' }, 'Create poster');
  const status = h('p', { class: 'share-sub' });
  const preview = h('img', { class: 'poster-preview', alt: 'Poster preview', hidden: true });
  const panel = h(
    'div',
    { class: 'modal', hidden: true, role: 'dialog', 'aria-label': 'Poster' },
    h(
      'div',
      { class: 'poster-card' },
      h('button', { class: 'icon-btn close', 'aria-label': 'Close', onclick: () => (panel.hidden = true) }, icon(ICONS.close)),
      h('div', { class: 'eyebrow' }, 'Poster'),
      h('h3', null, 'A print of this view'),
      h('p', { class: 'share-sub' }, 'Renders the globe as it is framed now, at high resolution, with a title, date and legend. Pick a past date to show what was in orbit then.'),
      h('label', { class: 'poster-field' }, h('span', null, 'Title'), titleIn),
      h('label', { class: 'poster-field' }, h('span', null, 'Date'), dateIn),
      h('label', { class: 'poster-field' }, h('span', null, 'Size'), fmtSel),
      h('div', { class: 'share-actions' }, go),
      status,
      preview,
    ),
  );
  document.getElementById('app')!.append(panel);

  go.onclick = async () => {
    go.disabled = true;
    status.textContent = 'Rendering…';
    const d = dateIn.value ? Date.parse(dateIn.value + 'T12:00:00Z') : null;
    try {
      const c = await renderPoster(app, fmtSel.value as Format, titleIn.value.trim() || 'Everything in Earth orbit', d);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (!blob) throw new Error('could not encode the image');
      const name = `orbital-objects-poster-${new Date(app.history?.cutoff ?? app.clock.now()).toISOString().slice(0, 10)}.png`;
      download(blob, name);
      preview.src = URL.createObjectURL(blob);
      preview.hidden = false;
      status.textContent = `Saved ${name} (${c.width} × ${c.height}, ${(blob.size / 1e6).toFixed(1)} MB).`;
    } catch (err) {
      status.textContent = `Couldn't render the poster: ${(err as Error).message}`;
    }
    go.disabled = false;
  };
  panel.addEventListener('pointerdown', (e) => e.target === panel && (panel.hidden = true));
  window.addEventListener('keydown', (e) => e.key === 'Escape' && !panel.hidden && (panel.hidden = true));

  return () => {
    const t = app.history?.cutoff ?? app.clock.now();
    titleIn.value = app.selected ? app.selected.name : describeView(app).split(' · ')[0];
    dateIn.value = new Date(t).toISOString().slice(0, 10);
    dateIn.max = new Date().toISOString().slice(0, 10);
    preview.hidden = true;
    status.textContent = '';
    panel.hidden = false;
    titleIn.focus();
  };
}
