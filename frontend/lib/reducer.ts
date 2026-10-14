// The console's only state. Counts are never computed here: they arrive in `state` messages
// from the bridge, which owns the truth. `event` messages feed the log and the motion.
import type { Event, Link, State } from './types';

export const MAX_EVENTS = 50;
export const PAUSE_AFTER_MS = 3000;
export const HEARTBEAT_STALE_S = 15;

export interface ConsoleState {
  server: State | null;
  /** Current run only, newest first, at most MAX_EVENTS. */
  events: Event[];
  /** When `server.link` arrived, so ages can keep counting between link messages. */
  linkAt: number | null;
  /** When the live stream dropped; null while it is up. */
  downSince: number | null;
  backendUnreachable: boolean;
  /** The newest event that arrived live. Drives the one orchestrated moment. */
  latest: { event: Event; at: number } | null;
}

export type Action =
  | { type: 'state'; state: State; at: number }
  | { type: 'event'; event: Event; at: number }
  | { type: 'link'; link: Link; at: number }
  | { type: 'events-loaded'; runId: number; events: Event[] }
  | { type: 'stream-open'; at: number }
  | { type: 'stream-down'; at: number }
  | { type: 'backend-unreachable' };

export const initialState: ConsoleState = {
  server: null,
  events: [],
  linkAt: null,
  downSince: null,
  backendUnreachable: false,
  latest: null,
};

function merge(existing: Event[], incoming: Event[]): Event[] {
  const byId = new Map<number, Event>();
  for (const event of existing) byId.set(event.id, event);
  for (const event of incoming) if (!byId.has(event.id)) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, MAX_EVENTS);
}

export function reducer(state: ConsoleState, action: Action): ConsoleState {
  switch (action.type) {
    case 'state': {
      const next = action.state;
      const sameRun = state.server !== null && state.server.run.id === next.run.id;
      // A different run id means a reset (or a source switch): the old log no longer applies.
      let events = sameRun ? state.events : [];
      if (next.last_event !== null) events = merge(events, [next.last_event]);
      return {
        ...state,
        server: next,
        events,
        linkAt: action.at,
        latest: sameRun ? state.latest : null,
      };
    }
    case 'event': {
      const { event } = action;
      if (state.server !== null && event.run_id !== state.server.run.id) return state;
      if (state.events.some((e) => e.id === event.id)) return state;
      const newest = state.events[0];
      const isNewest = newest === undefined || event.id > newest.id;
      return {
        ...state,
        events: merge(state.events, [event]),
        latest: isNewest ? { event, at: action.at } : state.latest,
      };
    }
    case 'link':
      if (state.server === null) return state;
      return { ...state, server: { ...state.server, link: action.link }, linkAt: action.at };
    case 'events-loaded':
      if (state.server !== null && action.runId !== state.server.run.id) return state;
      return { ...state, events: merge(state.events, action.events) };
    case 'stream-open':
      return { ...state, downSince: null, backendUnreachable: false };
    case 'stream-down':
      return { ...state, downSince: state.downSince ?? action.at };
    case 'backend-unreachable':
      return { ...state, backendUnreachable: true };
  }
}

// -- derived values ----------------------------------------------------------------------

export function isPaused(state: ConsoleState, now: number): boolean {
  return state.downSince !== null && now - state.downSince > PAUSE_AFTER_MS;
}

function extrapolate(ageS: number | null, linkAt: number | null, now: number): number | null {
  if (ageS === null || linkAt === null) return null;
  return ageS + Math.max(0, now - linkAt) / 1000;
}

export function heartbeatAge(state: ConsoleState, now: number): number | null {
  return extrapolate(state.server?.link.last_heartbeat_age_s ?? null, state.linkAt, now);
}

export function lastLineAge(state: ConsoleState, now: number): number | null {
  return extrapolate(state.server?.link.last_line_age_s ?? null, state.linkAt, now);
}

export type LinkLabel = 'open' | 'closed' | 'stale';

/** An open port is not proof of a live Nano: only heartbeats are. */
export function linkLabel(state: ConsoleState, now: number): LinkLabel {
  const link = state.server?.link;
  if (!link?.source_open) return 'closed';
  const hb = heartbeatAge(state, now);
  return hb !== null && hb > HEARTBEAT_STALE_S ? 'stale' : 'open';
}

/** A port that exists but would not open is busy; no port at all means no Nano found. */
export function portBusy(link: Link): boolean {
  return !link.source_open && link.port !== null;
}
