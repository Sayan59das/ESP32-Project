import { expect, type Page, test } from '@playwright/test';

const API = 'http://127.0.0.1:8000';

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  if (b === null) throw new Error(`${testId} is not visible`);
  return b;
}

async function firstThumbnail(page: Page) {
  const thumb = page.getByRole('button', { name: /^Show the frame for/ }).first();
  await expect(thumb).toBeVisible({ timeout: 45_000 }); // sim events come every 3 to 9 s
  return thumb;
}

test.describe('console against the simulator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/console');
  });

  test('the camera window is square', async ({ page }) => {
    const v = await box(page, 'camera-viewport');
    expect(Math.abs(v.width - v.height)).toBeLessThanOrEqual(1);
  });

  test('the bin readout sits under the camera window, edge to edge, at 1920 wide', async ({
    page,
  }) => {
    const v = await box(page, 'camera-viewport');
    const r = await box(page, 'bin-readout');
    expect(r.y).toBeGreaterThanOrEqual(v.y + v.height - 0.5);
    expect(r.y - (v.y + v.height)).toBeLessThanOrEqual(1); // flush: nothing between them
    expect(Math.abs(r.x - v.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.x + r.width - (v.x + v.width))).toBeLessThanOrEqual(1);
  });

  test('the console fits 1920x1080 without page scroll', async ({ page }) => {
    await firstThumbnail(page);
    const size = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }));
    expect(size).toEqual({ w: 1920, h: 1080 });
  });

  test('the counts on screen add up to total_sorted from the API', async ({ page, request }) => {
    await firstThumbnail(page);
    await expect
      .poll(
        async () => {
          const state = (await (await request.get(`${API}/api/state`)).json()) as {
            counts: { total_sorted: number };
          };
          const recyclable = Number(await page.getByTestId('count-recyclable').textContent());
          const trash = Number(await page.getByTestId('count-trash').textContent());
          return recyclable + trash === state.counts.total_sorted;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
  });

  test('the simulated data banner is visible', async ({ page }) => {
    await expect(
      page.getByRole('banner').getByText('Simulated data', { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('camera-viewport').getByText('Simulated data')).toBeVisible();
  });

  test('a log thumbnail opens a dialog with the 96x96 frame, and Escape closes it', async ({
    page,
  }) => {
    const thumb = await firstThumbnail(page);
    await thumb.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const image = dialog.getByRole('img');
    await expect(image).toBeVisible();
    const natural = await image.evaluate((img: HTMLImageElement) =>
      img.complete ? [img.naturalWidth, img.naturalHeight] : null,
    );
    expect(natural).toEqual([96, 96]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('Start new run asks first, and Keep current run changes nothing', async ({ page }) => {
    await page.getByRole('button', { name: 'Start new run' }).click();
    const dialog = page.getByRole('dialog', { name: 'Start a new run?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep current run' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep current run' }).click();
    await expect(dialog).toBeHidden();
  });

  test('reduced motion removes the slide and the fades', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const transition = await page
      .getByRole('region', { name: 'Recyclable' })
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transition).toBe('0s');
  });
});

// The highlight appears only when a count changes after the page loads; sim events come
// every 3 to 9 s.
async function highlightMs(page: Page): Promise<number> {
  const flash = page.getByTestId('count-highlight').first();
  await expect(flash).toBeAttached({ timeout: 45_000 });
  return flash.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) * 1000);
}

test('a count change is highlighted for no more than 300 ms', async ({ page }) => {
  await page.goto('/console');
  const ms = await highlightMs(page);
  expect(ms).toBeGreaterThan(0);
  expect(ms).toBeLessThanOrEqual(300);
});

test('reduced motion removes the count-change highlight', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/console');
  expect(await highlightMs(page)).toBe(0);
});

test('with WCAG 1.4.12 text spacing the counters still fit inside their tiles', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/console');
  await firstThumbnail(page);
  await page.addStyleTag({
    content:
      '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        ['recyclable', 'trash'].every((bin) => {
          const digits = document.querySelector(`[data-testid="count-${bin}"]`);
          const tile = digits?.closest('section');
          if (!digits || !tile) return false;
          const d = digits.getBoundingClientRect();
          const t = tile.getBoundingClientRect();
          return d.left >= t.left - 0.5 && d.right <= t.right + 0.5;
        }),
      ),
    )
    .toBe(true);
});

// The brief's four widths, plus 320: 1280 at 400% zoom, where WCAG 1.4.10 asks for reflow.
for (const [width, height] of [
  [1280, 800],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [320, 640],
] as const) {
  test(`no horizontal scroll at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/console');
    await firstThumbnail(page);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
  });
}
