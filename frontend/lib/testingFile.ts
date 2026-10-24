import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { type TestingData, parseTesting } from './testing';

const TESTING_FILE = path.resolve(process.cwd(), '..', 'data', 'testing.json');

/** Server only. Read on every request, so re-recording the tests only needs a reload. */
export async function loadTesting(): Promise<{ data: TestingData; problem: string | null }> {
  let raw: string;
  try {
    raw = await readFile(TESTING_FILE, 'utf8');
  } catch {
    return {
      data: parseTesting(null),
      problem: 'data/testing.json was not found. Run scripts/record_tests.py to record the tests.',
    };
  }
  try {
    return { data: parseTesting(JSON.parse(raw)), problem: null };
  } catch {
    return { data: parseTesting(null), problem: 'data/testing.json is not valid JSON.' };
  }
}
