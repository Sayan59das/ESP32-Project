import { describe, expect, it } from 'vitest';

import { linkTone, linkView } from './linkView';
import { initialState, type ConsoleState } from './reducer';
import type { Link, State } from './types';

const NOW = 1_000_000;

function stateWith(link: Partial<Link>, over: Partial<ConsoleState> = {}): ConsoleState {
  const server: State = {
    run: { id: 1, started_at: '2026-10-24T10:00:00Z', source: 'serial' },
    counts: { recyclable: 0, trash: 0, unsure: 0, total_sorted: 0, recycle_rate: null },
    by_item: [],
    last_event: null,
    link: {
      source_open: true,
      port: 'socket://127.0.0.1:7777',
      last_line_age_s: 0.1,
      last_heartbeat_age_s: 2,
      nano_resets_seen: 0,
      dropped_lines: 0,
      ignored_background: 0,
      bin_mismatch: 0,
      frames_received: 3,
      frame_crc_errors: 0,
      preview_active: true,
      preview_fps: 5,
      ...link,
    },
  };
  return { ...initialState, server, linkAt: NOW, ...over };
}

describe('linkView', () => {
  it('describes a healthy link with its frame rate and heartbeat', () => {
    const view = linkView(stateWith({}), NOW);
    expect(view.kind).toBe('linked');
    expect(view.label).toBe('Linked');
    expect(view.sentence).toBe('Frames arriving at 5 per second. Last heartbeat 2 s ago.');
    expect(linkTone(view.kind)).toBe('signal');
  });

  it('says the preview is paused here instead of waiting for frames', () => {
    const view = linkView(stateWith({ preview_active: false, preview_fps: null }), NOW, true);
    expect(view.kind).toBe('linked');
    expect(view.sentence).toBe('Preview paused on this screen. Last heartbeat 2 s ago.');
  });

  it('says the camera is not responding once heartbeats stop', () => {
    const view = linkView(stateWith({ last_heartbeat_age_s: 20 }), NOW);
    expect(view.kind).toBe('not-responding');
    expect(view.sentence).toMatch(/^No heartbeat for 20 s\./);
    expect(linkTone(view.kind)).toBe('alert');
  });

  it('tells a busy port from a missing board', () => {
    expect(linkView(stateWith({ source_open: false }), NOW).sentence).toMatch(/not available/);
    expect(linkView(stateWith({ source_open: false, port: null }), NOW).sentence).toMatch(
      /No camera board found/,
    );
  });

  it('reports a paused stream before anything the stale state says', () => {
    const view = linkView(stateWith({}, { downSince: NOW - 10_000 }), NOW);
    expect(view.kind).toBe('reconnecting');
    expect(linkTone(view.kind)).toBe('neutral');
  });

  it('never calls the simulator or a replay "Linked": there is no camera behind them', () => {
    for (const [source, label] of [
      ['sim', 'Simulator'],
      ['replay', 'Replay'],
    ] as const) {
      const base = stateWith({});
      const state = {
        ...base,
        server: base.server && { ...base.server, run: { ...base.server.run, source } },
      };
      const view = linkView(state, NOW);
      expect(view.kind).toBe('simulated');
      expect(view.label).toBe(label);
      expect(view.sentence).toMatch(/No camera is connected\./);
      expect(view.sentence).toMatch(/switching the camera on or off changes nothing/);
      expect(linkTone(view.kind)).toBe('neutral');
    }
  });

  it('still reports a dropped stream first when the data is simulated', () => {
    const base = stateWith({}, { downSince: NOW - 10_000 });
    const state = {
      ...base,
      server: base.server && {
        ...base.server,
        run: { ...base.server.run, source: 'sim' as const },
      },
    };
    expect(linkView(state, NOW).kind).toBe('reconnecting');
  });

  it('carries the number of board restarts for the reset notice', () => {
    expect(linkView(stateWith({ nano_resets_seen: 2 }), NOW).resets).toBe(2);
  });

  it('is connecting before the first state arrives', () => {
    expect(linkView(initialState, NOW).kind).toBe('connecting');
  });
});
