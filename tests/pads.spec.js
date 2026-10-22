const { test, expect } = require('@playwright/test');
const { openApp, usePads, playing, padNames, reloadWhenSaved, pad, openPadMenu } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await usePads(page, ['Ding', 'Kick', 'Snare', 'Hi-hat', 'Laser']);
});

async function centerOf(page, name) {
  const box = await pad(page, name).locator('.play').boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('dragging a pad reorders it right away, without holding first', async ({ page }) => {
  const from = await centerOf(page, 'Ding');
  const to = await centerOf(page, 'Hi-hat');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(page.locator('.drag-ghost')).toBeVisible();
  await page.mouse.up();

  await expect(page.locator('.drag-ghost')).toHaveCount(0);
  expect(await padNames(page)).toEqual(['Kick', 'Snare', 'Hi-hat', 'Ding', 'Laser']);
  expect(await playing(page)).toEqual([]); // releasing a drag doesn't play

  await reloadWhenSaved(page);
  expect(await padNames(page)).toEqual(['Kick', 'Snare', 'Hi-hat', 'Ding', 'Laser']);
});

test('a click with a small wobble still plays instead of dragging', async ({ page }) => {
  const { x, y } = await centerOf(page, 'Kick');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 3, y + 2);
  await page.mouse.up();
  await expect.poll(() => playing(page)).toEqual(['Kick']);
  expect(await padNames(page)).toEqual(['Ding', 'Kick', 'Snare', 'Hi-hat', 'Laser']);
});

test('the pad menu: loop, rename and delete', async ({ page }) => {
  await openPadMenu(page, 'Kick');
  await page.locator('#padMenu [data-action="loop"]').click();
  await expect(page.locator('#padMenu')).toBeHidden();
  await expect(pad(page, 'Kick')).toHaveClass(/looping/);
  await openPadMenu(page, 'Kick');
  await expect(page.locator('#padMenu [data-action="loop"]')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  page.once('dialog', (dialog) => dialog.accept('Big kick'));
  await openPadMenu(page, 'Kick');
  await page.locator('#padMenu [data-action="rename"]').click();
  await expect(pad(page, 'Big kick')).toHaveCount(1);

  page.once('dialog', (dialog) => dialog.accept());
  await openPadMenu(page, 'Snare');
  await page.locator('#padMenu [data-action="delete"]').click();
  await expect(pad(page, 'Snare')).toHaveCount(0);

  // Loop and rename are saved too.
  await expect.poll(() => page.evaluate(async () => (await db.all()).find((s) => s.name === 'Big kick')?.loop)).toBe(true);
  await reloadWhenSaved(page);
  expect(await padNames(page)).toEqual(['Ding', 'Big kick', 'Hi-hat', 'Laser']);
  await expect(pad(page, 'Big kick')).toHaveClass(/looping/);
});

test('the pad menu works from the keyboard and closes on outside clicks', async ({ page }) => {
  await openPadMenu(page, 'Kick');
  await expect(page.locator('#padMenu [data-action="assign"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#padMenu [data-action="trim"]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#padMenu [data-action="delete"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#padMenu')).toBeHidden();
  await expect(pad(page, 'Kick').locator('.more')).toBeFocused();

  await openPadMenu(page, 'Kick');
  await page.locator('main').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('#padMenu')).toBeHidden();
});

test('pressing Esc in an open menu closes it without stopping sounds', async ({ page }) => {
  await pad(page, 'Ding').locator('.play').click();
  await openPadMenu(page, 'Kick');
  await page.keyboard.press('Escape');
  await expect(page.locator('#padMenu')).toBeHidden();
  expect(await playing(page)).toContain('Ding');
});
