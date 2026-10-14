import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const path of ['/', '/project']) {
  test(`${path} has no accessibility violations (axe, WCAG 2.2 AA)`, async ({ page }) => {
    await page.goto(path);
    if (path === '/') {
      // Wait for live data so the scan covers the log, its thumbnails and the readout.
      await expect(page.getByRole('button', { name: /^Show the frame for/ }).first()).toBeVisible({
        timeout: 45_000,
      });
    }
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s), ${v.help}`);
    expect(summary).toEqual([]);
  });
}
