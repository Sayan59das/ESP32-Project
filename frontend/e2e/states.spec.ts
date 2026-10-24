import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s), ${v.help}`);
}

test('an unreachable service is named, with no counts and no endless loading', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/');
  const banner = page.getByRole('banner');
  await expect(banner.getByText('Classifier service unreachable.')).toBeVisible();
  await expect(banner.getByText(/Start it with run_all\.bat\./)).toBeVisible();
  // No made-up numbers and no skeletons standing in for data that is not coming.
  await expect(page.getByTestId('bin-readout').getByText('No counts')).toHaveCount(2);
  await expect(page.getByTestId('count-recyclable')).toHaveCount(0);
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

test('a stream that will not connect is called paused while the service answers', async ({
  page,
}) => {
  await page.route('**/api/stream', (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/');
  await expect(page.getByRole('banner').getByText('Live updates paused.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('banner').getByText('Classifier service unreachable.')).toHaveCount(
    0,
  );
});

test('an unknown address gets a page that leads back', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the console' })).toHaveAttribute('href', '/');
  expect(await axeViolations(page)).toEqual([]);
});
