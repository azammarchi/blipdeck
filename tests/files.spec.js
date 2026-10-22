// The local app saves sounds as files in sounds/ through server.js.
const fs = require('fs');
const path = require('path');
const { test, expect, startServer } = require('./fixtures');
const { openApp, usePads, padNames, pad, openPadMenu, reloadWhenSaved } = require('./helpers');

const board = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'board.json'), 'utf8'));
const audioFiles = (dir) => fs.readdirSync(dir).filter((name) => name !== 'board.json').sort();

test('sounds are saved as files in the sounds folder', async ({ page, appServer }) => {
  await openApp(page);
  await usePads(page, ['Kick', 'Snare']);
  await expect.poll(() => board(appServer.soundsDir).sounds.map((s) => s.name)).toEqual(['Kick', 'Snare']);

  const saved = board(appServer.soundsDir).sounds;
  expect(saved.map((s) => `${s.name}:${s.key}:${s.file}`)).toEqual([
    `Kick:1:${saved[0].id}.wav`,
    `Snare:2:${saved[1].id}.wav`,
  ]);
  for (const sound of saved) {
    const bytes = fs.readFileSync(path.join(appServer.soundsDir, sound.file));
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF'); // a real WAV file
  }
  // Nothing is left behind in the browser's own storage.
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain('blipdeck');
});

test('the files survive a new browser and a server restart', async ({ page, appServer, browser }) => {
  await openApp(page);
  await usePads(page, ['Kick', 'Snare', 'Coin']);
  await expect.poll(() => board(appServer.soundsDir).sounds.length).toBe(3);
  appServer.stop();

  // Same folder, new server, brand-new browser profile.
  const second = await startServer(appServer.soundsDir);
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await openApp(other, second.url);
    expect(await padNames(other)).toEqual(['Kick', 'Snare', 'Coin']);
    await other.locator('main').click({ position: { x: 4, y: 4 } });
    await other.keyboard.press('3');
    await expect.poll(() => other.evaluate(() => [...sounds.values()].filter((e) => e.voice).map((e) => e.sound.name))).toEqual(['Coin']);
  } finally {
    await context.close();
    second.stop();
  }
});

test('renaming, looping and reordering save details without re-uploading audio', async ({ page, appServer }) => {
  await openApp(page);
  await usePads(page, ['Kick', 'Snare']);
  await expect.poll(() => board(appServer.soundsDir).sounds.length).toBe(2);
  const uploads = [];
  page.on('request', (request) => request.method() === 'PUT' && request.url().includes('/audio') && uploads.push(request.url()));

  page.once('dialog', (dialog) => dialog.accept('Big kick'));
  await openPadMenu(page, 'Kick');
  await page.locator('#padMenu [data-action="rename"]').click();
  await openPadMenu(page, 'Big kick');
  await page.locator('#padMenu [data-action="loop"]').click();
  await expect.poll(() => board(appServer.soundsDir).sounds.find((s) => s.name === 'Big kick')?.loop).toBe(true);
  expect(uploads).toEqual([]);
  await reloadWhenSaved(page);
  expect(await padNames(page)).toEqual(['Big kick', 'Snare']);
});

test('deleting a pad deletes its file', async ({ page, appServer }) => {
  await openApp(page);
  await usePads(page, ['Kick', 'Snare']);
  await expect.poll(() => audioFiles(appServer.soundsDir).length).toBe(2);
  page.once('dialog', (dialog) => dialog.accept());
  await openPadMenu(page, 'Kick');
  await page.locator('#padMenu [data-action="delete"]').click();
  await expect.poll(() => board(appServer.soundsDir).sounds.map((s) => s.name)).toEqual(['Snare']);
  // The file goes a moment after board.json is updated.
  await expect.poll(() => audioFiles(appServer.soundsDir)).toEqual([board(appServer.soundsDir).sounds[0].file]);
});

test('sounds saved in the browser by earlier versions move into the folder', async ({ page, appServer }) => {
  // What an earlier local version left in this browser: two sounds in IndexedDB.
  await page.goto('/logo.svg');
  await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 4410, 44100);
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.start();
    const samples = (await ctx.startRendering()).getChannelData(0);
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const text = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 44100, true); view.setUint32(28, 88200, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples.length * 2, true);
    samples.forEach((v, i) => view.setInt16(44 + i * 2, v * 0x7fff, true));
    const db = await new Promise((resolve) => {
      const req = indexedDB.open('blipdeck', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sounds', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction('sounds', 'readwrite');
      const base = { audio: view.buffer, mimeType: 'audio/wav', duration: 0.1, color: '#ff7a59', loop: false };
      tx.objectStore('sounds').put({ ...base, id: 'mine-1', name: 'Intro', code: 'KeyQ', key: 'q', createdAt: 1, order: 1 });
      tx.objectStore('sounds').put({ ...base, id: 'mine-2', name: 'Outro', code: 'KeyW', key: 'w', createdAt: 2, order: 0 });
      tx.oncomplete = resolve;
    });
    db.close();
    localStorage.setItem('blipdeck.seeded', '1');
  });

  await openApp(page);
  expect(await padNames(page)).toEqual(['Outro', 'Intro']);
  expect(board(appServer.soundsDir).sounds.map((s) => `${s.name}=${s.key}`).sort()).toEqual(['Intro=q', 'Outro=w']);
  expect(audioFiles(appServer.soundsDir)).toEqual(['mine-1.wav', 'mine-2.wav']);
  await expect
    .poll(() => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name)))
    .not.toContain('blipdeck');
});

test('the sample pad is created only on the very first run', async ({ page, appServer }) => {
  await openApp(page);
  expect(await padNames(page)).toEqual(['Ding']);
  page.once('dialog', (dialog) => dialog.accept());
  await openPadMenu(page, 'Ding');
  await page.locator('#padMenu [data-action="delete"]').click();
  await expect.poll(() => board(appServer.soundsDir).sounds).toEqual([]);
  // Even from another browser, the folder remembers it's not new any more.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  expect(await padNames(page)).toEqual([]);
});

test('the server refuses other hosts and invalid sound ids', async ({ request, appServer }) => {
  const port = new URL(appServer.url).port;
  const evil = await request.get(`${appServer.url}/api/board`, { headers: { host: `evil.example:${port}` } });
  expect(evil.status()).toBe(403);
  for (const id of ['..', '..%2Fboard', 'a b', 'x'.repeat(65)]) {
    const response = await request.put(`${appServer.url}/api/sounds/${id}`, { data: { name: 'x' } });
    expect(response.status(), id).toBe(404);
  }
  expect(fs.existsSync(path.join(appServer.soundsDir, 'board.json'))).toBe(false);
});

test('a sound whose audio file is missing is skipped, the others still load', async ({ page, appServer }) => {
  await openApp(page);
  await usePads(page, ['Kick', 'Snare', 'Coin']);
  await expect.poll(() => audioFiles(appServer.soundsDir).length).toBe(3);
  const snare = board(appServer.soundsDir).sounds.find((s) => s.name === 'Snare');
  fs.rmSync(path.join(appServer.soundsDir, snare.file));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  expect(await padNames(page)).toEqual(['Kick', 'Coin']);
});
