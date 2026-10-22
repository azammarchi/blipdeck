const { test, expect } = require('./fixtures');
const { openApp, usePads, playing } = require('./helpers');

test('every language has every string and a flag', async ({ page }) => {
  await openApp(page);
  const problems = await page.evaluate(() => {
    const english = Object.keys(LANGUAGES[DEFAULT_LANGUAGE].strings);
    const found = [];
    for (const [code, lang] of Object.entries(LANGUAGES)) {
      const keys = Object.keys(lang.strings);
      for (const key of english) if (!keys.includes(key)) found.push(`${code}: missing ${key}`);
      for (const key of keys) if (!english.includes(key)) found.push(`${code}: unknown ${key}`);
      if (!lang.name) found.push(`${code}: no name`);
      if (!/^<svg[\s\S]*<\/svg>$/.test(lang.flag || '')) found.push(`${code}: no flag`);
    }
    return found;
  });
  expect(problems).toEqual([]);
});

test('no element is left untranslated in any language', async ({ page }) => {
  await openApp(page);
  const empty = await page.evaluate(() => {
    const found = [];
    for (const code of Object.keys(LANGUAGES)) {
      applyLanguage(code);
      for (const el of [...document.querySelectorAll('[data-i18n], [data-i18n-html]'), ...template.content.querySelectorAll('[data-i18n]')]) {
        if (!el.textContent.trim()) found.push(`${code}: ${el.dataset.i18n || el.dataset.i18nHtml}`);
      }
    }
    applyLanguage(DEFAULT_LANGUAGE);
    return found;
  });
  expect(empty).toEqual([]);
});

test('English is the default and the choice is remembered', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#languageButton')).toContainText('English');

  await page.locator('#languageButton').click();
  await expect(page.locator('#languageList')).toBeVisible();
  await page.locator('#languageList li[data-code="de"]').click();
  await expect(page.locator('#recordLabel')).toHaveText('Aufnehmen');
  await expect(page.locator('#languageButton')).toContainText('Deutsch');

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('#recordLabel')).toHaveText('Aufnehmen');
});

test('Arabic switches the layout to right-to-left', async ({ page }) => {
  await openApp(page);
  await page.locator('#languageButton').click();
  await page.locator('#languageList li[data-code="ar"]').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  // The waveform still runs left to right.
  await expect(page.locator('.wave-wrap')).toHaveAttribute('dir', 'ltr');
});

test('the language list works from the keyboard', async ({ page }) => {
  await openApp(page);
  await usePads(page, ['Kick']);
  await page.locator('#languageButton').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#languageList li[data-code="en"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.locator('#languageButton')).toBeFocused();
  // and the pads' shortcuts still respond afterwards
  await page.keyboard.press('1');
  await expect.poll(() => playing(page)).toEqual(['Kick']);
});
