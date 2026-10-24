import { expect, type Page, test } from '@playwright/test';

async function firstThumbnail(page: Page) {
  const thumb = page.getByRole('button', { name: /^Show the frame for/ }).first();
  await expect(thumb).toBeVisible({ timeout: 45_000 }); // sim events come every 3 to 9 s
  return thumb;
}

for (const path of ['/console', '/project', '/', '/testing']) {
  test(`on ${path} the first Tab reaches a visible skip link into the main content`, async ({
    page,
  }) => {
    await page.goto(path);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await page.keyboard.press('Tab');
    // The next stop is inside main, not back in the header.
    expect(await page.evaluate(() => document.activeElement?.closest('main') !== null)).toBe(true);
  });
}

test('the new-run dialog keeps Tab inside and gives focus back on Escape', async ({ page }) => {
  await page.goto('/console');
  const start = page.getByRole('button', { name: 'Start new run' });
  await start.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Start a new run?' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(start).toBeFocused();
});

test('the frame dialog gives focus back to its thumbnail', async ({ page }) => {
  await page.goto('/console');
  const thumb = await firstThumbnail(page);
  const name = (await thumb.getAttribute('aria-label')) ?? '';
  const same = page.getByRole('button', { name, exact: true });
  await same.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(same).toBeFocused();
});

test('pausing the preview stops the picture on this screen but not the counting', async ({
  page,
}) => {
  await page.goto('/console');
  await firstThumbnail(page);
  const viewport = page.getByTestId('camera-viewport');
  const live = viewport.getByRole('img', { name: /^Live classifier view/ });
  await expect(live).toBeAttached();
  const sorted = async () => {
    const text =
      (await page
        .getByRole('banner')
        .getByText(/sorted$/)
        .textContent()) ?? '';
    return Number(/(\d+) sorted/.exec(text)?.[1] ?? NaN);
  };
  const before = await sorted();

  await page.getByRole('button', { name: 'Pause preview' }).click();
  await expect(page.getByRole('button', { name: 'Resume preview' })).toBeFocused();
  const pausedNote = viewport.getByText(/^Counting continues and verdicts still show/);
  await expect(pausedNote).toBeVisible();
  await expect(live).toHaveCount(0);
  // The server keeps counting while the picture is paused.
  await expect.poll(sorted, { timeout: 30_000 }).toBeGreaterThan(before);

  await page.getByRole('button', { name: 'Resume preview' }).click();
  await expect(live).toBeAttached();
  await expect(pausedNote).toHaveCount(0);
});

test('every page has its own title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('EcoSort Edge');
  await page.goto('/console');
  await expect(page).toHaveTitle('Console, EcoSort Edge');
  await page.goto('/testing');
  await expect(page).toHaveTitle('Testing, EcoSort Edge');
  await page.goto('/project');
  await expect(page).toHaveTitle('Project, EcoSort Edge');
  await page.goto('/no-such-page');
  await expect(page).toHaveTitle('Page not found, EcoSort Edge');
});
