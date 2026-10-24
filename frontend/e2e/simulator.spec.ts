import { expect, test } from '@playwright/test';

// These tests run against the simulator, which is how the e2e backend is started (SOURCE=sim).
// Its items are made up. Nothing on screen may suggest a camera is behind them: someone who
// switches their camera off and still sees detections must be able to see why.

test.beforeEach(async ({ page }) => {
  await page.goto('/console');
  await expect(page.getByRole('banner').getByText('Simulated data', { exact: true })).toBeVisible();
});

test('the simulator is never called "Linked" and never asks for an item to be placed', async ({
  page,
}) => {
  const header = page.getByRole('banner');
  await expect(header.getByText('Simulator', { exact: true })).toBeVisible();
  await expect(header.getByText('Linked', { exact: true })).toHaveCount(0);

  const camera = page.getByTestId('camera-viewport');
  await expect(camera.getByText('Simulated, no camera in use')).toBeVisible();
  await expect(page.getByText(/Ready, place an item/)).toHaveCount(0);
  await expect(page.getByText(/Counted, remove the item/)).toHaveCount(0);
});

test('the link panel says no camera is connected and how to get real detections', async ({
  page,
}) => {
  const panel = page.getByRole('region', { name: 'Link and run' });
  await expect(panel.getByText(/No camera is connected\./)).toBeVisible();
  await expect(panel.getByText(/switching the camera on or off changes nothing/)).toBeVisible();
  await expect(panel.getByText(/run_all\.bat/)).toBeVisible();
});

test('there is no Export CSV control', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Start new run' })).toBeVisible();
  await expect(page.getByText(/export csv/i)).toHaveCount(0);
  await expect(page.locator('a[download]')).toHaveCount(0);
});
