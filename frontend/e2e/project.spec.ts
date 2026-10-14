import { expect, test } from '@playwright/test';

test('the project page renders every section and marks unmeasured values', async ({ page }) => {
  await page.goto('/project');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How EcoSort Edge works');
  for (const name of [
    'What it does and why it runs on the device',
    'How one item gets sorted',
    'Results',
    'Confusion matrix',
    'Known limits',
    'Wiring and parts',
    'Credits and licences',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole('img', { name: 'How one item gets sorted' })).toBeVisible();
  await expect(page.getByText('Not measured yet').first()).toBeVisible();
  const current = page.getByRole('link', { name: 'Project' });
  await expect(current).toHaveAttribute('aria-current', 'page');
});

test('no page asks for anything outside this machine', async ({ page }) => {
  const outside: string[] = [];
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return route.continue();
    outside.push(route.request().url());
    return route.abort();
  });
  for (const path of ['/', '/project']) {
    await page.goto(path);
    await page.waitForTimeout(3000);
  }
  expect(outside).toEqual([]);
});
