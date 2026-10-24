import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s), ${v.help}`);
}

async function open(page: Page, path: string) {
  await page.goto(path);
  if (path === '/console') {
    // Wait for live data so the scan covers the log, its thumbnails and the readout.
    await expect(page.getByRole('button', { name: /^Show the frame for/ }).first()).toBeVisible({
      timeout: 45_000,
    });
  }
}

// Both themes, at the desktop and the phone layout: contrast differs by theme, and the
// phone layout folds columns away.
for (const path of ['/console', '/project', '/', '/testing']) {
  for (const scheme of ['light', 'dark'] as const) {
    for (const [width, height] of [
      [1920, 1080],
      [390, 844],
    ] as const) {
      test(`${path} has no accessibility violations, ${scheme}, ${width} wide (axe, WCAG 2.2 AA)`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await open(page, path);
        expect(await violations(page)).toEqual([]);
      });
    }
  }
}

// Scan a dialog once it has finished easing in: mid-fade its text is part transparent, and
// contrast is a property of what stays on screen.
async function settled(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
}

test('both dialogs have no accessibility violations while open', async ({ page }) => {
  await open(page, '/console');
  await page.getByRole('button', { name: 'Start new run' }).click();
  await settled(page);
  expect(await violations(page)).toEqual([]);
  await page.keyboard.press('Escape');

  await page
    .getByRole('button', { name: /^Show the frame for/ })
    .first()
    .click();
  await settled(page);
  expect(await violations(page)).toEqual([]);
});

test('a paused preview has no accessibility violations', async ({ page }) => {
  await open(page, '/console');
  await page.getByRole('button', { name: 'Pause preview' }).click();
  await expect(
    page.getByTestId('camera-viewport').getByText(/^Counting continues and verdicts still show/),
  ).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
