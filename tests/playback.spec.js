const { test, expect } = require('@playwright/test');
const { openApp, usePads, addTonePad, playing, pad, focusPage } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await usePads(page, ['Kick', 'Snare', 'Hi-hat', 'Coin']);
});

test('clicking a pad plays only that pad, until it ends', async ({ page }) => {
  await pad(page, 'Kick').locator('.play').click();
  await expect.poll(() => playing(page)).toEqual(['Kick']);
  await expect(pad(page, 'Kick')).toHaveClass(/playing/);
  // Kick lasts half a second.
  await expect.poll(() => playing(page), { timeout: 3000 }).toEqual([]);
  await expect(pad(page, 'Kick')).not.toHaveClass(/playing/);
});

test('a key press plays its pad, and keypad digits count as the same key', async ({ page }) => {
  await focusPage(page);
  await page.keyboard.press('2');
  await expect.poll(() => playing(page)).toContain('Snare');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Numpad3');
  await expect.poll(() => playing(page)).toContain('Hi-hat');
});

test('starting other pads never interrupts a pad that is already playing', async ({ page }) => {
  await addTonePad(page, 'Tone', { tone: 2, loop: true, key: 9 });
  await focusPage(page);
  await page.keyboard.press('9');
  await expect.poll(() => playing(page)).toContain('Tone');

  // Listen to the tone's own output while other pads are hammered.
  await page.evaluate(() => {
    const tone = [...sounds.values()].find((e) => e.sound.name === 'Tone');
    const analyser = getAudioContext().createAnalyser();
    analyser.fftSize = 512;
    tone.voice.gain.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    window.__toneVoice = tone.voice;
    window.__levels = [];
    window.__meter = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      window.__levels.push(Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length));
    }, 5);
  });
  await page.waitForTimeout(100);

  for (let round = 0; round < 3; round++) {
    for (const key of ['1', '2', '3', '4']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(20);
    }
    await pad(page, 'Snare').locator('.play').click();
    await pad(page, 'Coin').locator('.play').click();
  }
  // Three keys at once.
  for (const key of ['1', '2', '3']) await page.keyboard.down(key);
  for (const key of ['1', '2', '3']) await page.keyboard.up(key);
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    clearInterval(window.__meter);
    const tone = [...sounds.values()].find((e) => e.sound.name === 'Tone');
    const levels = window.__levels.slice(2);
    return { samples: levels.length, min: Math.min(...levels), max: Math.max(...levels), sameVoice: tone.voice === window.__toneVoice };
  });
  expect(result.samples).toBeGreaterThan(20);
  expect(result.sameVoice).toBe(true);
  // A 0.3 sine has an RMS of ~0.21: it must never dip.
  expect(result.min).toBeGreaterThan(0.18);
  expect(result.max).toBeLessThan(0.24);
});

test('a looping pad keeps playing and stops when pressed again', async ({ page }) => {
  await addTonePad(page, 'Loop', { tone: 0.3, loop: true, key: 9 });
  await focusPage(page);
  await page.keyboard.press('9');
  await page.waitForTimeout(800); // well past the 0.3 s sound
  expect(await playing(page)).toContain('Loop');
  await expect(pad(page, 'Loop')).toHaveClass(/looping/);
  await page.keyboard.press('9');
  await expect.poll(() => playing(page)).not.toContain('Loop');
});

test('Esc and "Stop all" stop every sound', async ({ page }) => {
  await addTonePad(page, 'Long', { tone: 3, key: 9 });
  await focusPage(page);
  await page.keyboard.press('9');
  await page.keyboard.press('1');
  await expect.poll(async () => (await playing(page)).length).toBe(2);
  await page.keyboard.press('Escape');
  await expect.poll(() => playing(page)).toEqual([]);

  await page.keyboard.press('9');
  await expect.poll(() => playing(page)).toContain('Long');
  await page.locator('#stopAllBtn').click();
  await expect.poll(() => playing(page)).toEqual([]);
});

test('the volume slider drives the master volume and is remembered', async ({ page }) => {
  // Real keyboard input on the slider: Home → 0, then 25 steps of 0.01.
  await page.locator('#masterVolume').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowRight');
  await pad(page, 'Kick').locator('.play').click();
  await expect.poll(() => page.evaluate(() => masterGain.gain.value)).toBeCloseTo(0.25, 2);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await expect(page.locator('#masterVolume')).toHaveValue('0.25');
});
