import type { LabelSpec } from '@/components/scene/Stage';
import type { TestingData } from '@/lib/testing';

import { datasetOf, number } from './derive';

const SHORT: Record<string, string> = {
  off: 'Switched off',
  covered: 'Lens covered',
  lights: 'Lights off',
  flat: 'Flat grey',
  frozen: 'Frozen',
  unplugged: 'Unplugged',
  comeback: 'Back on',
};

/**
 * Labels pinned to points in the testing scene. Chapter n is centred on n + 0.5. Each one is
 * made only from recorded figures, so with nothing recorded there is nothing to label.
 */
export function testingLabels(testing: TestingData): LabelSpec[] {
  const labels: LabelSpec[] = [
    {
      id: 'product',
      anchor: 'top',
      from: -0.2,
      to: 1.0,
      text: 'The product',
      detail: 'Everything on this page tests this',
      side: 'right-up',
    },
  ];

  (testing.suites ?? []).slice(0, 4).forEach((suite, i) => {
    labels.push({
      id: `pylon-${i}`,
      anchor: `pylon-${i}`,
      from: 1.15,
      to: 1.85,
      text: suite.label,
      detail: `${number(suite.passed)} passed, ${number(suite.failed)} failed`,
      side: 'right-up',
    });
  });

  (testing.scenarios ?? []).slice(0, 7).forEach((scenario, i) => {
    labels.push({
      id: `station-${i}`,
      anchor: `station-${i}`,
      from: 2.15,
      to: 2.85,
      text: SHORT[scenario.id] ?? scenario.title,
      detail: `Counted ${scenario.counted}`,
      side: 'right-up',
    });
  });

  const dataset = datasetOf(testing.model);
  if (dataset !== null) {
    labels.push(
      {
        id: 'field-recyclable',
        anchor: 'field-recyclable',
        from: 3.15,
        to: 3.85,
        text: 'Recyclable',
        detail: `${number(dataset.recyclable.training + dataset.recyclable.validation)} frames`,
        side: 'left-up',
      },
      {
        id: 'field-trash',
        anchor: 'field-trash',
        from: 3.15,
        to: 3.85,
        text: 'Non-recyclable',
        detail: `${number(dataset.trash.training + dataset.trash.validation)} frames`,
        side: 'right-up',
      },
      {
        id: 'field-held',
        anchor: 'field-held',
        from: 3.2,
        to: 3.85,
        text: 'Held back to test',
        detail: `${number(dataset.right)} of ${number(dataset.heldBack)} right`,
        side: 'right-down',
      },
    );
  }

  const media = testing.media;
  const slots = media ?? [
    { file: '', kind: 'image' as const, caption: 'Photograph' },
    { file: '', kind: 'video' as const, caption: 'Video' },
  ];
  slots.slice(0, 3).forEach((slot, i) => {
    labels.push({
      id: `media-${i}`,
      anchor: `media-${i}`,
      from: 4.15,
      to: 4.85,
      text: media === null ? (slot.kind === 'video' ? 'Video' : 'Photograph') : slot.caption,
      detail: media === null ? 'Not added yet' : undefined,
      side: i % 2 === 0 ? 'left-up' : 'right-up',
    });
  });
  return labels;
}
