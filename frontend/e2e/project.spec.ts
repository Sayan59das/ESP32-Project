import { expect, test } from '@playwright/test';

const SECTIONS = [
  'What it does and how it works',
  'How one item gets sorted',
  'Results',
  'Confusion matrix',
  'Known limits',
  'Wiring and parts',
  'Credits and licences',
];

test('the project page renders every section and marks unmeasured values', async ({ page }) => {
  await page.goto('/project');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How EcoSort Edge works');
  for (const name of SECTIONS) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole('img', { name: 'How one item gets sorted' })).toBeVisible();
  await expect(page.getByText('Not measured yet').first()).toBeVisible();
  const current = page.getByRole('link', { name: 'Project' });
  await expect(current).toHaveAttribute('aria-current', 'page');
});

test('the page says plainly that validation accuracy is optimistic', async ({ page }) => {
  await page.goto('/project');
  const note = page.getByRole('note', { name: 'Read any accuracy here with care' });
  await expect(note).toBeVisible();
  await expect(note).toContainText('same capture sessions');
  await expect(note).toContainText('optimistic');
  // The model runs in the camera bridge on the laptop, not on a Nano.
  await expect(page.getByText(/model on the Nano|measured on the Nano/)).toHaveCount(0);
});

test('the contents list links to every section', async ({ page }) => {
  await page.goto('/project');
  const links = page.getByRole('navigation', { name: 'On this page' }).getByRole('link');
  await expect(links).toHaveText(SECTIONS);
  await links.filter({ hasText: 'Results' }).click();
  await expect(page).toHaveURL(/#results$/);
});

// The brief's four widths, plus 320: 1280 at 400% zoom, where WCAG 1.4.10 asks for reflow.
for (const [width, height] of [
  [1280, 800],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [320, 640],
] as const) {
  test(`the project page has no horizontal scroll at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/project');
    await expect(page.getByRole('img', { name: 'How one item gets sorted' })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
  });
}

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
