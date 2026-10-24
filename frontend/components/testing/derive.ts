// What the Testing page says about the recorded data: plain arithmetic on what was measured,
// done once so the words, the 3D scene and the tables never disagree. Nothing here estimates.

import type { ModelFacts, Scenario, TestingData } from '@/lib/testing';
import { totals } from '@/lib/testing';

export interface Dataset {
  parameters: number | null;
  recyclable: { training: number; validation: number; correct: number };
  trash: { training: number; validation: number; correct: number };
  frames: number;
  heldBack: number;
  right: number;
}

/** The model's record, or null unless every count it needs was recorded. */
export function datasetOf(model: ModelFacts | null): Dataset | null {
  if (model === null) return null;
  const { trainingFrames: t, validationFrames: v, validationCorrect: c } = model;
  const pick = (name: string) => {
    const training = t?.[name];
    const validation = v?.[name];
    const correct = c?.[name];
    return training === undefined || validation === undefined || correct === undefined
      ? null
      : { training, validation, correct };
  };
  const recyclable = pick('recyclable');
  const trash = pick('non_recyclable');
  if (recyclable === null || trash === null) return null;
  return {
    parameters: model.parameters,
    recyclable,
    trash,
    frames: recyclable.training + recyclable.validation + trash.training + trash.validation,
    heldBack: recyclable.validation + trash.validation,
    right: recyclable.correct + trash.correct,
  };
}

export function scenarioResult(
  scenarios: Scenario[] | null,
): { passed: number; total: number } | null {
  if (scenarios === null) return null;
  return { passed: scenarios.filter((s) => s.passed).length, total: scenarios.length };
}

export interface Facts {
  sum: { passed: number; failed: number } | null;
  scenarios: { passed: number; total: number } | null;
  dataset: Dataset | null;
  media: number;
}

export function factsOf(testing: TestingData): Facts {
  return {
    sum: totals(testing.suites),
    scenarios: scenarioResult(testing.scenarios),
    dataset: datasetOf(testing.model),
    media: testing.media?.length ?? 0,
  };
}

/** "25 October 2026, 20:37 UTC": the time zone is stated, so the page reads the same anywhere. */
export function recordedOn(iso: string | null): string | null {
  if (iso === null) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const text = when.toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
  return `${text} UTC`;
}

export const number = (n: number): string => n.toLocaleString('en-GB');
