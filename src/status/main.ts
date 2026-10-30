import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './status.css';

// The pipeline status page: reads data/status.json, written by
// scripts/fetch-data.mjs at the end of each build.

interface Source {
  key: string;
  ok: boolean;
  fresh: boolean;
  reused?: boolean;
  fetchedAt: string | null;
  error?: string;
}
interface Status {
  generated: string;
  durationS: number;
  sample: boolean;
  catalog: { generated: string; source: string; objects: number; byType: Record<string, number>; fromSpaceTrack: number; fromCelestrak: number; oldestEpoch: string };
  files: Record<string, Record<string, number | boolean>>;
  snapshots: { planned: number; available: number; sgp4: number; fetchedThisRun: number; budget: number; spaceTrack: boolean } | null;
  spaceTrack: boolean;
  sources: Source[];
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> | null = null, ...kids: (Node | string | null | undefined | false)[]) => {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
};
const nf = new Intl.NumberFormat('en-US');
const n = (v: number) => nf.format(v);
const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function ago(iso: string | null) {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** The workflow runs at :17 past every sixth hour (UTC). */
function nextRun(from = Date.now()) {
  const d = new Date(from);
  d.setUTCMinutes(17, 0, 0);
  while (d.getTime() <= from || d.getUTCHours() % 6) d.setUTCHours(d.getUTCHours() + 1);
  return d.getTime();
}

const SOURCE_NAMES: [RegExp, string, string][] = [
  [/^gp-active/, 'CelesTrak active satellites', 'Orbital elements of every active satellite'],
  [/^gp-/, 'CelesTrak group', 'Group membership and elements'],
  [/^satcat/, 'CelesTrak SATCAT', 'Type, owner, launch and decay dates, size'],
  [/^spacetrack-gp\./, 'Space-Track full catalogue', 'Every tracked object, including all debris'],
  [/^spacetrack-decayed/, 'Space-Track re-entered objects', 'Final orbits for the history replay (weekly)'],
  [/^spacetrack-decay-pred/, 'Space-Track decay predictions', 'Upcoming re-entries'],
  [/^spacetrack-tip/, 'Space-Track TIP messages', 'Final re-entry predictions'],
  [/^socrates/, 'CelesTrak SOCRATES', 'Close approaches'],
  [/^ll2/, 'Launch Library 2', 'Upcoming launches'],
  [/^qs\.mag/, "McCants' qs.mag", 'Standard magnitudes (monthly)'],
];
const describe = (key: string) => SOURCE_NAMES.find(([re]) => re.test(key)) ?? [null, key, ''];

function state(s: Source) {
  if (!s.ok) return ['bad', 'Failed'];
  if (s.fresh) return ['good', 'Fetched'];
  if (s.reused) return ['good', 'Up to date (cached)'];
  return ['warn', 'Using last good copy'];
}

const TYPES: [string, string, string][] = [
  ['P', 'Payloads', '#3987e5'],
  ['R', 'Rocket bodies', '#d95926'],
  ['D', 'Debris', '#199e70'],
  ['U', 'Unknown', '#7d8394'],
];

function card(title: string, ...kids: (Node | string | null | undefined | false)[]) {
  return h('section', { class: 'card' }, h('h2', null, title), ...kids);
}
const stat = (label: string, value: string, sub?: string) => h('div', { class: 'stat' }, h('b', null, value), h('span', null, label), sub ? h('small', null, sub) : null);

function render(st: Status) {
  const age = (Date.now() - Date.parse(st.generated)) / 3600e3;
  const tone = age < 7 ? 'good' : age < 25 ? 'warn' : 'bad';
  document.getElementById('lede')!.replaceChildren(
    h('i', { class: `dot ${tone}` }),
    `Last build ${ago(st.generated)} (${when.format(Date.parse(st.generated))}), took ${st.durationS} s. `,
    st.sample ? h('b', null, 'This site is running on synthetic sample data. ') : '',
    `Next scheduled run ${when.format(nextRun())}.`,
  );

  const total = st.catalog.objects;
  const bar = h('div', { class: 'bar', role: 'img', 'aria-label': TYPES.map(([k, l]) => `${l}: ${n(st.catalog.byType[k] ?? 0)}`).join(', ') });
  for (const [k, , c] of TYPES) {
    const v = st.catalog.byType[k] ?? 0;
    if (v) bar.append(h('i', { style: `width:${(v / total) * 100}%;background:${c}` }));
  }
  const catalogCard = card(
    'Catalogue',
    h('div', { class: 'stats' }, stat('objects in orbit', n(total)), stat('from CelesTrak', n(st.catalog.fromCelestrak)), stat('only in Space-Track', n(st.catalog.fromSpaceTrack), st.spaceTrack ? '' : 'not configured')),
    bar,
    h('ul', { class: 'legend' }, ...TYPES.map(([k, l, c]) => h('li', null, h('i', { style: `background:${c}` }), `${l} `, h('b', null, n(st.catalog.byType[k] ?? 0))))),
    h('p', { class: 'note' }, `Source: ${st.catalog.source}. Oldest element set: ${st.catalog.oldestEpoch.slice(0, 10)}.`),
  );

  const groups = st.sources.filter((s) => /^gp-/.test(s.key) && !/^gp-active/.test(s.key));
  const main = st.sources.filter((s) => !groups.includes(s));
  const row = (s: Source, name?: string, what?: string) => {
    const [cls, label] = state(s);
    const [, dn, dw] = describe(s.key);
    return h(
      'tr',
      null,
      h('td', null, h('b', null, name ?? dn), h('small', null, what ?? dw)),
      h('td', null, h('i', { class: `dot ${cls}` }), label, s.error && !s.fresh && !s.reused ? h('small', { title: s.error }, s.error) : null),
      h('td', { class: 'num' }, ago(s.fetchedAt)),
    );
  };
  const gOk = groups.filter((g) => g.ok).length;
  const gFresh = groups.filter((g) => g.fresh).length;
  const gOldest = groups.map((g) => g.fetchedAt).filter((x): x is string => !!x).sort()[0] ?? null;
  const sourcesCard = card(
    'Sources',
    h(
      'table',
      null,
      h('thead', null, h('tr', null, h('th', null, 'Source'), h('th', null, 'This run'), h('th', { class: 'num' }, 'Fetched'))),
      h(
        'tbody',
        null,
        ...main.map((s) => row(s)),
        groups.length ? row({ key: 'gp-groups', ok: gOk === groups.length, fresh: gFresh === groups.length, reused: gFresh > 0, fetchedAt: gOldest }, `CelesTrak groups (${groups.length})`, `${gOk} available, ${gFresh} fetched fresh`) : null,
      ),
    ),
    st.spaceTrack ? null : h('p', { class: 'note' }, 'Space-Track is not configured, so debris is limited to CelesTrak’s groups and there are no re-entry predictions or history snapshots. See the README to add credentials.'),
  );

  const sn = st.snapshots;
  const snapCard = card(
    'History backfill',
    sn
      ? h(
          'div',
          null,
          h('div', { class: 'stats' }, stat('snapshots available', `${n(sn.available)} / ${n(sn.planned)}`), stat('with full SGP4 detail', n(sn.sgp4)), stat('fetched this run', n(sn.fetchedThisRun), `budget ${sn.budget}`)),
          h('div', { class: 'progress' }, h('i', { style: `width:${(sn.available / Math.max(1, sn.planned)) * 100}%` })),
          h(
            'p',
            { class: 'note' },
            sn.available >= sn.planned
              ? 'Every planned snapshot is available. New quarters and timeline events are added as they come.'
              : sn.spaceTrack
                ? `${n(sn.planned - sn.available)} still to fetch: about ${Math.ceil((sn.planned - sn.available) / Math.max(1, sn.budget))} more runs (${Math.ceil(((sn.planned - sn.available) / Math.max(1, sn.budget)) * 6)} hours).`
                : 'Snapshots need Space-Track credentials; the backfill is paused.',
          ),
        )
      : h('p', { class: 'note' }, 'No history snapshots in this build.'),
  );

  const f = st.files;
  const fileRow = (name: string, value: string, ok = true) => h('tr', null, h('td', null, name), h('td', { class: 'num' }, h('i', { class: `dot ${ok ? 'good' : 'warn'}` }), value));
  const filesCard = card(
    'What the site shows',
    h(
      'table',
      null,
      h(
        'tbody',
        null,
        fileRow('Predicted re-entries', f.reentry?.predictions ? n(Number(f.reentry.upcoming)) : 'no predictions', !!f.reentry?.predictions),
        fileRow('Close approaches (7 days)', n(Number(f.conjunctions?.items ?? 0)), !!f.conjunctions?.available),
        fileRow('Upcoming launches', n(Number(f.launches?.upcoming ?? 0)), !!f.launches?.available),
        fileRow('Standard magnitudes', f.magnitudes?.available ? n(Number(f.magnitudes.items)) : 'estimated from size', !!f.magnitudes?.available),
        fileRow('Manoeuvres (14 days)', n(Number(f.manoeuvres?.items ?? 0))),
        fileRow('Breakups (180 days)', n(Number(f.breakups?.items ?? 0))),
      ),
    ),
  );

  document.getElementById('cards')!.replaceChildren(catalogCard, sourcesCard, filesCard, snapCard);
  document.getElementById('status')!.removeAttribute('aria-busy');
}

fetch('./data/status.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then(render)
  .catch((err) => {
    document.getElementById('lede')!.textContent = `No status available (${err.message}). The data has not been rebuilt since this page was added.`;
  });
