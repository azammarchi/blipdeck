// Every test gets its own server.js on a free port, saving sounds into its own
// temporary folder, so tests never see each other's sounds.
const { spawn } = require('child_process');
const path = require('path');
const base = require('@playwright/test');

async function startServer(soundsDir) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '0', NO_OPEN: '1', KEEP_RUNNING: '1', SOUNDS_DIR: soundsDir },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /http:\/\/localhost:(\d+)/.exec(output);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    });
    child.on('exit', (code) => reject(new Error(`server.js exited with code ${code}`)));
  });
  return { url, soundsDir, stop: () => child.kill() };
}

const test = base.test.extend({
  appServer: async ({}, use, testInfo) => {
    const server = await startServer(testInfo.outputPath('sounds'));
    await use(server);
    server.stop();
  },
  baseURL: async ({ appServer }, use) => use(appServer.url),
});

module.exports = { test, expect: base.expect, startServer };
