import os from 'node:os';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

// The smoke test runs against the simulator with a throwaway database, never a real run.
const python =
  process.platform === 'win32'
    ? path.resolve(__dirname, '../backend/.venv/Scripts/python.exe')
    : path.resolve(__dirname, '../backend/.venv/bin/python');
const db = path.join(os.tmpdir(), `ecosort-e2e-${process.pid}.db`);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:create_app --factory --app-dir ../backend --host 127.0.0.1 --port 8000`,
      url: 'http://127.0.0.1:8000/api/health',
      env: { SOURCE: 'sim', DB_PATH: db },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run start',
      url: 'http://localhost:3000',
      env: { NEXT_TELEMETRY_DISABLED: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
