import type { SatObject } from './catalog';

// Milestones on the history timeline. `launches` are international
// designator prefixes (YYYY-NNN) matching every piece from that launch;
// `groups` are CelesTrak group keys (used for debris clouds); `focus` is the
// COSPAR ID of the object to select.

export type EventKind = 'milestone' | 'station' | 'constellation' | 'debris' | 'reentry';

export interface SpaceEvent {
  date: string; // YYYY-MM-DD (UTC)
  title: string;
  text: string;
  kind: EventKind;
  launches?: string[];
  groups?: string[];
  focus?: string;
}

export const EVENTS: SpaceEvent[] = [
  { date: '1957-10-04', title: 'Sputnik 1', text: 'The first artificial satellite. Its radio beeps were heard around the world for three weeks.', kind: 'milestone', launches: ['1957-001'], focus: '1957-001B' },
  { date: '1957-11-03', title: 'Sputnik 2', text: 'Carried Laika, the first animal to orbit Earth.', kind: 'milestone', launches: ['1957-002'], focus: '1957-002A' },
  { date: '1958-02-01', title: 'Explorer 1', text: 'The first US satellite; its instruments discovered the Van Allen radiation belts.', kind: 'milestone', launches: ['1958-001'], focus: '1958-001A' },
  { date: '1958-03-17', title: 'Vanguard 1', text: 'The oldest human-made object still in orbit.', kind: 'milestone', launches: ['1958-002'], focus: '1958-002B' },
  { date: '1961-04-12', title: 'Vostok 1', text: 'Yuri Gagarin becomes the first human in space and in orbit.', kind: 'milestone', launches: ['1961-012'], focus: '1961-012A' },
  { date: '1962-07-10', title: 'Telstar 1', text: 'The first active communications satellite to relay television across the Atlantic.', kind: 'milestone', launches: ['1962-029'], focus: '1962-029A' },
  { date: '1963-07-26', title: 'Syncom 2', text: 'The first satellite in a geosynchronous orbit.', kind: 'milestone', launches: ['1963-031'], focus: '1963-031A' },
  { date: '1965-04-06', title: 'Intelsat I "Early Bird"', text: 'The first commercial communications satellite in geosynchronous orbit.', kind: 'milestone', launches: ['1965-028'], focus: '1965-028A' },
  { date: '1971-04-19', title: 'Salyut 1', text: 'The first space station.', kind: 'station', launches: ['1971-032'], focus: '1971-032A' },
  { date: '1973-05-14', title: 'Skylab', text: "The first US space station, home to three crews in 1973–74.", kind: 'station', launches: ['1973-027'], focus: '1973-027A' },
  { date: '1978-02-22', title: 'First GPS satellite', text: 'Navstar 1 begins the Global Positioning System.', kind: 'constellation', launches: ['1978-020'], focus: '1978-020A' },
  { date: '1979-07-11', title: 'Skylab re-enters', text: 'Skylab falls back to Earth, scattering debris over Western Australia.', kind: 'reentry', launches: ['1973-027'], focus: '1973-027A' },
  { date: '1986-02-19', title: 'Mir', text: 'The core module of Mir, the first modular space station, reaches orbit.', kind: 'station', launches: ['1986-017'], focus: '1986-017A' },
  { date: '1990-04-24', title: 'Hubble Space Telescope', text: 'Deployed from the Space Shuttle Discovery.', kind: 'milestone', launches: ['1990-037'], focus: '1990-037B' },
  { date: '1998-11-20', title: 'ISS: Zarya', text: 'The first module of the International Space Station is launched.', kind: 'station', launches: ['1998-067'], focus: '1998-067A' },
  { date: '2001-03-23', title: 'Mir de-orbited', text: 'After 15 years in orbit, Mir is guided into the South Pacific.', kind: 'reentry', launches: ['1986-017'], focus: '1986-017A' },
  { date: '2007-01-11', title: 'Fengyun-1C anti-satellite test', text: 'China destroys its own weather satellite with a missile, creating the largest debris cloud on record.', kind: 'debris', launches: ['1999-025'], groups: ['fengyun-1c-debris'], focus: '1999-025A' },
  { date: '2009-02-10', title: 'Iridium 33 – Cosmos 2251 collision', text: 'The first accidental hypervelocity collision between two intact satellites.', kind: 'debris', launches: ['1997-051', '1993-036'], groups: ['iridium-33-debris', 'cosmos-2251-debris'] },
  { date: '2019-02-27', title: 'First OneWeb satellites', text: 'The first six satellites of the OneWeb broadband constellation.', kind: 'constellation', launches: ['2019-010'] },
  { date: '2019-05-24', title: 'First Starlink batch', text: "60 satellites begin SpaceX's mega-constellation — now the majority of active satellites.", kind: 'constellation', launches: ['2019-029'] },
  { date: '2021-04-29', title: 'Tiangong: Tianhe', text: "The core module of China's space station.", kind: 'station', launches: ['2021-035'], focus: '2021-035A' },
  { date: '2021-11-15', title: 'Cosmos 1408 anti-satellite test', text: 'Russia destroys a defunct satellite, forcing the ISS crew to shelter.', kind: 'debris', launches: ['1982-092'], groups: ['cosmos-1408-debris'], focus: '1982-092A' },
];

export const eventTime = (e: SpaceEvent) => Date.parse(e.date + 'T00:00:00Z');

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
