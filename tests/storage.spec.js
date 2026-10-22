const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openApp, usePads, padNames, reloadWhenSaved, pad } = require('./helpers');

const keys = (page) =>
  page.evaluate(() => [...sounds.values()].map((e) => `${e.sound.name}=${e.sound.key ?? '-'}`));

test('first launch on the local server gets the single Ding pad', async ({ page }) => {
  await openApp(page);
  expect(await padNames(page)).toEqual(['Ding']);
  await expect(pad(page, 'Ding').locator('.key')).toHaveText('1');

  // Once deleted it never comes back.
  page.once('dialog', (dialog) => dialog.accept());
  await pad(page, 'Ding').locator('.more').click();
  await page.locator('#padMenu [data-action="delete"]').click();
  await reloadWhenSaved(page);
  expect(await padNames(page)).toEqual([]);
  await expect(page.locator('#emptyState')).toBeVisible();
});

const DEMO_PADS = ['Ding', 'Kick', 'Snare', 'Hi-hat', 'Laser', 'Coin', 'Whoosh', 'Power-up'];

// Serves the app under another host name, over HTTPS, as GitHub Pages does
// (plain http on a non-local host is not a secure context).
async function openDemo(page, baseURL) {
  await page.route('https://demo.test/**', async (route) => {
    const response = await route.fetch({ url: route.request().url().replace('https://demo.test', baseURL) });
    await route.fulfill({ response });
  });
  await openApp(page, 'https://demo.test/');
}

test('the online demo (any non-local host) starts with eight sample pads', async ({ page, baseURL }) => {
  const serverEvents = [];
  page.on('request', (request) => request.url().includes('/events') && serverEvents.push(request.url()));
  await openDemo(page, baseURL);
  expect(await padNames(page)).toEqual(DEMO_PADS);
  expect(await keys(page)).toEqual(['Ding=1', 'Kick=2', 'Snare=3', 'Hi-hat=4', 'Laser=5', 'Coin=6', 'Whoosh=7', 'Power-up=8']);
  expect(serverEvents).toEqual([]); // there is no local server to keep alive
  await expect(page.locator('#resetDemoBtn')).toBeVisible();
});

test('the local app has no "Reset demo" button', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#resetDemoBtn')).toBeHidden();
});

test('"Reset demo" asks first, then restores the original demo', async ({ page, baseURL }) => {
  await openDemo(page, baseURL);
  // Change a few things: delete a pad, switch language, lower the volume.
  page.once('dialog', (dialog) => dialog.accept());
  await pad(page, 'Kick').locator('.more').click();
  await page.locator('#padMenu [data-action="delete"]').click();
  await page.locator('#languageButton').click();
  await page.locator('#languageList li[data-code="it"]').click();
  await page.locator('#masterVolume').focus();
  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(async () => (await db.all()).length)).toBe(7);

  // Cancel keeps everything.
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#resetDemoBtn').click();
  expect(await padNames(page)).not.toContain('Kick');
  await expect(page.locator('#resetDemoBtn')).toHaveText('Ripristina demo');

  // OK brings back the first-visit demo.
  const messages = [];
  page.once('dialog', (dialog) => messages.push(dialog.message()) && dialog.accept());
  await page.locator('#resetDemoBtn').click();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true' && sounds.size === 8);
  expect(messages[0]).toContain('8');
  expect(await padNames(page)).toEqual(DEMO_PADS);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#masterVolume')).toHaveValue('1');
  expect(await page.evaluate(async () => (await db.all()).length)).toBe(8);
});

test('export and import round-trip names, keys and loop; import can add or replace', async ({ page }, testInfo) => {
  await openApp(page);
  await usePads(page, ['Kick', 'Snare']);
  await page.evaluate(async () => {
    const snare = [...sounds.values()].find((e) => e.sound.name === 'Snare');
    snare.sound.loop = true;
    await db.put(snare.sound);
  });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportBtn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^blipdeck-\d{4}-\d{2}-\d{2}\.json$/);
  const file = testInfo.outputPath('board.json');
  await download.saveAs(file);
  const bank = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(bank.format).toBe('blipdeck-bank');
  expect(bank.sounds.map((s) => `${s.name}:${s.key}:${s.loop}`)).toEqual(['Kick:1:false', 'Snare:2:true']);

  // Add: the imported keys are already taken, so the copies get none.
  await page.locator('#importInput').setInputFiles(file);
  await expect(page.locator('#importDialog')).toBeVisible();
  await expect(page.locator('#importHeading')).toHaveText('Import 2 sounds');
  await page.locator('#importDialog button[value="add"]').click();
  await expect.poll(() => keys(page)).toEqual(['Kick=1', 'Snare=2', 'Kick=-', 'Snare=-']);

  // Replace: back to exactly the exported board.
  await page.locator('#importInput').setInputFiles(file);
  await page.locator('#importDialog button[value="replace"]').click();
  await expect.poll(() => keys(page)).toEqual(['Kick=1', 'Snare=2']);
  await expect(pad(page, 'Snare')).toHaveClass(/looping/);

  // Imported audio is real audio.
  await page.locator('main').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('1');
  await expect.poll(() => page.evaluate(() => [...sounds.values()].some((e) => e.voice))).toBe(true);
});

test('files that are not a Blipdeck export are rejected', async ({ page }, testInfo) => {
  await openApp(page);
  const file = testInfo.outputPath('other.json');
  fs.writeFileSync(file, JSON.stringify({ hello: 'world' }));
  const dialog = page.waitForEvent('dialog');
  await page.locator('#importInput').setInputFiles(file);
  const message = await dialog;
  expect(message.message()).toContain('is not a soundboard exported from Blipdeck');
  await message.dismiss();
});

test('sounds and settings saved by the old "soundpad" version are migrated', async ({ page }) => {
  // Write data the way the old version did, on the same origin, before the app loads.
  await page.goto('/logo.svg');
  await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.start();
    const buffer = await ctx.startRendering();
    const samples = buffer.getChannelData(0);
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const text = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 44100, true); view.setUint32(28, 88200, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples.length * 2, true);
    samples.forEach((v, i) => view.setInt16(44 + i * 2, v * 0x7fff, true));
    const old = await new Promise((resolve) => {
      const req = indexedDB.open('soundpad', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sounds', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise((resolve) => {
      const tx = old.transaction('sounds', 'readwrite');
      // The old version stored a Blob, which WebKit's throwaway test profiles
      // can't hold; the migration reads raw bytes just the same.
      tx.objectStore('sounds').put({
        id: 'old-1', name: 'My old sound', audio: view.buffer, mimeType: 'audio/wav',
        duration: 0.1, color: '#ff7a59', code: 'KeyQ', key: 'q', loop: true, createdAt: 1,
      });
      tx.oncomplete = resolve;
    });
    old.close();
    localStorage.setItem('soundpad.seeded', '1');
    localStorage.setItem('soundpad.volume', '0.4');
    localStorage.setItem('soundpad.language', 'it');
  });

  await openApp(page);
  expect(await keys(page)).toEqual(['My old sound=q']);
  await expect(pad(page, 'My old sound')).toHaveClass(/looping/);
  await expect(page.locator('#masterVolume')).toHaveValue('0.4');
  await expect(page.locator('#recordLabel')).toHaveText('Registra');
  const leftovers = await page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map((d) => d.name),
    keys: Object.keys(localStorage).filter((k) => k.startsWith('soundpad.')),
  }));
  expect(leftovers.databases).not.toContain('soundpad');
  expect(leftovers.keys).toEqual([]);
});
