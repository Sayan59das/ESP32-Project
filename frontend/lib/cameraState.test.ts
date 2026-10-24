import { describe, expect, it } from 'vitest';

import { cameraState, isFault, type CameraInputs } from './cameraState';
import type { Event, Link } from './types';

const link = (over: Partial<Link> = {}): Link => ({
  source_open: true,
  port: 'socket://127.0.0.1:7777',
  last_line_age_s: 0.2,
  last_heartbeat_age_s: 1,
  nano_resets_seen: 0,
  dropped_lines: 0,
  ignored_background: 0,
  bin_mismatch: 0,
  frames_received: 10,
  frame_crc_errors: 0,
  preview_active: true,
  preview_fps: 5,
  ...over,
});

const event = (bin: Event['bin']): Event => ({
  id: 1,
  run_id: 1,
  ts: '2026-10-24T10:00:00Z',
  label: bin === 'unsure' ? 'uncertain' : bin,
  confidence: bin === 'unsure' ? 0.5 : 0.9,
  bin,
  latency_ms: 40,
  has_frame: true,
  source: 'serial',
});

const base: CameraInputs = {
  backendUnreachable: false,
  paused: false,
  link: link(),
  linkLabel: 'open',
  verdict: null,
  framesFlowing: true,
  framesOverdue: false,
};

describe('cameraState', () => {
  it('is ready when linked and frames flow', () => {
    expect(cameraState(base)).toBe('ready');
  });

  it('says counted, or unsure, while a verdict is held', () => {
    expect(cameraState({ ...base, verdict: event('recyclable') })).toBe('counted');
    expect(cameraState({ ...base, verdict: event('trash') })).toBe('counted');
    expect(cameraState({ ...base, verdict: event('unsure') })).toBe('unsure');
  });

  it('waits for frames, then says they are missing', () => {
    expect(cameraState({ ...base, framesFlowing: false })).toBe('waiting');
    expect(cameraState({ ...base, framesFlowing: false, framesOverdue: true })).toBe('no-frames');
  });

  it('puts faults before any verdict', () => {
    const verdict = event('recyclable');
    expect(cameraState({ ...base, verdict, linkLabel: 'stale' })).toBe('not-responding');
    expect(cameraState({ ...base, verdict, link: link({ source_open: false }) })).toBe(
      'not-linked',
    );
    expect(cameraState({ ...base, verdict, paused: true })).toBe('reconnecting');
    expect(cameraState({ ...base, verdict, backendUnreachable: true })).toBe('unreachable');
  });

  it('is connecting before the first state arrives', () => {
    expect(cameraState({ ...base, link: null })).toBe('connecting');
  });

  it('treats only the states that stop counting as faults', () => {
    expect(isFault('not-responding')).toBe(true);
    expect(isFault('no-frames')).toBe(true);
    expect(isFault('unsure')).toBe(false);
    expect(isFault('reconnecting')).toBe(false);
  });
});
