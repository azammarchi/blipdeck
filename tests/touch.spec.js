// Touch screens: a swipe scrolls, a long press lifts a pad, a tap plays it.
// Real touch input is sent through Chromium's DevTools protocol, so these
// tests run in Chromium only.
const { test, expect } = require('./fixtures');
const { openApp, usePads, playing, padNames, pad } = require('./helpers');

test.use({ viewport: { width: 390, height: 640 }, hasTouch: true });

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch input is driven through the Chromium DevTools protocol');
  await openApp(page);
  await usePads(page, ['Ding', 'Kick', 'Snare', 'Hi-hat', 'Laser', 'Coin', 'Whoosh', 'Power-up']);
});

async function touchscreen(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) });
  return {
    async press(x, y) {
      await send('touchStart', [[x, y]]);
    },
    async moveTo(fromX, fromY, toX, toY, steps = 10) {
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [[fromX + ((toX - fromX) * i) / steps, fromY + ((toY - fromY) * i) / steps]]);
        await page.waitForTimeout(16);
      }
    },
    async release() {
      await send('touchEnd', []);
    },
  };
}

async function centerOf(page, name) {
  const box = await pad(page, name).locator('.play').boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
}

test('a quick swipe over the pads scrolls the page', async ({ page }) => {
  const touch = await touchscreen(page);
  const [x, y] = await centerOf(page, 'Hi-hat');
  await touch.press(x, y);
  await touch.moveTo(x, y, x, y - 250);
  await touch.release();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
  expect(await padNames(page)).toEqual(['Ding', 'Kick', 'Snare', 'Hi-hat', 'Laser', 'Coin', 'Whoosh', 'Power-up']);
  expect(await playing(page)).toEqual([]);
});

test('a long press lifts the pad, then the finger drags it without scrolling', async ({ page }) => {
  const touch = await touchscreen(page);
  const [x, y] = await centerOf(page, 'Ding');
  const [tx, ty] = await centerOf(page, 'Hi-hat');
  await touch.press(x, y);
  await page.waitForTimeout(600);
  await expect(page.locator('.drag-ghost')).toBeVisible();
  await touch.moveTo(x, y, tx, ty);
  await touch.release();
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
  expect(await padNames(page)).toEqual(['Kick', 'Snare', 'Hi-hat', 'Ding', 'Laser', 'Coin', 'Whoosh', 'Power-up']);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await playing(page)).toEqual([]);
});

test('a tap plays the pad', async ({ page }) => {
  const touch = await touchscreen(page);
  const [x, y] = await centerOf(page, 'Kick');
  await touch.press(x, y);
  await touch.release();
  await expect.poll(() => playing(page)).toEqual(['Kick']);
  expect(await padNames(page)).toEqual(['Ding', 'Kick', 'Snare', 'Hi-hat', 'Laser', 'Coin', 'Whoosh', 'Power-up']);
});
