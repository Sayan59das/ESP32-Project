// data/testing.json: what was tested and what came out, recorded by scripts/record_tests.py.
// Read defensively, like data/metrics.json: anything missing or the wrong shape becomes null
// and the page says "Not measured yet" for it. Nothing here is estimated or made up.

export interface Suite {
  id: string;
  label: string;
  what: string;
  passed: number;
  failed: number;
  skipped: number;
  seconds: number | null;
}

export interface Scenario {
  id: string;
  title: string;
  /** What the camera is doing in the scene. */
  what: string;
  /** Items the counter produced while it lasted. */
  counted: number;
  /** Whether the camera bridge still said the camera was alive at the end. */
  alive: boolean;
  /** What the bridge reported, in its own words. */
  reported: string | null;
  /** What must happen for the test to pass, in words. */
  expectation: string;
  /** Whether it did, as decided when it was recorded. */
  passed: boolean;
}

export interface ModelFacts {
  parameters: number | null;
  trainingFrames: Record<string, number> | null;
  validationFrames: Record<string, number> | null;
  validationCorrect: Record<string, number> | null;
}

export interface Media {
  /** Path under /testing/, served from this site. */
  file: string;
  kind: 'image' | 'video';
  caption: string;
}

export interface TestingData {
  recordedAt: string | null;
  commit: string | null;
  suites: Suite[] | null;
  scenarios: Scenario[] | null;
  scenarioNote: string | null;
  model: ModelFacts | null;
  media: Media[] | null;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function countRecord(v: unknown): Record<string, number> | null {
  if (!isObject(v)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(v)) {
    const n = count(value);
    if (n === null) return null;
    out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function list<T>(v: unknown, item: (entry: Json) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const entry of v) {
    const parsed = isObject(entry) ? item(entry) : null;
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out.length > 0 ? out : null;
}

export function parseTesting(raw: unknown): TestingData {
  const t = isObject(raw) ? raw : {};
  const model = isObject(t.model) ? t.model : null;
  return {
    recordedAt: text(t.recorded_at),
    commit: text(t.commit),
    suites: list(t.suites, (e) => {
      const id = text(e.id);
      const label = text(e.label);
      const what = text(e.what);
      const passed = count(e.passed);
      const failed = count(e.failed);
      const skipped = count(e.skipped);
      if (!id || !label || !what || passed === null || failed === null || skipped === null)
        return null;
      return { id, label, what, passed, failed, skipped, seconds: finite(e.seconds) };
    }),
    scenarios: list(t.scenarios, (e) => {
      const id = text(e.id);
      const title = text(e.title);
      const what = text(e.what);
      const expectation = text(e.expectation);
      const counted = count(e.counted);
      if (!id || !title || !what || !expectation || counted === null) return null;
      if (typeof e.alive !== 'boolean' || typeof e.passed !== 'boolean') return null;
      return {
        id,
        title,
        what,
        expectation,
        counted,
        alive: e.alive,
        reported: text(e.reported),
        passed: e.passed,
      };
    }),
    scenarioNote: text(t.scenario_note),
    model:
      model === null
        ? null
        : {
            parameters: count(model.parameters),
            trainingFrames: countRecord(model.training_frames),
            validationFrames: countRecord(model.validation_frames),
            validationCorrect: countRecord(model.validation_correct),
          },
    media: list(t.media, (e) => {
      const file = text(e.file);
      const caption = text(e.caption);
      const kind = e.kind === 'video' ? 'video' : e.kind === 'image' ? 'image' : null;
      // Only a plain file name under /testing/: never a path out of it or another site.
      if (!file || !caption || kind === null || !/^[\w.-]+$/.test(file)) return null;
      return { file, kind, caption };
    }),
  };
}

/** Tests passed, failed and skipped across suites, or null when nothing is recorded. */
export function totals(suites: Suite[] | null): { passed: number; failed: number } | null {
  if (suites === null) return null;
  return {
    passed: suites.reduce((n, s) => n + s.passed, 0),
    failed: suites.reduce((n, s) => n + s.failed, 0),
  };
}

/** One suite's share that passed, 0 to 1, or null when it ran nothing. */
export function passRate(suite: Suite): number | null {
  const ran = suite.passed + suite.failed;
  return ran === 0 ? null : suite.passed / ran;
}
