import type { App } from '../app';
import { TYPE_LABEL, type ObjectType } from '../data/catalog';
import { launchesIn, loadDigest, type Digest, type DigestDay } from '../data/more';
import { fmtDate, fmtInt, h } from './dom';
import type { WatchCtx } from './eclipses';

const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

export function summary(d: DigestDay) {
  const launches = launchesIn(d.added).filter((l) => l.payloads > 0);
  const parts: string[] = [];
  if (d.addedCount) parts.push(`${plural(d.addedCount, 'new object')} catalogued${launches.length ? ` from ${plural(launches.length, 'launch', 'launches')}` : ''}`);
  if (d.reentered.length) parts.push(plural(d.reentered.length, 're-entry', 're-entries'));
  if (d.manoeuvres.length) parts.push(plural(d.manoeuvres.length, 'manoeuvre'));
  if (d.breakups.length) parts.push(plural(d.breakups.length, 'possible breakup'));
  return parts.length ? parts.join(' · ') : 'A quiet day';
}

/** "What's new": each day's changes, from the build-time digest (also an Atom feed). */
export function mountDigest(app: App) {
  let digest: Digest | null = null;
  let loaded = false;
  let openDay: string | null = null;
  const feed = `${import.meta.env.BASE_URL}data/feed.xml`;
  void loadDigest().then((d) => {
    digest = d;
    loaded = true;
    app.emit('watch');
  });

  const show = (ctx: WatchCtx, ids: number[], label: string) => {
    const known = ids.filter((n) => app.cat.byNorad.has(n));
    if (!known.length) return;
    ctx.close();
    app.exitHistory();
    app.select(null);
    app.setFilters({ ids: new Set(known), idsLabel: label });
    if (known.length === 1) app.select(app.cat.byNorad.get(known[0])!, { fly: true });
    else app.flyHome();
  };

  function day(ctx: WatchCtx, d: DigestDay) {
    const isOpen = openDay === d.day;
    const head = h(
      'button',
      { class: 'rw-row digest-day' + (isOpen ? ' open' : ''), 'aria-expanded': String(isOpen), onclick: () => ((openDay = isOpen ? null : d.day), render(ctx)) },
      h('i', { class: 'd', style: 'background:#3987e5;color:#3987e5' }),
      h('span', { class: 't' }, h('b', null, fmtDate(d.day)), h('span', null, summary(d))),
      h('span', { class: 'r' }, h('small', null, isOpen ? 'Hide' : 'Details')),
    );
    if (!isOpen) return head;
    const launches = launchesIn(d.added);
    const block = (title: string, rows: Node[]) => (rows.length ? h('div', { class: 'digest-block' }, h('h4', null, title), ...rows) : null);
    const line = (label: string, meta: string, onClick?: () => void) =>
      h('button', { class: 'digest-line', disabled: !onClick, onclick: onClick }, h('b', null, label), h('small', null, meta));
    return h(
      'div',
      { class: 'digest-open' },
      head,
      block(
        'Newly catalogued',
        launches.slice(0, 12).map((l) => line(l.payloads ? `Launch ${l.key}` : `Pieces from ${l.key}`, `${plural(l.n, 'object')} · ${l.names.join(', ')}${l.n > l.names.length ? ', …' : ''}`, () => show(ctx, l.ids, `New from ${l.key}`))),
      ),
      block(
        'Re-entered',
        d.reentered.slice(0, 20).map((r) => line(r[1], `NORAD ${r[0]}${r[3] ? ` · ${TYPE_LABEL[r[3] as ObjectType] ?? r[3]}` : ''}`, app.cat.byNorad.has(r[0]) ? () => show(ctx, [r[0]], r[1]) : undefined)),
      ),
      block(
        'Manoeuvred',
        d.manoeuvres.slice(0, 20).map((m) => line(m[1], m[3] === 'plane' ? 'plane change' : `${m[3] === 'raise' ? 'raised' : 'lowered'} ${Math.abs(m[4]).toFixed(1)} km`, () => show(ctx, [m[0]], m[1]))),
      ),
      block(
        'Possible breakups',
        d.breakups.map((b) => line(b[1], `${b[0]} · ${plural(b[2], 'new piece')}`, () => show(ctx, app.cat.objects.slice(0, app.liveCount).filter((o) => o.cospar.startsWith(b[0])).map((o) => o.norad), `${b[1]} pieces`))),
      ),
    );
  }

  function render(ctx: WatchCtx) {
    ctx.action.hidden = false;
    ctx.action.textContent = 'Subscribe (Atom feed)';
    ctx.action.onclick = () => window.open(feed, '_blank', 'noopener');
    ctx.foot.replaceChildren('Worked out at each data update (four times a day) by comparing the catalogue with the previous one. ', h('a', { href: feed, target: '_blank', rel: 'noopener' }, 'Atom feed'), ' for your feed reader.');
    if (!digest) {
      ctx.sub.textContent = loaded ? 'The digest is unavailable right now.' : 'Loading…';
      ctx.body.replaceChildren();
      return;
    }
    const d0 = digest.days[0];
    ctx.sub.textContent = `Last ${digest.days.length} days${d0 ? ` · today: ${summary(d0).toLowerCase()}` : ''}${digest.sample ? ' · sample data' : ''}`;
    ctx.body.replaceChildren(...digest.days.map((d) => day(ctx, d)));
  }

  const openOn = (dayIso: string) => {
    openDay = dayIso;
    app.openWatch('digest');
  };
  // Links from the feed: #digest=YYYY-MM-DD
  const fromHash = () => {
    const m = /(?:^#|&)digest=(\d{4}-\d\d-\d\d)/.exec(location.hash);
    if (m) openOn(m[1]);
  };
  window.addEventListener('hashchange', fromHash);
  setTimeout(fromHash, 800);

  return { render, count: () => (digest?.days[0]?.addedCount ?? 0) + (digest?.days[0]?.reentered.length ?? 0) };
}
