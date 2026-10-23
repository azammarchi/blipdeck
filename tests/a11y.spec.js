// Accessibility: automated WCAG 2.1 AA checks with axe-core on every view,
// plus what axe can't check: doing everything from the keyboard, screen
// reader announcements and reduced motion.
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('./fixtures');
const { openApp, usePads, addTonePad, padNames, pad, openPadMenu, focusPage } = require('./helpers');

async function expectNoViolations(page, view) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${view}: ${v.id} (${v.impact}) ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

test.describe('axe finds no WCAG 2.1 AA problems', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await usePads(page, ['Ding', 'Kick', 'Snare', 'Hi-hat', 'Laser', 'Coin', 'Whoosh', 'Power-up']);
  });

  test('main view, menus and dialogs', async ({ page }) => {
    await expectNoViolations(page, 'main view');

    await openPadMenu(page, 'Kick');
    await expectNoViolations(page, 'pad menu');
    await page.keyboard.press('Escape');

    await page.locator('#languageButton').click();
    await expectNoViolations(page, 'language list');
    await page.keyboard.press('Escape');

    await openPadMenu(page, 'Ding');
    await page.locator('#padMenu [data-action="assign"]').click();
    await expectNoViolations(page, 'assigning a key');
    await page.keyboard.press('Escape');

    await openPadMenu(page, 'Ding');
    await page.locator('#padMenu [data-action="trim"]').click();
    await expect(page.locator('#trimDialog')).toBeVisible();
    await expectNoViolations(page, 'trim dialog');
  });

  test('right-to-left (Arabic)', async ({ page }) => {
    await page.locator('#languageButton').click();
    await page.locator('#languageList li[data-code="ar"]').click();
    await expectNoViolations(page, 'Arabic');
  });

  test('recording', async ({ page }) => {
    await page.evaluate(() => setRecordingUi(true));
    await expectNoViolations(page, 'recording');
    await page.evaluate(() => setRecordingUi(false));
  });
});

test('the online demo with the backup notice', async ({ page, baseURL }) => {
  await page.route('https://demo.test/**', async (route) => {
    const response = await route.fetch({
      url: route.request().url().replace('https://demo.test', baseURL),
      headers: { ...route.request().headers(), host: new URL(baseURL).host },
    });
    await route.fulfill({ response });
  });
  await openApp(page, 'https://demo.test/');
  await addTonePad(page, 'My take', { tone: 0.2 });
  await expect(page.locator('#backupNotice')).toBeVisible();
  await expectNoViolations(page, 'demo with backup notice');
});

test('pads can be reordered from the keyboard, through the menu', async ({ page }) => {
  await openApp(page);
  await usePads(page, ['Ding', 'Kick', 'Snare']);

  // The first pad can't move earlier: that item is disabled and skipped.
  await openPadMenu(page, 'Ding');
  await expect(page.locator('#padMenu [data-action="moveEarlier"]')).toBeDisabled();
  await page.locator('#padMenu [data-action="moveLater"]').focus();
  await page.keyboard.press('Enter');
  expect(await padNames(page)).toEqual(['Kick', 'Ding', 'Snare']);
  await expect(pad(page, 'Ding').locator('.play')).toBeFocused();
  await expect(page.locator('#announcer')).toHaveText('Ding moved to position 2');

  await openPadMenu(page, 'Snare');
  await expect(page.locator('#padMenu [data-action="moveLater"]')).toBeDisabled();
  await page.locator('#padMenu [data-action="moveEarlier"]').click();
  expect(await padNames(page)).toEqual(['Kick', 'Snare', 'Ding']);
  await expect.poll(() => page.evaluate(async () => (await db.all()).sort(byOrder).map((s) => s.name))).toEqual(['Kick', 'Snare', 'Ding']);
});

test('trimming works from the keyboard', async ({ page }) => {
  await openApp(page);
  await usePads(page, []);
  await addTonePad(page, 'Tone', { tone: 2 });
  await openPadMenu(page, 'Tone');
  await page.locator('#padMenu [data-action="trim"]').click();
  const start = page.locator('#trimHandleStart');
  const end = page.locator('#trimHandleEnd');
  await expect(start).toHaveAttribute('role', 'slider');
  await expect(start).toHaveAttribute('aria-label', 'Start');

  await start.focus();
  await page.keyboard.press('Shift+ArrowRight'); // +0.5 s
  await page.keyboard.press('ArrowRight'); // +0.05 s
  await expect(start).toHaveAttribute('aria-valuenow', '0.55');
  await end.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(end).toHaveAttribute('aria-valuenow', '1.50');
  await expect(page.locator('#trimLengthLabel')).toHaveText('0.95s');
  await page.keyboard.press('Home'); // can't cross the start handle
  await expect(end).toHaveAttribute('aria-valuenow', '0.60');
  await page.keyboard.press('End');
  await expect(end).toHaveAttribute('aria-valuenow', '2.00');

  await page.locator('#trimSaveBtn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#trimDialog')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => [...sounds.values()][0].buffer?.duration ?? 0))
    .toBeCloseTo(1.45, 1);
});

test('screen readers hear about recordings and shortcuts', async ({ page }) => {
  await openApp(page);
  await usePads(page, ['Kick']);
  await page.evaluate(() => setRecordingUi(true));
  await expect(page.locator('#announcer')).toHaveText('Recording…');
  await page.evaluate(() => setRecordingUi(false));

  await openPadMenu(page, 'Kick');
  await page.locator('#padMenu [data-action="assign"]').click();
  await page.keyboard.press('k');
  await expect(page.locator('#announcer')).toHaveText('Kick: shortcut K');
  await openPadMenu(page, 'Kick');
  await page.locator('#padMenu [data-action="assign"]').click();
  await page.keyboard.press('Backspace');
  await expect(page.locator('#announcer')).toHaveText('Kick: no shortcut');
});

test('icon-only buttons and controls have names', async ({ page }) => {
  await openApp(page);
  await usePads(page, ['Kick']);
  await expect(pad(page, 'Kick').locator('.more')).toHaveAccessibleName('More actions');
  await expect(page.locator('#masterVolume')).toHaveAccessibleName('Master volume');
  await page.locator('#languageButton').click();
  await expect(page.locator('#languageList')).toHaveAccessibleName('Language');
  await page.keyboard.press('Escape');
  await page.locator('#languageButton').click();
  await page.locator('#languageList li[data-code="it"]').click();
  await expect(pad(page, 'Kick').locator('.more')).toHaveAccessibleName('Altre azioni');
});

test('reduced motion turns off animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await page.evaluate(() => setRecordingUi(true));
  const animation = await page.locator('#recordBtn .dot').evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe('none');
  await page.evaluate(() => setRecordingUi(false));
  await focusPage(page);
});
