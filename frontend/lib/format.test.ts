import { describe, expect, it } from 'vitest';

import { binShare, binWord, itemName, percent } from './format';

describe('bin shares', () => {
  it('says nothing is sorted, never 0%, a dash or NaN, when there is no rate', () => {
    expect(binShare(null, 'recyclable')).toBe('Nothing sorted yet');
    expect(binShare(null, 'trash')).toBe('Nothing sorted yet');
  });

  it('rounds to whole percentages, and trash is the rest', () => {
    expect(percent(0.944)).toBe('94%');
    expect(binShare(0.6, 'recyclable')).toBe('60% of sorted items');
    expect(binShare(0.6, 'trash')).toBe('40% of sorted items');
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
