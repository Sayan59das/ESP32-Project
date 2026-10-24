import { describe, expect, it } from 'vitest';

import { labelText, parseMetrics } from './metrics';

describe('parseMetrics', () => {
  it('turns the shipped all-null file into all nulls', () => {
    const m = parseMetrics({ overall_test_accuracy: null, latency_ms_p50: null });
    expect(Object.values(m).every((v) => v === null)).toBe(true);
  });

  it('treats a missing file or junk as nothing measured', () => {
    expect(parseMetrics(undefined).flash_kb).toBeNull();
    expect(parseMetrics('nonsense').overall_test_accuracy).toBeNull();
    expect(parseMetrics([1, 2]).ram_kb_peak).toBeNull();
  });

  it('keeps well-formed values', () => {
    const m = parseMetrics({
      test_images_per_class: { can: 40, pen: 38 },
      test_accuracy_per_class: { can: 0.95, pen: 0.81 },
      overall_test_accuracy: 0.9,
      latency_ms_p50: 412,
      model_input: ' 96x96 grayscale ',
    });
    expect(m.test_images_per_class).toEqual({ can: 40, pen: 38 });
    expect(m.test_accuracy_per_class).toEqual({ can: 0.95, pen: 0.81 });
    expect(m.overall_test_accuracy).toBe(0.9);
    expect(m.latency_ms_p50).toBe(412);
    expect(m.model_input).toBe('96x96 grayscale');
  });

  it('rejects values that cannot be right rather than showing them', () => {
    const m = parseMetrics({
      overall_test_accuracy: 94, // a percentage where a fraction belongs
      test_accuracy_per_class: { can: 0.9, pen: 'high' },
      latency_ms_p95: 'fast',
      model_architecture: '   ',
    });
    expect(m.overall_test_accuracy).toBeNull();
    expect(m.test_accuracy_per_class).toBeNull();
    expect(m.latency_ms_p95).toBeNull();
    expect(m.model_architecture).toBeNull();
  });

  it('accepts a square confusion matrix and nothing else', () => {
    const labels = ['can', 'pen'];
    expect(
      parseMetrics({
        confusion_matrix: {
          labels,
          rows: [
            [9, 1],
            [2, 8],
          ],
        },
      }).confusion_matrix,
    ).toEqual({
      labels,
      rows: [
        [9, 1],
        [2, 8],
      ],
    });
    expect(
      parseMetrics({ confusion_matrix: { labels, rows: [[9, 1]] } }).confusion_matrix,
    ).toBeNull();
    expect(
      parseMetrics({
        confusion_matrix: {
          labels,
          rows: [
            [9, 1],
            [2, -1],
          ],
        },
      }).confusion_matrix,
    ).toBeNull();
  });

  it('reads wiring and credits, dropping the whole list if one row is broken', () => {
    const wiring = [{ from: 'IR sensor OUT', to: 'Nano D2' }];
    expect(parseMetrics({ wiring }).wiring).toEqual([{ ...wiring[0], note: null }]);
    expect(parseMetrics({ wiring: [...wiring, { from: 'GND' }] }).wiring).toBeNull();
    expect(parseMetrics({ datasets: [{ name: 'X', licence: 'CC BY 4.0' }] }).datasets).toEqual([
      { name: 'X', licence: 'CC BY 4.0', url: null },
    ]);
  });
});

describe('labelText', () => {
  it('formats a label for display', () => {
    expect(labelText('glass_bottle')).toBe('Glass bottle');
    expect(labelText('pen')).toBe('Pen');
    expect(labelText('non_recyclable')).toBe('Non-recyclable');
  });
});
