export declare const DEFAULT_SRC: string;

export interface EmbedOptions {
  /** Another deployment of the site (default: the public one). */
  src?: string;
  /** Select this object (NORAD catalogue number). */
  norad?: number;
  /** Filter by a search, e.g. "starlink". */
  search?: string;
  /** "sky" shows the sky from `lat`/`lon`; default "globe". */
  view?: 'globe' | 'sky';
  lat?: number;
  lon?: number;
  /** Initial sky-view direction, "azimuth,elevation" in degrees. */
  look?: string;
  /** Show the caption (default true). */
  caption?: boolean;
  /** Auto-rotate the globe (default true). */
  rotate?: boolean;
  /** Height in pixels (default 420). */
  height?: number;
  title?: string;
}

export interface OrbitalObjectsView {
  iframe: HTMLIFrameElement;
  select(norad: number | null): void;
  search(query: string): void;
  on(fn: (detail: { norad: number | null; name: string | null }) => void): () => void;
  destroy(): void;
}

export declare function embedUrl(opts?: EmbedOptions): string;
export declare function createOrbitalObjects(container: HTMLElement, opts?: EmbedOptions): OrbitalObjectsView;
