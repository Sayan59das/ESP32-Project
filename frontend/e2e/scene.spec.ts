import fs from 'node:fs';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

// The two 3D pages, the home story and the testing story. The world is decoration over words
// that stand on their own, so these tests are about what must hold whatever the picture does:
// it appears when it can, it can be stopped, it respects the reader's motion setting, nothing it
// pins to the scene lands on the words, nothing scrolls sideways, and nothing leaves the machine.

const PAGES = [
  { path: '/', scene: 'home', chapters: 8 },
  { path: '/testing', scene: 'testing', chapters: 6 },
] as const;

const stage = (page: Page) => page.locator('[data-scene]');

async function ready(page: Page) {
  await expect(stage(page)).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(stage(page)).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

for (const { path: route, scene } of PAGES) {
  test.describe(`the ${scene} story at ${route}`, () => {
    test('draws its 3D world, and names the quality it is drawing at', async ({ page }) => {
      await page.goto(route);
      await ready(page);
      await expect(stage(page)).toHaveAttribute('data-quality', /^(high|medium|low)$/);
      await expect(stage(page)).toHaveAttribute('data-renderer', /^(gpu|software)$/);
      const size = await page.locator('[data-scene] canvas').evaluate((c) => ({
        w: (c as HTMLCanvasElement).width,
        h: (c as HTMLCanvasElement).height,
      }));
      expect(size.w).toBeGreaterThan(300);
      expect(size.h).toBeGreaterThan(300);
    });

    test('keeps still for a reader who asked for less motion', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(route);
      await ready(page);
      await expect(stage(page)).toHaveAttribute('data-motion', 'still');
    });

    test('moves by default, can be paused and played, and remembers which', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(route);
      await ready(page);
      await expect(stage(page)).toHaveAttribute('data-motion', 'animated');
      await page.getByRole('button', { name: 'Pause animation' }).click();
      await expect(stage(page)).toHaveAttribute('data-motion', 'still');
      await expect(page.getByRole('button', { name: 'Play animation' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.reload();
      await ready(page);
      await expect(stage(page)).toHaveAttribute('data-motion', 'still');
      await page.getByRole('button', { name: 'Play animation' }).click();
      await expect(stage(page)).toHaveAttribute('data-motion', 'animated');
    });

    test('never scrolls sideways, from a desktop down to a very small phone', async ({ page }) => {
      for (const [width, height] of [
        [1920, 1080],
        [1280, 800],
        [1024, 768],
        [768, 1024],
        [390, 844],
        [320, 640],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.goto(route);
        await ready(page);
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(over, `${width} wide`).toBeLessThanOrEqual(0);
      }
    });

    test('the chapter dots are real links that scroll to their chapter', async ({ page }) => {
      await page.goto(route);
      await ready(page);
      const dots = page.getByRole('navigation', { name: 'Story chapters' }).getByRole('link');
      await expect(dots.first()).toHaveAttribute('aria-current', 'step');
      await dots.nth(2).click();
      await expect(dots.nth(2)).toHaveAttribute('aria-current', 'step', { timeout: 10_000 });
      await expect(page).toHaveURL(/#chapter-2$/);
    });

    test('without WebGL the words are all still there and nothing is broken', async ({ page }) => {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          type: string,
          ...rest: unknown[]
        ) {
          if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
          return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
        } as typeof original;
      });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(route);
      await expect(stage(page)).toHaveAttribute('data-state', 'unavailable', { timeout: 30_000 });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: /animation$/ })).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test('labels pinned to the scene stay on screen and off the words', async ({ page }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      const chapters = PAGES.find((p) => p.path === route)?.chapters ?? 0;
      for (let n = 0; n < chapters; n++) {
        await page.goto(`${route}?frame=${n + 0.5}&time=10&quality=low`);
        await ready(page);
        await page.evaluate((index) => {
          const section = document.querySelector(`[data-chapter="${index}"]`);
          if (!section) return;
          const box = section.getBoundingClientRect();
          window.scrollTo(0, window.scrollY + box.top + box.height / 2 - window.innerHeight / 2);
        }, n);
        await page.waitForTimeout(600);
        const problems = await page.evaluate(() => {
          const rect = (el: Element) => el.getBoundingClientRect();
          const words = [...document.querySelectorAll('[data-avoid]')]
            .map(rect)
            .filter((r) => r.width > 0);
          const out: string[] = [];
          for (const tag of document.querySelectorAll<HTMLElement>('[data-anchor]')) {
            const style = getComputedStyle(tag);
            if (style.visibility === 'hidden' || Number(style.opacity) < 0.6) continue;
            const box = tag.querySelector('[data-text]');
            if (!box) continue;
            const r = rect(box);
            const name = tag.dataset.anchor;
            if (r.left < 0 || r.right > window.innerWidth) out.push(`${name} is off the sides`);
            if (r.top < 64 || r.bottom > window.innerHeight)
              out.push(`${name} is off the top or bottom`);
            for (const w of words) {
              const hit =
                r.left < w.right && r.right > w.left && r.top < w.bottom && r.bottom > w.top;
              if (hit) out.push(`${name} is on top of the words`);
            }
          }
          return out;
        });
        expect(problems, `chapter ${n}`).toEqual([]);
      }
    });
  });
}

test.describe('the testing page shows only what was recorded', () => {
  const file = path.resolve(__dirname, '../../data/testing.json');
  const recorded = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    suites?: { id: string; label: string; passed: number; failed: number }[];
    scenarios?: { title: string; passed: boolean; counted: number }[];
    media?: unknown[];
  };

  test('its totals are the sums of the recorded suites', async ({ page }) => {
    const suites = recorded.suites ?? [];
    const passed = suites.reduce((n, s) => n + s.passed, 0);
    const failed = suites.reduce((n, s) => n + s.failed, 0);
    await page.goto('/testing');
    const figures = page.getByRole('main').locator('dl').first();
    await expect(figures.getByText('automated checks passed').locator('..')).toContainText(
      passed.toLocaleString('en-GB'),
    );
    await expect(figures.getByText('failed', { exact: true }).locator('..')).toContainText(
      failed.toLocaleString('en-GB'),
    );
  });

  test('every recorded suite and scenario appears in the full results with its figures', async ({
    page,
  }) => {
    await page.goto('/testing');
    const results = page.locator('#results');
    for (const s of recorded.suites ?? []) {
      const card = results.getByRole('listitem').filter({ hasText: s.label }).first();
      await expect(card).toContainText(String(s.passed));
    }
    const scenarios = recorded.scenarios ?? [];
    for (const s of scenarios) {
      const card = results.getByRole('listitem').filter({ hasText: s.title }).first();
      await expect(card).toContainText(s.passed ? 'Passed' : 'Failed');
    }
    // The recorded run is also part of the page, so a reader can tell how old it is.
    await expect(results).toContainText('Recorded');
  });

  test('photographs and video that were not added are marked "Not added yet"', async ({ page }) => {
    test.skip(
      (recorded.media ?? []).length > 0,
      'media has been added, so there are no empty slots',
    );
    await page.goto('/testing');
    await expect(page.locator('#results').getByText('Not added yet')).toHaveCount(2);
  });
});
