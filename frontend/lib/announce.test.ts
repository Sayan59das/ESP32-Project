import { describe, expect, it } from 'vitest';

import { verdictAnnouncement } from './announce';
import type { Counts, Event } from './types';

const counts: Counts = {
  recyclable: 13,
  trash: 9,
  unsure: 4,
  total_sorted: 22,
  recycle_rate: 0.59,
};

const event = (over: Partial<Event> = {}): Event => ({
  id: 7,
  run_id: 1,
  ts: '2026-10-24T12:00:00.000Z',
  label: 'bottle',
  confidence: 0.874,
  bin: 'recyclable',
  latency_ms: 410,
  has_frame: true,
  source: 'serial',
  ...over,
});

describe('verdictAnnouncement', () => {
  it('names the item, its bin, the confidence and both server counts', () => {
    expect(verdictAnnouncement(event(), 'Plastic bottle', counts)).toBe(
      'Plastic bottle, recyclable, 87% confidence. Recyclable 13, trash 9.',
    );
  });

  it('does not repeat the bin when the item is named after it', () => {
    expect(verdictAnnouncement(event({ bin: 'trash' }), 'Trash', counts)).toBe(
      'Trash, 87% confidence. Recyclable 13, trash 9.',
    );
  });

  it('says an unsure item was not counted and gives the unsure tally', () => {
    expect(verdictAnnouncement(event({ bin: 'unsure', confidence: 0.52 }), 'Unsure', counts)).toBe(
      'Unsure, not counted, 52% confidence. Unsure items: 4.',
    );
  });
});
