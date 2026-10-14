import { describe, expect, it } from 'vitest';

import { binWord, itemName, percent, rateText, splitFor, trashRateText } from './format';

describe('rates', () => {
  it('shows a dash, never 0% or NaN, when nothing is sorted', () => {
    expect(rateText(null)).toBe('–');
    expect(trashRateText(null)).toBe('–');
  });

  it('rounds to whole percentages', () => {
    expect(percent(0.944)).toBe('94%');
    expect(rateText(0.6)).toBe('60%');
    expect(trashRateText(0.6)).toBe('40%');
  });
});

describe('bin boundary', () => {
  it('rests at the middle with no items', () => {
    expect(splitFor(null)).toEqual({ split: 0.5, clamped: false });
  });

  it('follows the rate between 30% and 70%', () => {
    expect(splitFor(0.6)).toEqual({ split: 0.6, clamped: false });
  });

  it('clamps outside 30% to 70% and says so', () => {
    expect(splitFor(0.9)).toEqual({ split: 0.7, clamped: true });
    expect(splitFor(0)).toEqual({ split: 0.3, clamped: true });
  });

  it('does not flag a clamp too small to see', () => {
    expect(splitFor(0.71)).toEqual({ split: 0.7, clamped: false });
    expect(splitFor(0.75)).toEqual({ split: 0.7, clamped: true });
  });
});

describe('names', () => {
  const items = [
    { label: 'glass_bottle', display_name: 'Glass bottle', bin: 'recyclable' as const, count: 0 },
  ];

  it('takes display names from the server table', () => {
    expect(itemName({ label: 'glass_bottle', bin: 'recyclable' }, items)).toBe('Glass bottle');
  });

  it('names an uncertain event Unsure', () => {
    expect(itemName({ label: 'uncertain', bin: 'unsure' }, items)).toBe('Unsure');
    expect(binWord('unsure')).toBe('Unsure');
  });
});
