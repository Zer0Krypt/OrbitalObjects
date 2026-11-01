import type { App, Settings } from '../app';
import type { SatObject } from '../data/catalog';
import { NAKED_EYE_MAG } from '../sim/brightness';
import { alertPasses, downloadIcs, type PassEvent } from './alerts';
import { channelCount, channelsPanel } from './channels';
import { $, h, icon, ICONS } from './dom';
import { pushConfigured } from './push';
import { twilightName } from './rising';
import { testSound } from './sound';

/**
 * The Alerts menu (bell in the top bar, or A): everything that makes a sound
 * or tells you something, in one place.
 *  - Sound: on/off, volume, which sounds, a test.
 *  - Rising satellites: a chime, pop-up or notification when satellites climb
 *    past an elevation, optionally only once the Sun is far enough down.
 *  - Pass alerts: which passes, how early, the objects you have them on.
 *  - Notifications: the browser's permission, and a test.
 *  - When the site is closed: background push, ntfy, Discord, Slack, calendar.
 */

export type AlertsSection = 'sound' | 'rising' | 'passes' | 'notify' | 'closed';
let opener: ((section?: AlertsSection) => void) | null = null;
/** Open the Alerts menu (at a section). */
export const openAlertsMenu = (section?: AlertsSection) => opener?.(section);

type Key = keyof Settings;
const BELL = '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>';

