// Orbital Objects embed: a custom element and a tiny API around the
// ?embed iframe, so a page can show a live globe (or a sky view) and talk
// to it without handling postMessage itself.
//
//   <script type="module" src="https://zer0krypt.github.io/OrbitalObjects/embed.js"></script>
//   <orbital-objects norad="25544" height="420"></orbital-objects>
//
// Attributes: norad, search, view ("globe" | "sky"), lat, lon, look ("az,el"),
// caption ("off"), rotate ("off"), height (px, default 420), src (another
// deployment of the site).
//
// Events (on the element): "orbital-objects:selected" with detail { norad, name }.
// Methods: el.select(norad | null), el.search(text).

/** Where the site lives. The copy served by the site itself is rewritten at build time. */
export const DEFAULT_SRC = 'https://zer0krypt.github.io/OrbitalObjects/';

/** Build the iframe URL for a set of options. */
export function embedUrl(opts = {}) {
  const base = new URL(opts.src || DEFAULT_SRC);
  const q = new URLSearchParams();
  if (opts.caption === false) q.set('info', '0');
  if (opts.rotate === false) q.set('rotate', '0');
  const hash = new URLSearchParams();
  if (opts.norad) hash.set('s', String(opts.norad));
  if (opts.search) hash.set('q', opts.search);
  if (opts.view === 'sky' && Number.isFinite(opts.lat) && Number.isFinite(opts.lon)) {
    hash.set('loc', `${opts.lat},${opts.lon},0`);
    hash.set('v', 'sky');
    if (opts.look) hash.set('look', opts.look);
  }
  const query = q.toString();
  return `${base.origin}${base.pathname}?embed${query ? '&' + query : ''}${hash.toString() ? '#' + hash : ''}`;
}

/**
 * Put a live view in `container`. Returns { iframe, select, search, on, destroy }.
 */
export function createOrbitalObjects(container, opts = {}) {
  const iframe = document.createElement('iframe');
  iframe.src = embedUrl(opts);
  iframe.title = opts.title || 'Orbital Objects: objects in Earth orbit, live';
  iframe.loading = 'lazy';
  iframe.allow = 'fullscreen';
  iframe.style.cssText = `display:block;width:100%;height:${opts.height || 420}px;border:0;border-radius:12px;background:#02040a`;
  container.appendChild(iframe);
  const origin = new URL(opts.src || DEFAULT_SRC).origin;
  const listeners = new Set();
  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow || e.origin !== origin) return;
    if (e.data && e.data.type === 'orbital-objects:selected') listeners.forEach((fn) => fn({ norad: e.data.norad, name: e.data.name }));
  };
  window.addEventListener('message', onMessage);
  const post = (msg) => iframe.contentWindow && iframe.contentWindow.postMessage(msg, origin);
  return {
    iframe,
    select: (norad) => post({ type: 'orbital-objects:select', norad: norad === null || norad === undefined ? null : Number(norad) }),
    search: (query) => post({ type: 'orbital-objects:search', query: String(query) }),
    /** Called with { norad, name } whenever the selection changes inside the view. */
    on: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy: () => {
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
}

if (typeof customElements !== 'undefined' && !customElements.get('orbital-objects')) {
  customElements.define(
    'orbital-objects',
    class extends HTMLElement {
      static get observedAttributes() {
        return ['norad', 'search'];
      }
      connectedCallback() {
        if (this._view) return;
        this.style.display = this.style.display || 'block';
        const num = (k) => (this.hasAttribute(k) ? Number(this.getAttribute(k)) : undefined);
        this._view = createOrbitalObjects(this, {
          src: this.getAttribute('src') || undefined,
          norad: num('norad'),
          search: this.getAttribute('search') || undefined,
          view: this.getAttribute('view') || 'globe',
          lat: num('lat'),
          lon: num('lon'),
          look: this.getAttribute('look') || undefined,
          caption: this.getAttribute('caption') !== 'off',
          rotate: this.getAttribute('rotate') !== 'off',
          height: num('height'),
          title: this.getAttribute('title') || undefined,
        });
        this._view.on((detail) => this.dispatchEvent(new CustomEvent('orbital-objects:selected', { detail, bubbles: true })));
      }
      disconnectedCallback() {
        this._view?.destroy();
        this._view = null;
      }
      attributeChangedCallback(name, before, after) {
        if (!this._view || before === after) return;
        if (name === 'norad') this._view.select(after ? Number(after) : null);
        if (name === 'search' && after !== null) this._view.search(after);
      }
      select(norad) {
        this._view?.select(norad);
      }
      search(text) {
        this._view?.search(text);
      }
    },
  );
}
