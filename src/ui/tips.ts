import type { App } from '../app';
import { h } from './dom';
import { RULES, TIPS } from './tipstext';

/**
 * Explanations everywhere: hovering over (or keyboard-focusing, or
 * long-pressing on a touch screen) any control shows what it does in a styled
 * tip. The text comes from the control's own title, or else from the table in
 * tipstext.ts, looked up by the control's label when it's hovered, so
 * controls built later are covered too. Glossary terms keep their own
 * definitions (glossary.ts). Layers → Explanations on hover turns this off,
 * leaving the browser's plain tooltips.
 */

const CANDIDATE =
  'button, a, [role=tab], [role=switch], summary, select, input, textarea, label, .chip, .kpi, th, .legend .row, .tag, .badge, .eyebrow, .menu-label, .l, dt, .isec > h3, .section-head.collapsible';
const DELAY = 450;
const WARM = 80;
const LONG_PRESS = 450;

const norm = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/[›→↗↓▾▸×]/g, '')
    .replace(/\s*·.*$/, '')
    .replace(/\s*\([^)]*\)$/, '')
    .trim();

/** Counts, notes and icons inside a control aren't part of its name. */
const EXTRA = 'small, em, svg, kbd, .n, .count, .count-badge, .sub, .tag';
const isCount = (t: string) => /^[\s\d.,]+[kKM%]?$/.test(t);

/** The control's own text, without counts and side notes. */
function ownText(el: Element): string {
  let out = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out += n.textContent;
    else if (n instanceof Element && !n.matches(EXTRA)) {
      const t = ownText(n);
      // A bold title leading the control is its name (quick views, tours, tool summaries).
      if (n.matches('b, strong') && t && !out.trim()) return t;
      if (!isCount(t)) out += t;
    }
  }
  return out;
}

/** The label a control is known by, for looking it up in TIPS. */
function labelOf(el: Element) {
  if (el.matches('.toggle')) return norm(ownText(el.querySelector('span') ?? el));
  if (el.matches('.kpi')) return norm(el.querySelector('.l')?.textContent ?? '');
  if (el.matches('.legend .row')) return norm(el.querySelector('span')?.textContent ?? '');
  if (el.matches('.section-head')) return norm(el.querySelector('.eyebrow')?.textContent ?? '');
  if (el.matches('select, input, textarea')) return norm(el.getAttribute('aria-label') || (el as HTMLInputElement).placeholder || '');
  if (el.matches('label')) return norm(ownText(el.querySelector('span') ?? el));
  const own = norm(ownText(el));
  return own || norm(el.getAttribute('aria-label') ?? '');
}

/** The explanation the tables give for a control, if any. */
function lookup(el: Element) {
  const k = labelOf(el);
  if (el.matches('.section-head')) return `${(k && TIPS[k]) || k || 'This section'}. Click the heading to show or hide it.`.replace(/\.\. /, '. ');
  for (const [sel, text] of RULES) if (el.matches(sel)) return text.replace('{}', k || 'this');
  if (!k) return null;
  const bare = k.replace(/\s+[\d.,]+[kKM]?$/, '');
  return TIPS[k] ?? TIPS[bare] ?? TIPS[k.toLowerCase()] ?? null;
}

/** The explanation for `el` (or what it sits in), and the element it belongs to. */
export function tipFor(start: Element | null): { el: HTMLElement; text: string } | null {
  for (let el = start; el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.classList.contains('gl-term') || el.id === 'globe') return null;
    const own = el.dataset.tip || el.title || el.dataset.tipT;
    if (own) return { el, text: own };
    // A collapsible heading speaks for its title.
    if (el.matches('.section-head.collapsible .eyebrow')) continue;
    if (el.matches(CANDIDATE)) {
      const t = lookup(el);
      if (t) return { el, text: t };
      // A real control with nothing to say ends the search; a label inside a bigger control doesn't.
      if (el.matches('button, a, select, input, textarea, [role=tab], [role=switch], summary')) return null;
    }
    // Big containers never explain what's inside them.
    if (el.matches('.panel, .modal-card, .layers-menu, .insights, .timebar, .watch-panel')) return null;
  }
  return null;
}

export function mountTips(app: App) {
  const tip = h('div', { id: 'ui-tip', role: 'tooltip', hidden: true });
  document.body.append(tip);
  let current: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastShown = 0;
  let touchShown = 0;

  const on = () => app.settings.tips;

  /** Keep the browser's own tooltip from doubling up while ours shows. */
  const stash = (el: HTMLElement) => {
    if (el.title) {
      el.dataset.tipT = el.title;
      el.removeAttribute('title');
    }
  };
  const unstash = (el: HTMLElement) => {
    if (el.dataset.tipT !== undefined) {
      if (!el.title) el.title = el.dataset.tipT;
      delete el.dataset.tipT;
    }
  };

  function place(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    tip.style.left = '0px';
    tip.style.top = '0px';
    const w = tip.offsetWidth;
    const th = tip.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8 + th < innerHeight - 4;
    tip.style.left = `${x}px`;
    tip.style.top = `${below ? r.bottom + 8 : Math.max(4, r.top - th - 8)}px`;
    tip.classList.toggle('above', !below);
  }

  function show(found: { el: HTMLElement; text: string }) {
    tip.textContent = found.text;
    tip.hidden = false;
    place(found.el);
    lastShown = performance.now();
  }

  function hide() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (current) unstash(current);
    current = null;
    if (!tip.hidden) lastShown = performance.now();
    tip.hidden = true;
  }

  document.addEventListener('pointerover', (e) => {
    if (!on() || e.pointerType === 'touch') return;
    const found = tipFor(e.target as Element);
    if (found?.el === current) return;
    hide();
    if (!found) return;
    current = found.el;
    stash(found.el);
    const warm = performance.now() - lastShown < 600;
    timer = setTimeout(() => current === found.el && found.el.isConnected && show(found), warm ? WARM : DELAY);
  });
  document.addEventListener('pointerdown', (e) => e.pointerType !== 'touch' && hide(), true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hide());

  // Keyboard: show for the control that has focus.
  document.addEventListener('focusin', (e) => {
    if (!on()) return;
    const t = e.target as HTMLElement;
    if (!t.matches?.(':focus-visible') || t.matches('input[type=text], input[type=search], textarea')) return;
    const found = tipFor(t);
    hide();
    if (!found) return;
    current = found.el;
    stash(found.el);
    show(found);
  });
  document.addEventListener('focusout', () => hide());

  // Touch: a long press shows the tip instead of pressing the control.
  let press: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener(
    'touchstart',
    (e) => {
      if (press) clearTimeout(press);
      if (!tip.hidden && performance.now() - touchShown > 300) hide();
      if (!on() || e.touches.length !== 1) return;
      const found = tipFor(e.target as Element);
      if (!found) return;
      press = setTimeout(() => {
        current = found.el;
        show(found);
        touchShown = performance.now();
        setTimeout(() => current === found.el && hide(), 5000);
      }, LONG_PRESS);
    },
    { passive: true },
  );
  const cancel = () => press && clearTimeout(press);
  document.addEventListener('touchmove', cancel, { passive: true });
  document.addEventListener('touchend', cancel, { passive: true });
  // The press that showed a tip doesn't also click.
  document.addEventListener(
    'click',
    (e) => {
      if (performance.now() - touchShown < 700) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  document.addEventListener('contextmenu', (e) => performance.now() - touchShown < 1500 && e.preventDefault());

  app.on('settings', () => !on() && hide());
  if (import.meta.env.DEV) (window as unknown as { __tipFor: typeof tipFor }).__tipFor = tipFor;
}
