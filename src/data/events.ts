import type { SatObject } from './catalog';
import eventsJson from './events.json';

// Milestones on the history timeline (data in events.json). `launches` are
// international designator prefixes (YYYY-NNN) matching every piece from that
// launch; `groups` are CelesTrak group keys (used for debris clouds); `focus`
// is the COSPAR ID of the object to select.

export type EventKind = 'milestone' | 'station' | 'constellation' | 'debris' | 'reentry';

export interface SpaceEvent {
  at: string; // ISO UTC instant
  title: string;
  text: string;
  kind: EventKind;
  launches?: string[];
  groups?: string[];
  focus?: string;
  /** Two NORAD IDs to show as an encounter (e.g. a collision). */
  pair?: [number, number];
}

// Shared with the data pipeline, which takes a snapshot at each event's viewing moment.
export const EVENTS = eventsJson as SpaceEvent[];

export const eventTime = (e: SpaceEvent) => Date.parse(e.at);

/** Add events found at runtime (e.g. detected breakups), keeping the list in time order. */
export function addEvents(list: SpaceEvent[]) {
  const have = new Set(EVENTS.map((e) => e.title + e.at));
  for (const e of list) if (!have.has(e.title + e.at)) EVENTS.push(e);
  EVENTS.sort((a, b) => eventTime(a) - eventTime(b));
}

/**
 * When an event is viewed (mirrors eventViewTime() in scripts/snapshots.mjs):
 * re-entries a day before, encounters five minutes before, debris events
 * shortly after, launches once the object has had two days to settle.
 */
export function eventView(e: SpaceEvent) {
  const t = eventTime(e);
  if (e.kind === 'reentry') return t - 86400e3;
  if (e.pair) return t - 5 * 60e3;
  if (e.kind === 'debris') return t + 2 * 3600e3;
  return t + 2 * 86400e3;
}

/** Objects involved in an event (by launch designator or group). */
export function eventObjects(e: SpaceEvent, objects: SatObject[], groupIndex: (key: string) => number) {
  const groups = new Set((e.groups ?? []).map(groupIndex).filter((i) => i >= 0));
  const prefixes = e.launches ?? [];
  return objects.filter((o) => prefixes.some((p) => o.cospar.startsWith(p)) || o.groups.some((g) => groups.has(g)));
}

export const EVENT_COLORS: Record<EventKind, string> = {
  milestone: '#cde2fb',
  station: '#7fe07f',
  constellation: '#9085e9',
  debris: '#ff6b5b',
  reentry: '#fab219',
};
