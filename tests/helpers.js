// Shared helpers for the end-to-end tests. They reach into the app's globals
// (sounds, seedSamples, db...) only to set up state and read it back; every
// interaction under test goes through real mouse and keyboard input.

async function openApp(page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
}

// Replaces every pad with the given synthesized samples (keys 1, 2, 3...),
// decoded and ready to play.
async function usePads(page, names) {
  await page.evaluate(async (names) => {
    for (const [id, entry] of [...sounds]) {
      forgetBuffer(entry);
      entry.el.remove();
      sounds.delete(id);
      await db.remove(id);
    }
    await seedSamples(names);
    await Promise.all([...sounds.values()].map((entry) => loadBuffer(entry)));
  }, names);
}

// Adds a pad holding `seconds` of silence, then a steady tone, then silence
// again. Returns nothing; the pad is named after `name`.
async function addTonePad(page, name, { silence = 0, tone = 2, level = 0.3, loop = false, key } = {}) {
  await page.evaluate(
    async ({ name, silence, tone, level, loop, key }) => {
      const rate = 44100;
      const ctx = new OfflineAudioContext(1, Math.ceil(rate * (silence * 2 + tone)), rate);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 330;
      gain.gain.value = level;
      osc.connect(gain).connect(ctx.destination);
      osc.start(silence);
      osc.stop(silence + tone);
      const buffer = await ctx.startRendering();
      await createSound(encodeWav(buffer, 0, buffer.duration), name, buffer.duration);
      const entry = [...sounds.values()].find((e) => e.sound.name === name);
      entry.sound.loop = loop;
      if (key) {
        entry.sound.code = `Digit${key}`;
        entry.sound.key = String(key);
      }
      renderPad(entry);
      await db.put(entry.sound);
      await loadBuffer(entry);
    },
    { name, silence, tone, level, loop, key },
  );
}

const playing = (page) =>
  page.evaluate(() => [...sounds.values()].filter((e) => e.voice).map((e) => e.sound.name));

const padNames = (page) =>
  page.evaluate(() => [...grid.children].map((el) => el.querySelector('.name').textContent));

// Pad names in saved order, as the next page load will see them.
const savedNames = (page) =>
  page.evaluate(async () => (await db.all()).sort(byOrder).map((sound) => sound.name));

// Reloads only once the database matches the screen: saving finishes a moment
// after the UI updates, and reloading earlier would lose the last change.
async function reloadWhenSaved(page) {
  const { expect } = require('@playwright/test');
  const onScreen = await padNames(page);
  await expect.poll(() => savedNames(page)).toEqual(onScreen);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
}

const pad = (page, name) => page.locator('.pad', { has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) });

// Gives the page keyboard focus the way a user would: by clicking an empty
// spot (the padding at the top of the main area).
async function focusPage(page) {
  await page.locator('main').click({ position: { x: 4, y: 4 } });
}

async function openPadMenu(page, name) {
  await pad(page, name).locator('.more').click();
  await page.locator('#padMenu').waitFor({ state: 'visible' });
}

async function stopEverything(page) {
  await page.evaluate(() => stopAll());
}

module.exports = {
  openApp,
  usePads,
  addTonePad,
  playing,
  padNames,
  savedNames,
  reloadWhenSaved,
  pad,
  focusPage,
  openPadMenu,
  stopEverything,
};
