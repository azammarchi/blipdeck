// End-to-end tests: the real app, served by server.js, driven with real mouse
// and keyboard input in WebKit (Safari's engine), Firefox and Chromium.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // Each test starts its own server.js (see tests/fixtures.js), which sets
  // the baseURL for it.
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Let audio start without a click, like the Chromium flag below.
        launchOptions: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false } },
      },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
});
