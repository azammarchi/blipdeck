const { test, expect } = require('./fixtures');
const { openApp, usePads, addTonePad, playing, pad, openPadMenu, focusPage } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await usePads(page, []);
  // 0.5 s silence, 1 s tone, 0.5 s silence.
  await addTonePad(page, 'Padded', { silence: 0.5, tone: 1, key: 1 });
});

const bufferLength = (page, name) =>
  page.evaluate((name) => [...sounds.values()].find((e) => e.sound.name === name).buffer?.duration ?? null, name);

async function openTrimFor(page, name) {
  await openPadMenu(page, name);
  await page.locator('#padMenu [data-action="trim"]').click();
  await expect(page.locator('#trimDialog')).toBeVisible();
}

test('"Remove silence" cuts the silent edges, and saving keeps the result', async ({ page }) => {
  await openTrimFor(page, 'Padded');
  await expect(page.locator('#trimLengthLabel')).toHaveText('2.00s');
  await page.locator('#trimAutoBtn').click();
  // The tone plus 0.05 s of margin on each side.
  await expect(page.locator('#trimLengthLabel')).toHaveText('1.10s');
  await page.locator('#trimSaveBtn').click();
  await expect(page.locator('#trimDialog')).toBeHidden();

  await expect.poll(() => bufferLength(page, 'Padded')).toBeCloseTo(1.1, 1);
  await expect(pad(page, 'Padded').locator('.duration')).toHaveText('1.1s');

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await expect.poll(() => bufferLength(page, 'Padded')).toBeCloseTo(1.1, 1);
});

test('dragging a handle with the mouse picks the part to keep', async ({ page }) => {
  await openTrimFor(page, 'Padded');
  const wave = await page.locator('.wave-wrap').boundingBox();
  // Drag the start handle to the middle (1.00 s of 2.00 s).
  await page.mouse.move(wave.x + 2, wave.y + wave.height / 2);
  await page.mouse.down();
  await page.mouse.move(wave.x + wave.width / 2, wave.y + wave.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#trimStartLabel')).toHaveText(/^(0\.9\d|1\.0\d)s$/);
  await page.locator('#trimSaveBtn').click();
  await expect.poll(() => bufferLength(page, 'Padded')).toBeCloseTo(1, 1);
});

test('preview plays the selection and Cancel changes nothing', async ({ page }) => {
  await openTrimFor(page, 'Padded');
  await page.locator('#trimPreviewBtn').click();
  await expect(page.locator('#trimPreviewBtn')).toHaveText('Stop');
  await expect(page.locator('#trimPlayhead')).toBeVisible();
  await page.locator('#trimPreviewBtn').click();
  await expect(page.locator('#trimPreviewBtn')).toHaveText('Preview');

  await page.locator('#trimAutoBtn').click();
  await page.locator('#trimDialog button[value="cancel"]').click();
  await expect(page.locator('#trimDialog')).toBeHidden();
  expect(await bufferLength(page, 'Padded')).toBeCloseTo(2, 1);
});

test('the trimmed sound plays from its shortcut', async ({ page }) => {
  await openTrimFor(page, 'Padded');
  await page.locator('#trimAutoBtn').click();
  await page.locator('#trimSaveBtn').click();
  await focusPage(page);
  await page.keyboard.press('1');
  await expect.poll(() => playing(page)).toEqual(['Padded']);
});

test('recordings are saved without their silent edges', async ({ page, browserName }) => {
  // A fake microphone: 0.6 s silence, 0.6 s tone, then silence until stopped.
  // Its audio engine is created when the app asks for the microphone, i.e.
  // during the click: WebKit keeps engines created outside a gesture frozen.
  // It goes on the prototype: WebKit may hand out a fresh navigator.mediaDevices
  // object later on, without anything attached to the old one.
  await page.evaluate(() => {
    Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable: true, value: async () => {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain).connect(dest);
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.setValueAtTime(0.5, t + 0.6);
      gain.gain.setValueAtTime(0, t + 1.2);
      osc.start();
      return dest.stream;
    } });
  });
  test.skip(
    !(await page.evaluate(() => typeof MediaRecorder !== 'undefined')),
    `MediaRecorder is not available in this ${browserName} build`,
  );
  await page.locator('#recordBtn').click();
  await expect(page.locator('#recordBtn')).toHaveClass(/recording/);
  await page.waitForTimeout(2000);
  await page.locator('#recordBtn').click();
  await expect(pad(page, 'Sound 2')).toHaveCount(1, { timeout: 10_000 });
  await expect.poll(() => bufferLength(page, 'Sound 2')).toBeGreaterThan(0);
  const seconds = await bufferLength(page, 'Sound 2');
  // About 0.6 s of tone plus margins, far less than the 2 s recorded.
  expect(seconds).toBeGreaterThan(0.5);
  expect(seconds).toBeLessThan(1.2);
});
