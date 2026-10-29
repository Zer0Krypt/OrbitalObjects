import type { Catalog, SatObject } from './catalog';

// Wikipedia summaries for catalogue objects. Exact matches come from Wikidata
// (property P247 = COSPAR ID); otherwise we fall back to a related article:
// the debris event, the constellation, or the parent launch's main payload.

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
  thumb?: { src: string; width: number; height: number };
  relation: 'exact' | 'event' | 'constellation' | 'launch';
  /** Why a related article is shown, e.g. "Same launch as …". */
  note?: string;
}

const EVENT_ARTICLES: Record<string, string> = {
  'fengyun-1c-debris': '2007 Chinese anti-satellite missile test',
  'cosmos-2251-debris': '2009 satellite collision',
  'iridium-33-debris': '2009 satellite collision',
  'cosmos-1408-debris': '2021 Russian anti-satellite missile test',
};

const CONSTELLATION_ARTICLES: Record<string, string> = {
  starlink: 'Starlink',
  oneweb: 'OneWeb',
  kuiper: 'Project Kuiper',
  qianfan: 'Qianfan',
  'iridium-NEXT': 'Iridium satellite constellation',
  globalstar: 'Globalstar',
  orbcomm: 'Orbcomm',
  'gps-ops': 'Global Positioning System',
  'glo-ops': 'GLONASS',
  galileo: 'Galileo (satellite navigation)',
  beidou: 'BeiDou',
  planet: 'Planet Labs',
  spire: 'Spire Global',
  swarm: 'Swarm Technologies',
  molniya: 'Molniya (satellite)',
};

// Name prefixes for objects without group tags (e.g. re-entered ones).
const NAME_ARTICLES: [RegExp, string][] = [
  [/^STARLINK\b/, 'Starlink'],
  [/^ONEWEB\b/, 'OneWeb'],
  [/^KUIPER\b/, 'Project Kuiper'],
  [/^IRIDIUM\b/, 'Iridium satellite constellation'],
  [/^GLOBALSTAR\b/, 'Globalstar'],
  [/^ORBCOMM\b/, 'Orbcomm'],
  [/^(NAVSTAR|GPS)\b/, 'Global Positioning System'],
  [/^FLOCK\b/, 'Planet Labs'],
  [/^LEMUR\b/, 'Spire Global'],
];

const memo = new Map<string, Promise<WikiSummary | null>>();
const SESSION_KEY = 'oo.wiki.';

async function getJson(url: string) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** English Wikipedia title of the Wikidata item with this COSPAR ID, if any. */
async function titleForCospar(cospar: string): Promise<string | null> {
  if (!/^\d{4}-\d{3}[A-Z]{1,3}$/.test(cospar)) return null;
  const search = await getJson(
    `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P247=${cospar}`)}&srlimit=1&format=json&origin=*`,
  );
  const q = search?.query?.search?.[0]?.title;
  if (!q) return null;
  const ent = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${q}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`);
  return ent?.entities?.[q]?.sitelinks?.enwiki?.title ?? null;
}

async function summary(title: string): Promise<Omit<WikiSummary, 'relation'> | null> {
  const s = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (!s || s.type === 'disambiguation' || !s.extract) return null;
  return {
    title: s.title,
    extract: s.extract,
    url: s.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    thumb: s.thumbnail ? { src: s.thumbnail.source, width: s.thumbnail.width, height: s.thumbnail.height } : undefined,
  };
}

async function resolve(o: SatObject, cat: Catalog): Promise<WikiSummary | null> {
  // 1. The object itself.
  const own = await titleForCospar(o.cospar).catch(() => null);
  if (own) {
    const s = await summary(own).catch(() => null);
    if (s) return { ...s, relation: 'exact' };
  }
  const groupKeys = o.groups.map((g) => cat.groups[g]?.key).filter(Boolean) as string[];
  // 2. Debris from a known break-up.
  for (const k of groupKeys)
    if (EVENT_ARTICLES[k]) {
      const s = await summary(EVENT_ARTICLES[k]).catch(() => null);
      if (s) return { ...s, relation: 'event', note: 'About the event that created this debris' };
    }
  // 3. Constellation.
  const constTitle = groupKeys.map((k) => CONSTELLATION_ARTICLES[k]).find(Boolean) ?? NAME_ARTICLES.find(([re]) => re.test(o.name))?.[1];
  if (constTitle) {
    const s = await summary(constTitle).catch(() => null);
    if (s) return { ...s, relation: 'constellation', note: 'About the constellation this object belongs to' };
  }
  // 4. The launch's primary payload (rocket bodies, debris, rideshares).
  const m = o.cospar.match(/^(\d{4}-\d{3})([A-Z]+)$/);
  if (m && m[2] !== 'A') {
    const parent = `${m[1]}A`;
    const t = await titleForCospar(parent).catch(() => null);
    if (t) {
      const s = await summary(t).catch(() => null);
      const name = cat.objects.find((x) => x.cospar === parent)?.name;
      if (s) return { ...s, relation: 'launch', note: `From the same launch${name ? ` as ${name}` : ''}` };
    }
  }
  return null;
}

/** Cached lookup (memory + session storage). */
export function wikiFor(o: SatObject, cat: Catalog): Promise<WikiSummary | null> {
  const key = o.cospar || String(o.norad);
  let p = memo.get(key);
  if (p) return p;
  try {
    const hit = sessionStorage.getItem(SESSION_KEY + key);
    if (hit) {
      p = Promise.resolve(JSON.parse(hit));
      memo.set(key, p);
      return p;
    }
  } catch {
    /* storage unavailable */
  }
  p = resolve(o, cat).then((r) => {
    try {
      if (r) sessionStorage.setItem(SESSION_KEY + key, JSON.stringify(r));
    } catch {
      /* storage unavailable */
    }
    return r;
  });
  memo.set(key, p);
  return p;
}
