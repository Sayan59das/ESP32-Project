import { describe, expect, it } from 'vitest';

import { parseTesting, passRate, totals } from './testing';

const suite = {
  id: 'backend',
  label: 'Backend',
  what: 'pytest',
  passed: 10,
  failed: 2,
  skipped: 1,
  seconds: 3.5,
};

const scenario = {
  id: 'off',
  title: 'Camera switched off',
  what: 'Every pixel is black.',
  expectation: 'Counts nothing.',
  counted: 0,
  alive: false,
  reported: 'dark or flat',
  passed: true,
};

describe('parseTesting', () => {
  it('reads a complete file', () => {
    const data = parseTesting({
      recorded_at: '2026-10-25T00:00:00Z',
      commit: 'abc1234',
      suites: [suite],
      scenarios: [scenario],
      scenario_note: 'A note.',
      model: {
        parameters: 293970,
        training_frames: { recyclable: 84, non_recyclable: 132 },
        validation_frames: { recyclable: 20, non_recyclable: 33 },
        validation_correct: { recyclable: 20, non_recyclable: 33 },
      },
      media: [{ file: 'rig.jpg', kind: 'image', caption: 'The rig' }],
    });
    expect(data.suites).toEqual([suite]);
    expect(data.scenarios?.[0]?.passed).toBe(true);
    expect(data.model?.parameters).toBe(293970);
    expect(data.media).toEqual([{ file: 'rig.jpg', kind: 'image', caption: 'The rig' }]);
    expect(data.commit).toBe('abc1234');
  });

  it('turns anything missing or malformed into null, never a guess', () => {
    for (const raw of [null, undefined, 3, 'x', [], {}]) {
      const data = parseTesting(raw);
      expect(data.suites).toBeNull();
      expect(data.scenarios).toBeNull();
      expect(data.model).toBeNull();
      expect(data.media).toBeNull();
      expect(data.recordedAt).toBeNull();
    }
  });

  it('drops a whole list when one entry in it is wrong, rather than showing part of it', () => {
    expect(parseTesting({ suites: [suite, { ...suite, passed: -1 }] }).suites).toBeNull();
    expect(parseTesting({ suites: [{ ...suite, label: '' }] }).suites).toBeNull();
    expect(parseTesting({ scenarios: [{ ...scenario, passed: 'yes' }] }).scenarios).toBeNull();
    expect(parseTesting({ scenarios: [{ ...scenario, alive: undefined }] }).scenarios).toBeNull();
  });

  it('keeps an unmeasured time as null', () => {
    expect(parseTesting({ suites: [{ ...suite, seconds: null }] }).suites?.[0]?.seconds).toBeNull();
    expect(
      parseTesting({ suites: [{ ...suite, seconds: 'fast' }] }).suites?.[0]?.seconds,
    ).toBeNull();
  });

  it('only accepts a plain file name for media, never a path or another site', () => {
    const media = (file: string) =>
      parseTesting({ media: [{ file, kind: 'image', caption: 'x' }] }).media;
    expect(media('rig.jpg')).not.toBeNull();
    expect(media('../secret.png')).toBeNull();
    expect(media('a/b.png')).toBeNull();
    expect(media('https://example.com/a.png')).toBeNull();
    expect(media('')).toBeNull();
    expect(
      parseTesting({ media: [{ file: 'a.png', kind: 'gif', caption: 'x' }] }).media,
    ).toBeNull();
  });

  it('treats an empty list as not recorded', () => {
    expect(parseTesting({ suites: [], media: [] }).suites).toBeNull();
    expect(parseTesting({ media: [] }).media).toBeNull();
  });

  it('rejects a model record with a bad count for one class', () => {
    const model = parseTesting({
      model: { parameters: 1, training_frames: { recyclable: 1.5 } },
    }).model;
    expect(model?.parameters).toBe(1);
    expect(model?.trainingFrames).toBeNull();
  });
});

describe('totals and passRate', () => {
  it('adds the suites up, and says nothing without any', () => {
    expect(totals([suite, { ...suite, passed: 5, failed: 0 }])).toEqual({ passed: 15, failed: 2 });
    expect(totals(null)).toBeNull();
  });

  it('is the share that passed, and null when nothing ran', () => {
    expect(passRate({ ...suite, passed: 3, failed: 1 })).toBe(0.75);
    expect(passRate({ ...suite, passed: 0, failed: 0 })).toBeNull();
  });
});
