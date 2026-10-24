import { describe, expect, it } from 'vitest';

import { connectionNotice } from './connection';
import { initialState, type ConsoleState } from './reducer';
import type { State } from './types';

const NOW = 1_000_000;

const server: State = {
  run: { id: 1, started_at: '2026-10-24T10:00:00Z', source: 'serial' },
  counts: { recyclable: 3, trash: 2, unsure: 1, total_sorted: 5, recycle_rate: 0.6 },
  by_item: [],
  last_event: null,
  link: {
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
  },
};

const live: ConsoleState = { ...initialState, server, linkAt: NOW };

describe('connectionNotice', () => {
  it('says nothing while the stream is up', () => {
    expect(connectionNotice(live, NOW)).toBeNull();
  });

  it('waits out a short drop before calling the stream paused', () => {
    expect(connectionNotice({ ...live, downSince: NOW - 2_000 }, NOW)).toBeNull();
  });

  it('calls a longer drop paused, says for how long, and flags the counts as last known', () => {
    const notice = connectionNotice({ ...live, downSince: NOW - 12_000 }, NOW);
    expect(notice?.kind).toBe('paused');
    expect(notice?.title).toBe('Live updates paused');
    expect(notice?.body).toMatch(/dropped 12 s ago/);
    expect(notice?.body).toMatch(/last ones received/);
  });

  it('does not mention counts that never arrived', () => {
    const notice = connectionNotice({ ...initialState, downSince: NOW - 12_000 }, NOW);
    expect(notice?.kind).toBe('paused');
    expect(notice?.body).not.toMatch(/counts/);
  });

  it('puts an unreachable service ahead of a paused stream, with the next step', () => {
    const notice = connectionNotice(
      { ...live, downSince: NOW - 12_000, backendUnreachable: true },
      NOW,
    );
    expect(notice?.kind).toBe('unreachable');
    expect(notice?.title).toBe('Classifier service unreachable');
    expect(notice?.body).toMatch(/Start it with run_all\.bat\./);
  });
});
