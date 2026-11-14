import { expect, test } from '@playwright/test';

test.describe('Basic PDF — Étape A1 (Mobile tactile)', () => {
  test('pincement tactile sur téléphone ajuste le zoom sans déborder', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Essayer un document d’exemple/i }).click();

    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toBeVisible();
    const zoomBefore = await page.locator('.zoom-readout').innerText();

    // Simule un pincement d'écartement à deux doigts (zoom avant)
    await viewer.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const t1Start = new Touch({ identifier: 1, target: el, clientX: cx - 25, clientY: cy });
      const t2Start = new Touch({ identifier: 2, target: el, clientX: cx + 25, clientY: cy });
      el.dispatchEvent(
        new TouchEvent('touchstart', {
          touches: [t1Start, t2Start],
          targetTouches: [t1Start, t2Start],
          changedTouches: [t1Start, t2Start],
          bubbles: true,
        }),
      );

      const t1Move = new Touch({ identifier: 1, target: el, clientX: cx - 75, clientY: cy });
      const t2Move = new Touch({ identifier: 2, target: el, clientX: cx + 75, clientY: cy });
      el.dispatchEvent(
        new TouchEvent('touchmove', {
          touches: [t1Move, t2Move],
          targetTouches: [t1Move, t2Move],
          changedTouches: [t1Move, t2Move],
          bubbles: true,
          cancelable: true,
        }),
      );

      el.dispatchEvent(
        new TouchEvent('touchend', {
          touches: [],
          targetTouches: [],
          changedTouches: [t1Move, t2Move],
          bubbles: true,
        }),
      );
    });

    const zoomAfter = await page.locator('.zoom-readout').innerText();
    expect(zoomAfter).not.toBe(zoomBefore);

    const overflowCheck = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflowCheck.scrollWidth).toBeLessThanOrEqual(overflowCheck.innerWidth);
  });
});
