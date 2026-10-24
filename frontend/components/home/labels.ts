import type { LabelSpec } from '@/components/scene/Stage';
import type { Suite } from '@/lib/testing';

/**
 * Labels pinned to points in the home scene. `from` and `to` are chapter positions: chapter n
 * is centred on n + 0.5, which is where its words are pinned.
 */
export function homeLabels(suites: Suite[] | null): LabelSpec[] {
  const labels: LabelSpec[] = [
    {
      id: 'lens',
      anchor: 'lens',
      from: -0.2,
      to: 2.0,
      text: 'The camera',
      detail: '160 × 120 pixels, grayscale',
      side: 'right-up',
    },
    {
      id: 'top',
      anchor: 'top',
      from: -0.2,
      to: 1.2,
      text: 'Runs offline',
      detail: 'No cloud, no external requests',
      side: 'left-up',
    },
    {
      id: 'frame',
      anchor: 'frame',
      from: 2.2,
      to: 2.85,
      text: 'What the model reads',
      detail: 'One of our training frames, enlarged',
      side: 'right-down',
    },
    {
      id: 'bin-recyclable',
      anchor: 'bin-recyclable',
      from: 3.15,
      to: 4.85,
      text: 'Recyclable',
      detail: 'Counted',
      side: 'left-up',
    },
    {
      id: 'bin-trash',
      anchor: 'bin-trash',
      from: 3.15,
      to: 4.85,
      text: 'Trash',
      detail: 'Counted',
      side: 'right-up',
    },
    {
      id: 'bin-unsure',
      anchor: 'bin-unsure',
      from: 3.15,
      to: 4.85,
      text: 'Unsure',
      detail: 'Below 60%: counted in neither bin',
      side: 'left-down',
    },
    {
      id: 'gate',
      anchor: 'gate',
      from: 4.05,
      to: 4.85,
      text: 'The scan',
      detail: 'One item, one count',
      side: 'right-up',
    },
    {
      id: 'node-camera',
      anchor: 'node-camera',
      from: 5.1,
      to: 5.9,
      text: 'Camera board',
      detail: 'Sends grayscale frames',
      side: 'right-up',
    },
    {
      id: 'node-model',
      anchor: 'node-model',
      from: 5.1,
      to: 5.9,
      text: 'Camera bridge',
      detail: 'Runs the model, counts once',
      side: 'right-down',
    },
    {
      id: 'node-server',
      anchor: 'node-server',
      from: 5.1,
      to: 5.9,
      text: 'Website bridge',
      detail: 'Checks, stores, counts',
      side: 'right-up',
    },
    {
      id: 'node-console',
      anchor: 'node-console',
      from: 5.1,
      to: 5.9,
      text: 'Console',
      detail: 'Only displays',
      side: 'right-down',
    },
  ];
  (suites ?? []).slice(0, 3).forEach((suite, i) => {
    labels.push({
      id: `pylon-${i}`,
      anchor: `pylon-${i}`,
      from: 6.2,
      to: 6.85,
      text: suite.label,
      detail: `${suite.passed} passed, ${suite.failed} failed`,
      // The first one opens to the left so the others, which open to the right, never overlap it.
      side: i === 0 ? 'left-up' : 'right-up',
    });
  });
  return labels;
}
