import changelog from '../../CHANGELOG.md?raw';
import { h, icon, ICONS } from './dom';

/**
 * Version and changelog: About shows the version with a "What's new"
 * button, and after an update a one-time note links to the same list.
 */
export const VERSION = __APP_VERSION__;
const SEEN_KEY = 'oo:seen-version';

/** Inline markdown: **bold**, *italic*, `code` and [links](url). */
function inline(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h('b', null, m[1]));
    else if (m[2]) out.push(h('em', null, m[2]));
    else if (m[3]) out.push(h('code', null, m[3]));
    else out.push(h('a', { href: m[5], target: '_blank', rel: 'noopener' }, m[4]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The changelog as elements (headings, paragraphs and bullet lists). */
export function renderChangelog(md = changelog) {
  const root = h('div', { class: 'changelog' });
  let list: HTMLUListElement | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      list = null;
      continue;
    }
    if (line.startsWith('# ')) continue; // the dialog has its own title
    if (line.startsWith('## ')) {
      list = null;
      const [ver, date] = line.slice(3).split(/\s+—\s+/);
      root.append(h('h3', null, `Version ${ver}`, date ? h('small', null, date) : null));
    } else if (line.startsWith('- ')) {
      if (!list) root.append((list = h('ul')));
      list.append(h('li', null, ...inline(line.slice(2))));
    } else {
      list = null;
      root.append(h('p', null, ...inline(line)));
    }
  }
  return root;
}

let modal: HTMLElement | null = null;
export function openWhatsNew() {
  if (!modal) {
    const close = () => (modal!.hidden = true);
    modal = h(
      'div',
      { class: 'modal', hidden: true },
      h(
        'div',
        { class: 'modal-card whatsnew', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'What’s new' },
        h('button', { class: 'icon-btn close', onclick: close, 'aria-label': 'Close' }, icon(ICONS.close)),
        h('div', { class: 'eyebrow' }, `Version ${VERSION}`),
        h('h2', null, 'What’s new'),
        renderChangelog(),
      ),
    );
    modal.addEventListener('pointerdown', (e) => e.target === modal && close());
    window.addEventListener('keydown', (e) => e.key === 'Escape' && modal && !modal.hidden && close());
    document.getElementById('app')!.append(modal);
  }
  modal.hidden = false;
  markSeen();
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, VERSION);
  } catch {
    /* private mode */
  }
}

/** Once after an update (not on a first visit): a note linking to what changed. */
export function mountWhatsNew(toast: (title: string, body: string, onClick?: () => void) => void) {
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(SEEN_KEY);
  } catch {
    return;
  }
  // First visit: nothing has changed for you yet.
  const firstVisit = !seen && !Object.keys(localStorage).some((k) => /^oo[.:]/.test(k) && k !== SEEN_KEY);
  if (seen === VERSION) return;
  markSeen();
  if (firstVisit) return;
  const top = changelog.split('\n').filter((l) => l.startsWith('- ')).slice(0, 1)[0] ?? '';
  const teaser = top.replace(/^- /, '').replace(/\*\*|\*|`/g, '').split('. ')[0];
  setTimeout(() => toast(`Updated to version ${VERSION}`, `${teaser}.`, openWhatsNew), 2500);
}
