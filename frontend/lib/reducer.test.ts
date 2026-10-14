import { describe, expect, it } from 'vitest';

import {
  type ConsoleState,
  MAX_EVENTS,
  heartbeatAge,
  initialState,
  isPaused,
  linkLabel,
  portBusy,
  reducer,
} from './reducer';
import type { Event, Link, State } from './types';

const link = (over: Partial<Link> = {}): Link => ({
  source_open: true,
  port: null,
  last_line_age_s: 1,
  last_heartbeat_age_s: 1,
  nano_resets_seen: 0,
  dropped_lines: 0,
  ignored_background: 0,
  bin_mismatch: 0,
  frames_received: 0,
  frame_crc_errors: 0,
  preview_active: false,
  preview_fps: null,
  ...over,
});

const event = (id: number, over: Partial<Event> = {}): Event => ({
  id,
  run_id: 1,
  ts: '2026-10-14T12:00:00.000Z',
  label: 'can',
  confidence: 0.9,
  bin: 'recyclable',
  latency_ms: 410,
  has_frame: true,
  source: 'sim',
  ...over,
});

const serverState = (over: Partial<State> = {}): State => ({
  run: { id: 1, started_at: '2026-10-14T12:00:00.000Z', source: 'sim' },
  counts: { recyclable: 0, trash: 0, unsure: 0, total_sorted: 0, recycle_rate: null },
  by_item: [],
  last_event: null,
  link: link(),
  ...over,
});

const withState = (state: State = serverState()): ConsoleState =>
  reducer(initialState, { type: 'state', state, at: 0 });

describe('events', () => {
  it('keeps the log newest first whatever order events arrive in', () => {
    let s = withState();
    for (const id of [2, 5, 3, 1, 4]) s = reducer(s, { type: 'event', event: event(id), at: id });
    expect(s.events.map((e) => e.id)).toEqual([5, 4, 3, 2, 1]);
  });

  it('ignores an event id it has already seen', () => {
    let s = withState();
    s = reducer(s, { type: 'event', event: event(7), at: 1 });
    const again = reducer(s, { type: 'event', event: event(7, { label: 'pen' }), at: 2 });
    expect(again).toBe(s);
    expect(again.events).toHaveLength(1);
  });

  it('ignores events from another run', () => {
    const s = withState();
    expect(reducer(s, { type: 'event', event: event(9, { run_id: 2 }), at: 1 })).toBe(s);
  });

  it('keeps at most MAX_EVENTS', () => {
    let s = withState();
    for (let id = 1; id <= MAX_EVENTS + 10; id++) {
      s = reducer(s, { type: 'event', event: event(id), at: id });
    }
    expect(s.events).toHaveLength(MAX_EVENTS);
    expect(s.events[0]?.id).toBe(MAX_EVENTS + 10);
  });

  it('marks only a newer event as the latest, not a late replay of an older one', () => {
    let s = withState();
    s = reducer(s, { type: 'event', event: event(10), at: 1 });
    s = reducer(s, { type: 'event', event: event(8), at: 2 });
    expect(s.latest?.event.id).toBe(10);
  });

  it('merges a fetched page with live events without duplicates', () => {
    let s = withState();
    s = reducer(s, { type: 'event', event: event(6), at: 1 });
    s = reducer(s, { type: 'events-loaded', runId: 1, events: [event(6), event(5), event(4)] });
    expect(s.events.map((e) => e.id)).toEqual([6, 5, 4]);
  });

  it('never changes counts on an event; only state messages carry counts', () => {
    let s = withState();
    s = reducer(s, { type: 'event', event: event(1), at: 1 });
    expect(s.server?.counts.recyclable).toBe(0);
  });
});

describe('state', () => {
  it('replaces counts with what the server sends', () => {
    let s = withState();
    const counts = { recyclable: 3, trash: 1, unsure: 1, total_sorted: 4, recycle_rate: 0.75 };
    s = reducer(s, { type: 'state', state: serverState({ counts }), at: 5 });
    expect(s.server?.counts).toEqual(counts);
  });

  it('a new run id replaces the state and clears the old log', () => {
    let s = withState();
    s = reducer(s, { type: 'event', event: event(1), at: 1 });
    s = reducer(s, { type: 'event', event: event(2), at: 2 });
    const fresh = serverState({
      run: { id: 2, started_at: '2026-10-14T13:00:00.000Z', source: 'sim' },
    });
    s = reducer(s, { type: 'state', state: fresh, at: 3 });
    expect(s.server?.run.id).toBe(2);
    expect(s.events).toEqual([]);
    expect(s.latest).toBeNull();
  });

  it('a page fetched for the old run is dropped after a reset', () => {
    let s = withState(serverState({ run: { id: 2, started_at: 'x', source: 'sim' } }));
    s = reducer(s, { type: 'events-loaded', runId: 1, events: [event(1)] });
    expect(s.events).toEqual([]);
  });

  it('folds last_event into the log so a reconnect never loses the newest item', () => {
    const s = withState(serverState({ last_event: event(12) }));
    expect(s.events.map((e) => e.id)).toEqual([12]);
  });
});

describe('stream health', () => {
  it('is paused only after the stream has been down for more than 3 seconds', () => {
    let s = withState();
    s = reducer(s, { type: 'stream-down', at: 10_000 });
    expect(isPaused(s, 12_999)).toBe(false);
    expect(isPaused(s, 13_001)).toBe(true);
    s = reducer(s, { type: 'stream-down', at: 12_000 }); // a second error keeps the first time
    expect(isPaused(s, 13_001)).toBe(true);
    s = reducer(s, { type: 'stream-open', at: 14_000 });
    expect(isPaused(s, 20_000)).toBe(false);
  });

  it('keeps ageing the heartbeat between link messages', () => {
    let s = withState();
    s = reducer(s, { type: 'link', link: link({ last_heartbeat_age_s: 2 }), at: 1000 });
    expect(heartbeatAge(s, 6000)).toBe(7);
  });

  it('reads Nano not responding once the heartbeat is older than 15 s with the port open', () => {
    let s = withState();
    s = reducer(s, { type: 'link', link: link({ last_heartbeat_age_s: 10 }), at: 0 });
    expect(linkLabel(s, 4000)).toBe('open');
    expect(linkLabel(s, 6000)).toBe('stale');
    s = reducer(s, { type: 'link', link: link({ source_open: false }), at: 6000 });
    expect(linkLabel(s, 6000)).toBe('closed');
  });

  it('tells a busy port from a missing Nano', () => {
    expect(portBusy(link({ source_open: false, port: 'COM5' }))).toBe(true);
    expect(portBusy(link({ source_open: false, port: null }))).toBe(false);
    expect(portBusy(link({ source_open: true, port: 'COM5' }))).toBe(false);
  });
});
