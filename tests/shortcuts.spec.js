const { test, expect } = require('./fixtures');
const { openApp, usePads, playing, pad, focusPage, openPadMenu } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await usePads(page, ['Kick', 'Snare', 'Hi-hat']);
});

const keyOf = (page, name) =>
  page.evaluate((name) => [...sounds.values()].find((e) => e.sound.name === name).sound.code, name);

async function startAssigning(page, name) {
  await openPadMenu(page, name);
  await page.locator('#padMenu [data-action="assign"]').click();
  await expect(pad(page, name)).toHaveClass(/assigning/);
}

test('assigning a key with the real keyboard, then playing it', async ({ page }) => {
  await startAssigning(page, 'Kick');
  await page.keyboard.press('q');
  await expect(pad(page, 'Kick')).not.toHaveClass(/assigning/);
  await expect(pad(page, 'Kick').locator('.key')).toHaveText('Q');
  expect(await keyOf(page, 'Kick')).toBe('KeyQ');
  await page.keyboard.press('q');
  await expect.poll(() => playing(page)).toContain('Kick');
});

test('a keypad digit is saved as that digit', async ({ page }) => {
  await startAssigning(page, 'Kick');
  await page.keyboard.press('Numpad7');
  await expect(pad(page, 'Kick').locator('.key')).toHaveText('7');
  await page.keyboard.press('7'); // top-row 7 plays it too
  await expect.poll(() => playing(page)).toContain('Kick');
});

test('Esc cancels and Backspace removes the shortcut', async ({ page }) => {
  await startAssigning(page, 'Kick');
  await page.keyboard.press('Escape');
  await expect(pad(page, 'Kick')).not.toHaveClass(/assigning/);
  expect(await keyOf(page, 'Kick')).toBe('Digit1');

  await startAssigning(page, 'Kick');
  await page.keyboard.press('Backspace');
  await expect(pad(page, 'Kick').locator('.key')).toHaveText('');
  expect(await keyOf(page, 'Kick')).toBeNull();
});

test('a key moves to the pad it is assigned to', async ({ page }) => {
  await startAssigning(page, 'Hi-hat');
  await page.keyboard.press('1'); // Kick's key
  expect(await keyOf(page, 'Hi-hat')).toBe('Digit1');
  expect(await keyOf(page, 'Kick')).toBeNull();
  await page.keyboard.press('1');
  await expect.poll(() => playing(page)).toEqual(['Hi-hat']);
});

test('reserved keys are refused', async ({ page }) => {
  await startAssigning(page, 'Kick');
  // The alert blocks the page, so it is answered as soon as it shows up.
  const messages = [];
  page.on('dialog', (dialog) => messages.push(dialog.message()) && dialog.dismiss());
  await page.keyboard.press('r');
  await expect.poll(() => messages).toEqual([expect.stringContaining('reserved')]);
  expect(await keyOf(page, 'Kick')).toBe('Digit1');
});

test('shortcuts keep working after using the language menu and the volume slider', async ({ page }) => {
  await page.locator('#languageButton').click();
  await page.locator('#languageList li[data-code="it"]').click();
  await page.keyboard.press('2');
  await expect.poll(() => playing(page)).toContain('Snare');

  await page.locator('#masterVolume').focus();
  await page.keyboard.press('3');
  await expect.poll(() => playing(page)).toContain('Hi-hat');
});

test('a failed save never leaves the pad stuck waiting for a key', async ({ page }) => {
  await page.evaluate(() => {
    db.put = () => Promise.reject(new DOMException('Simulated failure', 'UnknownError'));
  });
  await startAssigning(page, 'Kick');
  const messages = [];
  page.on('dialog', (dialog) => messages.push(dialog.message()) && dialog.dismiss());
  await page.keyboard.press('w');
  await expect.poll(() => messages).toEqual([expect.stringContaining('Simulated failure')]);
  await expect(pad(page, 'Kick')).not.toHaveClass(/assigning/);
  await page.keyboard.press('w');
  await expect.poll(() => playing(page)).toContain('Kick');
});

test('typing in a text field does not trigger pads', async ({ page }) => {
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'probe';
    document.body.append(input);
  });
  await page.locator('#probe').fill('');
  await page.locator('#probe').press('1');
  await page.waitForTimeout(150);
  expect(await playing(page)).toEqual([]);
  await focusPage(page);
  await page.keyboard.press('1');
  await expect.poll(() => playing(page)).toContain('Kick');
});