export function mountAlertsMenu(app: App) {
  const menu = $('#alerts-menu');
  const btn = $('#btn-alerts');
  const syncers: (() => void)[] = [];
  const sync = () => syncers.forEach((f) => f());

  // ---------- small controls ----------
  const toggle = (k: Key, label: string, tip: string, extra?: () => void) => {
    const b = h('button', { class: 'toggle', role: 'switch', title: tip, onclick: () => (app.setSetting(k, !app.settings[k] as never), extra?.()) }, h('span', null, label), h('span', { class: 'sw' }));
    syncers.push(() => b.setAttribute('aria-checked', String(!!app.settings[k])));
    return b;
  };
  const range = (k: Key, label: string, min: number, max: number, step: number, show: (v: number) => string, tip: string) => {
    const val = h('span', { class: 'mono am-val' });
    const input = h('input', { type: 'range', min, max, step, 'aria-label': label, title: tip });
    input.addEventListener('input', () => {
      app.setSetting(k, Number(input.value) as never);
      val.textContent = show(Number(input.value));
    });
    syncers.push(() => {
      const v = Number(app.settings[k]);
      if (document.activeElement !== input) input.value = String(v);
      val.textContent = show(v);
    });
    return h('label', { class: 'am-range', title: tip }, h('span', null, label), input, val);
  };
  const select = (k: Key, label: string, options: [string, string][], tip: string) => {
    const sel = h(
      'select',
      { class: 'sky-select', 'aria-label': label, title: tip, onchange: () => app.setSetting(k, (/^\d+$/.test(sel.value) ? Number(sel.value) : sel.value) as never) },
      ...options.map(([v, l]) => h('option', { value: v }, l)),
    );
    syncers.push(() => (sel.value = String(app.settings[k])));
    return h('label', { class: 'toggle menu-select', title: tip }, h('span', null, label), sel);
  };
  const section = (id: AlertsSection, title: string, intro: string, ...body: (Node | null)[]) =>
    h('section', { class: 'am-sec', 'data-sec': id }, h('div', { class: 'menu-label' }, title), intro ? h('p', { class: 'am-intro' }, intro) : null, ...body);
  /** Show `el` only when `when()` is true. */
  const showIf = <T extends HTMLElement>(el: T, when: () => boolean) => {
    syncers.push(() => (el.hidden = !when()));
    return el;
  };
  /** Dim and disable a group while `when()` is false. */
  const enableIf = <T extends HTMLElement>(el: T, when: () => boolean) => {
    // Inner groups are built first; running outer groups first lets the inner ones have the last word.
    syncers.unshift(() => {
      const on = when();
      el.classList.toggle('am-off', !on);
      el.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select').forEach((c) => (c.disabled = !on));
    });
    return el;
  };
  const needLocation = () =>
    showIf(
      h(
        'p',
        { class: 'am-note' },
        'These need your location. ',
        h(
          'button',
          {
            class: 'link',
            onclick: () => {
              setOpen(false);
              document.body.classList.add('explorer-open');
              const sec = document.getElementById('sky-section');
              sec?.classList.remove('collapsed');
              sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            },
          },
          'Set my location ›',
        ),
      ),
      () => !app.observer,
    );

  // ---------- sound ----------
  const soundSub = enableIf(
    h(
      'div',
      { class: 'am-group' },
      range('volume', 'Volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, 'How loud the site’s sounds are'),
      toggle('soundAlerts', 'Chime with each alert', 'Play two rising notes whenever an alert pops up (pass alerts and rise alerts)'),
      toggle('soundSputnik', 'Sputnik’s beep in the 1957 replay', 'While the history replay is in October 1957, play the beep-beep of the first satellite’s radio'),
      h('div', { class: 'sky-actions' }, h('button', { class: 'btn', title: 'Play the rise chime (west, then east) and the alert chime', onclick: () => testSound() }, 'Test sound')),
    ),
    () => app.settings.sound,
  );
  const soundSec = section(
    'sound',
    'Sound',
    'Everything is silent unless this is on. Browsers only allow sound after you click or press a key on the page.',
    toggle('sound', 'Sound', 'Turn all of the site’s sounds on or off'),
    soundSub,
  );

  // ---------- rising satellites ----------
  const riseHow = h(
    'div',
    { class: 'am-chips', role: 'group', 'aria-label': 'How to tell me' },
    ...(
      [
        ['riseChime', 'Chime', 'A soft bell: lower and louder for brighter satellites, from the left or right speaker by direction. Needs Sound on.'],
        ['riseToast', 'Pop-up', 'A note in the corner of the page, with a button to show the satellite. Only at live time, at most one every 20 seconds.'],
        ['riseNotify', 'Notification', 'A system notification while this tab is in the background (needs notification permission)'],
      ] as [Key, string, string][]
    ).map(([k, l, tip]) => {
      const b = h(
        'button',
        {
          class: 'chip',
          title: tip,
          onclick: () => {
            app.setSetting(k, !app.settings[k] as never);
            if (k === 'riseNotify' && app.settings.riseNotify) void app.alerts?.requestPermission().then(sync);
          },
        },
        l,
      );
      syncers.push(() => b.setAttribute('aria-pressed', String(!!app.settings[k])));
      return b;
    }),
  );
  const riseChimeWarn = showIf(h('p', { class: 'am-note' }, 'Chimes need Sound on (above).'), () => app.settings.riseOn && app.settings.riseChime && !app.settings.sound);
  const riseSub = enableIf(
    h(
      'div',
      { class: 'am-group' },
      select(
        'riseWhich',
        'Which satellites',
        [
          ['bright', 'Bright ones I could see'],
          ['mine', 'My satellites'],
          ['alerted', 'Ones with pass alerts on'],
          ['any', 'Anything (very many)'],
        ],
        'Which objects count. “Bright ones” means sunlit and brighter than the limit below; “Anything” is every tracked object, including debris you can’t see, and fires very often.',
      ),
      showIf(
        range('riseMag', 'Brighter than', 0, 6, 0.5, (v) => `mag ${v.toFixed(1)}`, `Smaller magnitudes are brighter. Venus is about −4, the brightest stars 0–1, and the faintest you can see from your sky about ${NAKED_EYE_MAG}.`),
        () => app.settings.riseWhich === 'bright',
      ),
      showIf(
        toggle('riseSunlit', 'Only when sunlit', 'Skip objects in Earth’s shadow, which can’t be seen (turn off for radio listening)'),
        () => app.settings.riseWhich !== 'bright',
      ),
      range('riseEl', 'Rises above', 0, 60, 1, (v) => `${v}°`, 'The elevation it has to climb past. 0° is the horizon; 10° clears most trees and buildings; 90° would be straight overhead.'),
      toggle('riseDark', 'Only when the sky is dark', 'Only while the Sun is at least the angle below under your horizon'),
      enableIf(
        range(
          'riseSunBelow',
          'Sun below horizon by',
          0,
          18,
          1,
          (v) => `${v}°`,
          'How far below your horizon the Sun must be. 0°: any time after sunset. 6°: end of civil twilight, bright satellites show. 12°: nautical twilight. 18°: fully dark (astronomical).',
        ),
        () => app.settings.riseOn && app.settings.riseDark,
      ),
      h('div', { class: 'am-row' }, h('span', null, 'Tell me with'), riseHow),
      riseChimeWarn,
    ),
    () => app.settings.riseOn,
  );
  const riseSummary = h('p', { class: 'am-summary' });
  syncers.push(() => {
    const s = app.settings;
    if (!s.riseOn) {
      riseSummary.textContent = 'Off.';
      return;
    }
    const which = { bright: `bright satellites (magnitude ${s.riseMag} or brighter)`, mine: 'My satellites', alerted: 'satellites with pass alerts on', any: 'any tracked object' }[s.riseWhich];
    const how = [s.riseChime && 'a chime', s.riseToast && 'a pop-up', s.riseNotify && 'a notification'].filter(Boolean).join(', ') || 'nothing (choose below)';
    riseSummary.textContent = `When ${which} climb past ${s.riseEl}°${s.riseDark ? `, with the Sun ${s.riseSunBelow}° or more below the horizon (${twilightName(s.riseSunBelow)})` : ', at any time of day'}: ${how}.`;
  });
  const riseSec = section(
    'rising',
    'Rising satellites',
    'Hear or see when satellites come up over your horizon, from where you are.',
    needLocation(),
    toggle('riseOn', 'Tell me when satellites rise', 'Turn rise alerts on or off'),
    riseSummary,
    riseSub,
  );

  // ---------- pass alerts ----------
  const alertList = h('div', { class: 'am-list' });
  const calAll = h('button', { class: 'btn', title: 'Download a calendar file of the next week’s alerted passes of all of these' }, 'Add all to calendar');
  calAll.onclick = () => {
    if (!app.observer) return;
    const events: PassEvent[] = [];
    for (const o of alertObjects()) for (const p of alertPasses(app, o, Date.now(), 7)) events.push({ o, p });
    if (!events.length) {
      calAll.textContent = 'No passes in the next week';
      return;
    }
    downloadIcs(events.sort((a, b) => a.p.rise - b.p.rise), app.observer, 'satellite-passes.ics');
  };
  const timeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  function alertObjects(): SatObject[] {
    return (app.alerts?.list ?? []).map((n) => app.cat.byNorad.get(n)).filter((o): o is SatObject => !!o);
  }
  function renderList() {
    const objs = alertObjects();
    calAll.hidden = !objs.length || !app.observer;
    if (!objs.length) {
      alertList.replaceChildren(
        h('p', { class: 'am-note' }, 'No pass alerts yet. Select a satellite and press ', h('b', null, 'Alert me'), ' (in its details, under From your location), or ', h('b', null, 'Alert all'), ' in My satellites.'),
      );
      return;
    }
    alertList.replaceChildren(
      ...objs.map((o) => {
        const next = app.alerts?.nextPass(o.norad);
        return h(
          'div',
          { class: 'am-item' },
          h(
            'button',
            { class: 'am-item-main', title: 'Show it on the globe', onclick: () => (setOpen(false), app.select(o, { fly: true })) },
            h('b', null, o.name),
            h('small', null, !app.observer ? '' : next ? `Next: ${timeFmt.format(next.rise)} · ${Math.round(next.maxEl)}° high` : 'No matching pass in the next 2 days'),
          ),
          h('button', { class: 'icon-mini', title: 'Stop alerts for this one', 'aria-label': `Stop alerts for ${o.name}`, onclick: () => app.alerts?.toggle(o) }, icon(ICONS.close)),
        );
      }),
    );
  }
  app.alerts?.onChange(() => !menu.hidden && renderList());
  const passSec = section(
    'passes',
    'Pass alerts',
    'A warning before chosen satellites pass over you, as a pop-up while this page is open (and on the services below while it is closed).',
    needLocation(),
    select(
      'passLead',
      'Warn me',
      [1, 2, 5, 10, 15, 30].map((m) => [String(m), `${m} min before`] as [string, string]),
      'How long before the satellite rises above your horizon the alert comes',
    ),
    toggle('passVisible', 'Only passes I could see', 'Only passes where it is sunlit against a dark sky and bright enough to see. Turn off to be told about every pass, day or night (for radio).'),
    range('passMinEl', 'Only passes higher than', 0, 60, 5, (v) => (v ? `${v}°` : 'any'), 'Skip low passes that never climb above this elevation (low ones are hard to see over trees and buildings)'),
    toggle('passNotify', 'System notification in the background', 'When this tab isn’t showing, alert with a system notification instead of a pop-up (needs permission, below)', () => {
      if (app.settings.passNotify) void app.alerts?.requestPermission().then(sync);
    }),
    h('div', { class: 'menu-label am-sub' }, 'Alerts on'),
    alertList,
    h('div', { class: 'sky-actions' }, calAll),
  );

  // ---------- notifications ----------
  const permText = h('p', { class: 'am-summary' });
  const permBtn = h('button', { class: 'btn', title: 'Ask the browser to let this site show notifications' }, 'Allow notifications');
  const testBtn = h('button', { class: 'btn', title: 'Show a test alert now (a system notification if allowed, with the alert chime if Sound is on)' }, 'Send a test alert');
  permBtn.onclick = async () => {
    await app.alerts?.requestPermission();
    sync();
  };
  testBtn.onclick = () => {
    const a = app.alerts;
    if (!a) return;
    let sys = false;
    if (a.permission === 'granted') {
      try {
        new Notification('Orbital Objects test alert', { body: 'Notifications work. Pass and rise alerts will look like this.', tag: 'test', icon: `${import.meta.env.BASE_URL}favicon.svg` });
        sys = true;
      } catch {
        /* some mobile browsers only allow notifications from the service worker */
      }
    }
    a.alert(
      sys ? 'Test alert sent' : 'Test alert',
      sys
        ? 'Look for a system notification too. If none appears, check your system’s notification settings and Do Not Disturb.'
        : 'This is how an alert looks while the page is open. Allow notifications to get them while the tab is in the background too.',
      'test',
      false,
    );
  };
  syncers.push(() => {
    const p = app.alerts?.permission ?? 'unsupported';
    permText.textContent = {
      granted: 'Allowed: alerts can show as system notifications while this tab is in the background.',
      denied: 'Blocked for this site. To change it, use the padlock or site settings next to the address bar, then reload.',
      default: 'Not asked yet. Without permission, alerts only appear as pop-ups inside this page.',
      unsupported: 'This browser can’t show notifications. On iPhone and iPad, add the site to your Home Screen first.',
    }[p];
    permBtn.hidden = p !== 'default';
  });
  const notifySec = section('notify', 'Browser notifications', '', permText, h('div', { class: 'sky-actions' }, permBtn, testBtn));

  // ---------- when the site is closed ----------
  const bgBtn = toggleButton('Push notifications to this device', 'Get pass alerts even when the site is closed, through a small push service that stores your alert times and texts until they’re sent');
  const bgNote = h('p', { class: 'am-summary' });
  bgBtn.onclick = () => void (app.background?.enabled ? app.background.disable() : app.background?.enable());
  const syncBg = () => {
    bgBtn.setAttribute('aria-checked', String(!!app.background?.enabled));
    bgNote.textContent = app.background?.status || (app.background?.enabled ? 'On: alerts arrive even when the site is closed.' : 'Off.');
  };
  app.background?.onChange(() => (syncBg(), syncBadge()));
  syncers.push(syncBg);
  const closedSec = section(
    'closed',
    'When the site is closed',
    'Pass alerts can also reach you with the site closed: on this device, on your phone through ntfy, in a Discord or Slack channel, or in your calendar.',
    pushConfigured() ? h('div', null, bgBtn, bgNote) : h('p', { class: 'am-note' }, 'Push notifications to this device aren’t set up on this copy of the site.'),
    h('div', { class: 'menu-label am-sub' }, 'Webhooks and feeds'),
    channelsPanel(app),
  );

  function toggleButton(label: string, tip: string) {
    return h('button', { class: 'toggle', role: 'switch', title: tip }, h('span', null, label), h('span', { class: 'sw' }));
  }

  menu.append(
    h('div', { class: 'am-head' }, h('b', null, 'Alerts & sound'), h('button', { class: 'icon-mini', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => setOpen(false) }, icon(ICONS.close))),
    soundSec,
    h('div', { class: 'menu-sep' }),
    riseSec,
    h('div', { class: 'menu-sep' }),
    passSec,
    h('div', { class: 'menu-sep' }),
    notifySec,
    h('div', { class: 'menu-sep' }),
    closedSec,
  );

  // ---------- the button ----------
  btn.replaceChildren(icon(BELL), h('span', null, 'Alerts'), h('i', { class: 'on-dot', hidden: true }));
  function syncBadge() {
    const s = app.settings;
    const on = s.riseOn || !!app.alerts?.list.length || !!app.background?.enabled || channelCount() > 0;
    (btn.querySelector('.on-dot') as HTMLElement).hidden = !on;
    btn.title = `Alerts & sound (A)${on ? ': some alerts are on' : ''}${s.sound ? '' : ' · sound off'}`;
  }
  app.on('settings', () => {
    syncBadge();
    if (!menu.hidden) sync();
  });
  app.on('observer', () => !menu.hidden && (sync(), renderList()));
  app.alerts?.onChange(syncBadge);
  syncBadge();

  function setOpen(o: boolean, sec?: AlertsSection) {
    menu.hidden = !o;
    btn.setAttribute('aria-pressed', String(o));
    document.body.classList.toggle('alerts-open', o);
    if (!o) return;
    $('#layers-menu').hidden = true;
    $('#btn-layers').setAttribute('aria-pressed', 'false');
    sync();
    renderList();
    if (sec) menu.querySelector(`[data-sec="${sec}"]`)?.scrollIntoView({ block: 'start' });
  }
  opener = (sec) => setOpen(true, sec);
  btn.onclick = (e) => {
    e.stopPropagation();
    setOpen(!!menu.hidden);
  };
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) setOpen(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'a' || e.key === 'A') setOpen(!!menu.hidden);
    if (e.key === 'Escape' && !menu.hidden) setOpen(false);
  });
}
