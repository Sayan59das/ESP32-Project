import { describe, expect, it } from 'vitest';

import { centreOf, chapterPosition, currentChapter } from './chapters';
import { chooseLean, labelBox } from './labels';
import {
  clamp01,
  damp,
  easeInOutCubic,
  fbm2,
  mulberry32,
  noise2,
  smootherstep,
  smoothstep,
  window01,
} from './math';
import { type Key, poseAt } from './rig';

describe('easing', () => {
  it('clamps, and smoothsteps from 0 to 1', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(7)).toBe(1);
    expect(smoothstep(0, 10, -1)).toBe(0);
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5, 6);
    expect(smoothstep(0, 10, 11)).toBe(1);
    expect(smootherstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('eases in and out symmetrically', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 6);
  });

  it('is 1 inside a window and fades outside it', () => {
    expect(window01(2, 1, 3, 0.5)).toBe(1);
    expect(window01(0.2, 1, 3, 0.5)).toBe(0);
    expect(window01(3.25, 1, 3, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('damps toward a target without overshooting, and the same at any frame rate', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 4, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i++) b = damp(b, 1, 4, 1 / 30);
    expect(a).toBeLessThan(1);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('deterministic noise', () => {
  it('repeats for the same input and seed, and differs by seed', () => {
    expect(noise2(3.3, 4.1, 5)).toBe(noise2(3.3, 4.1, 5));
    expect(noise2(3.3, 4.1, 5)).not.toBe(noise2(3.3, 4.1, 6));
  });

  it('stays in range and is continuous', () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm2(i * 0.37, i * 0.11, 5, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(Math.abs(noise2(10.0, 10.0) - noise2(10.001, 10.0))).toBeLessThan(0.01);
  });

  it('gives the same random sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

const keys: Key[] = [
  { at: 0, pos: [0, 0, 10], look: [0, 0, 0], fov: 40, shift: 0.2 },
  { at: 1, pos: [10, 0, 0], look: [0, 0, 0], fov: 30, shift: -0.2 },
  { at: 3, pos: [0, 10, 0], look: [0, 1, 0], fov: 50, shift: 0 },
];

describe('the camera rig', () => {
  it('is exactly at a key on that key', () => {
    expect(poseAt(keys, 0).pos).toEqual([0, 0, 10]);
    expect(poseAt(keys, 1).pos[0]).toBeCloseTo(10, 6);
    expect(poseAt(keys, 3).fov).toBe(50);
  });

  it('stays at the first and last key outside the range', () => {
    expect(poseAt(keys, -5).pos).toEqual([0, 0, 10]);
    expect(poseAt(keys, 99).look).toEqual([0, 1, 0]);
  });

  it('dwells near a key, then moves through the middle of the segment', () => {
    const near = poseAt(keys, 0.05);
    expect(near.pos[2]).toBeCloseTo(10, 1); // barely moved after 5% of the way
    const mid = poseAt(keys, 0.5);
    expect(mid.pos[2]).toBeLessThan(9);
    expect(mid.pos[0]).toBeGreaterThan(1);
    expect(mid.fov).toBeCloseTo(35, 6);
    expect(mid.shift).toBeCloseTo(0, 6);
  });

  it('never jumps: a tiny step in chapter is a tiny step in the camera', () => {
    let previous = poseAt(keys, 0);
    for (let c = 0.01; c <= 3; c += 0.01) {
      const pose = poseAt(keys, c);
      const step = Math.hypot(
        pose.pos[0] - previous.pos[0],
        pose.pos[1] - previous.pos[1],
        pose.pos[2] - previous.pos[2],
      );
      expect(step).toBeLessThan(1.2);
      previous = pose;
    }
  });

  it('refuses a rig with no keys', () => {
    expect(() => poseAt([], 0)).toThrow(/needs keys/);
  });
});

describe('label placement', () => {
  const view = { left: 10, top: 86, right: 1430, bottom: 890 };

  it('keeps the preferred side when it has room', () => {
    expect(chooseLean(600, 500, 220, 50, [1, 1], view, [])).toEqual([1, 1]);
    expect(chooseLean(600, 500, 220, 50, [-1, -1], view, [])).toEqual([-1, -1]);
  });

  it('flips to the other side at the edge of the screen', () => {
    expect(chooseLean(1380, 500, 220, 50, [1, 1], view, [])).toEqual([-1, 1]);
    expect(chooseLean(40, 500, 220, 50, [-1, 1], view, [])).toEqual([1, 1]);
  });

  it('goes below its point rather than under the header', () => {
    expect(chooseLean(600, 100, 220, 50, [1, 1], view, [])).toEqual([1, -1]);
  });

  it('keeps off the words of the page', () => {
    const card = { left: 640, top: 380, right: 1000, bottom: 700 };
    // To the right would land on the card; to the left is free.
    expect(chooseLean(560, 500, 220, 50, [1, 1], view, [card])).toEqual([-1, 1]);
    // The box it would have taken is really on the card.
    const taken = labelBox(560, 500, 220, 50, [1, 1]);
    expect(taken.right).toBeGreaterThan(card.left);
  });

  it('hides the label when there is nowhere to put it', () => {
    const everything = { left: 0, top: 0, right: 1440, bottom: 900 };
    expect(chooseLean(600, 500, 220, 50, [1, 1], view, [everything])).toBeNull();
  });
});

describe('chapter position from the page', () => {
  const spans = [
    { top: 0, height: 1000 },
    { top: 1000, height: 1000 },
    { top: 2000, height: 1000 },
  ];

  it('uses the middle of the viewport as the reading line', () => {
    // Viewport 800 tall: the line is at scrollY + 400.
    expect(chapterPosition(spans, 600, 800)).toBeCloseTo(1, 6);
    expect(chapterPosition(spans, 850, 800)).toBeCloseTo(1.25, 6);
  });

  it('stays at the first and last chapter outside the page', () => {
    expect(chapterPosition(spans, 0, 800)).toBe(0.4);
    expect(chapterPosition(spans, -500, 800)).toBe(0);
    expect(chapterPosition(spans, 9999, 800)).toBe(2);
  });

  it('copes with no chapters', () => {
    expect(chapterPosition([], 100, 800)).toBe(0);
  });

  it('shows the chapter whose words are on screen when motion is off', () => {
    expect(currentChapter(1.0, 3)).toBe(1);
    expect(currentChapter(1.9, 3)).toBe(1);
    expect(currentChapter(2.0, 3)).toBe(2);
    expect(currentChapter(-1, 3)).toBe(0);
    expect(currentChapter(8, 3)).toBe(2);
  });

  it('keys the camera to the middle of a chapter, where its words are pinned', () => {
    expect(centreOf(0)).toBe(0.5);
    expect(centreOf(3)).toBe(3.5);
  });
});
