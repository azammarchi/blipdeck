// Minimal local server with no dependencies. It serves the app (the microphone
// only works in a secure context, and http://localhost is one) and saves the
// user's sounds as real files in the sounds/ folder, so they don't depend on
// the browser's storage.
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 5173;
const ROOT = path.join(__dirname, 'public');
const SOUNDS_DIR = path.resolve(process.env.SOUNDS_DIR || path.join(__dirname, 'sounds'));
const BOARD_FILE = path.join(SOUNDS_DIR, 'board.json');
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const AUDIO_EXTENSIONS = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/flac': 'flac',
};

// ---------------------------------------------------------------------------
// Auto-stop: every open tab keeps a connection on /events. When the last one
// closes (and doesn't come back within the grace period, which covers page
// reloads) the server stops. Disable with KEEP_RUNNING=1.
// ---------------------------------------------------------------------------
const SHUTDOWN_GRACE_MS = 3000;
const clients = new Set();
let shutdownTimer = null;

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  clients.add(res);
  clearTimeout(shutdownTimer);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    if (clients.size === 0 && !process.env.KEEP_RUNNING) {
      shutdownTimer = setTimeout(() => {
        console.log('Window closed, stopping Blipdeck.');
        process.exit(0);
      }, SHUTDOWN_GRACE_MS);
    }
  });
}

// ---------------------------------------------------------------------------
// Sound storage: sounds/board.json holds every sound's details (name, key,
// order, loop...) and each sound's audio is a file next to it. A trimmed
// sound also keeps its untrimmed audio as "<id>.original.<ext>".
// ---------------------------------------------------------------------------
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// Details the browser may set; file names and types are decided here.
const SOUND_FIELDS = ['name', 'duration', 'color', 'code', 'key', 'loop', 'order', 'createdAt'];

async function readBoard() {
  try {
    return JSON.parse(await fsp.readFile(BOARD_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Writes go through one queue, and each one replaces the file atomically, so
// concurrent requests can't interleave and a crash can't leave half a file.
let writeQueue = Promise.resolve();

function updateBoard(change) {
  const run = writeQueue.then(async () => {
    const board = (await readBoard()) || { version: 1, sounds: [] };
    const result = await change(board);
    await fsp.mkdir(SOUNDS_DIR, { recursive: true });
    const temp = `${BOARD_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify(board, null, 2)}\n`);
    await fsp.rename(temp, BOARD_FILE);
    return result;
  });
  writeQueue = run.catch(() => {});
  return run;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Too large'), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function removeFile(name) {
  if (name) await fsp.rm(path.join(SOUNDS_DIR, name), { force: true });
}

// GET    /api/board                    → { firstRun, sounds }
// PUT    /api/sounds/:id               ← sound details (JSON)
// DELETE /api/sounds/:id
// GET    /api/sounds/:id/audio[?original]
// PUT    /api/sounds/:id/audio[?original] ← audio bytes, Content-Type = their type
// DELETE /api/sounds/:id/audio?original
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"

  if (parts.length === 1 && parts[0] === 'board' && req.method === 'GET') {
    const board = await readBoard();
    // The very first visit is recorded right away, so it only happens once.
    if (!board) await updateBoard(() => {});
    sendJson(res, 200, { firstRun: !board, sounds: board ? board.sounds : [] });
    return;
  }

  const [section, id, sub] = parts;
  if (section !== 'sounds' || !ID_PATTERN.test(id || '') || parts.length > 3 || (sub && sub !== 'audio')) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const original = url.searchParams.has('original');
  const fileField = original ? 'originalFile' : 'file';
  const typeField = original ? 'originalType' : 'mimeType';

  if (!sub && req.method === 'PUT') {
    let details;
    try {
      details = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON' });
      return;
    }
    const sound = await updateBoard((board) => {
      let entry = board.sounds.find((s) => s.id === id);
      if (!entry) board.sounds.push((entry = { id }));
      for (const field of SOUND_FIELDS) if (field in details) entry[field] = details[field];
      return entry;
    });
    sendJson(res, 200, sound);
    return;
  }

  if (!sub && req.method === 'DELETE') {
    const removed = await updateBoard((board) => {
      const entry = board.sounds.find((s) => s.id === id);
      board.sounds = board.sounds.filter((s) => s.id !== id);
      return entry;
    });
    if (removed) await Promise.all([removeFile(removed.file), removeFile(removed.originalFile)]);
    sendJson(res, 200, { removed: !!removed });
    return;
  }

  if (sub === 'audio' && req.method === 'GET') {
    const board = await readBoard();
    const entry = board?.sounds.find((s) => s.id === id);
    if (!entry?.[fileField]) {
      sendJson(res, 404, { error: 'No audio' });
      return;
    }
    const data = await fsp.readFile(path.join(SOUNDS_DIR, entry[fileField]));
    res.writeHead(200, { 'Content-Type': entry[typeField] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
    return;
  }

  if (sub === 'audio' && req.method === 'PUT') {
    const type = (req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const data = await readBody(req, MAX_AUDIO_BYTES);
    const ext = AUDIO_EXTENSIONS[type] || 'audio';
    const name = original ? `${id}.original.${ext}` : `${id}.${ext}`;
    const known = await readBoard();
    if (!known?.sounds.some((s) => s.id === id)) {
      sendJson(res, 404, { error: 'Unknown sound: save its details first' });
      return;
    }
    await fsp.mkdir(SOUNDS_DIR, { recursive: true });
    await fsp.writeFile(path.join(SOUNDS_DIR, name), data);
    const previous = await updateBoard((board) => {
      const entry = board.sounds.find((s) => s.id === id);
      const old = entry[fileField];
      entry[fileField] = name;
      entry[typeField] = req.headers['content-type'] || type;
      return old;
    });
    if (previous && previous !== name) await removeFile(previous);
    sendJson(res, 200, { file: name });
    return;
  }

  if (sub === 'audio' && req.method === 'DELETE' && original) {
    const previous = await updateBoard((board) => {
      const entry = board.sounds.find((s) => s.id === id);
      if (!entry) return null;
      const old = entry.originalFile;
      delete entry.originalFile;
      delete entry.originalType;
      return old;
    });
    await removeFile(previous);
    sendJson(res, 200, { removed: !!previous });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

// Only requests addressed to this machine by name are answered. A web page
// can't reach the API from another site (the browser blocks its PUT and
// DELETE requests, since no CORS headers are ever sent), and checking the
// Host header also defeats DNS rebinding tricks.
function isLocalHost(host) {
  const name = (host || '').replace(/:\d+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

const server = http.createServer(async (req, res) => {
  if (!isLocalHost(req.headers.host)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  let urlPath;
  try {
    urlPath = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (urlPath === '/events') {
    handleEvents(req, res);
    return;
  }
  if (urlPath.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
    }
    return;
  }
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  // Only files inside public/: a plain prefix check would also let through a
  // sibling folder whose name starts the same way (public-something/).
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// If the port is taken, try the next ones instead of crashing. PORT=0 lets
// the system pick a free one (the tests do this).
function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(err.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1');
}

server.on('listening', () => {
  const url = `http://localhost:${server.address().port}`;
  console.log(`Blipdeck is running at ${url}`);
  console.log(`Sounds are saved in ${SOUNDS_DIR}`);
  if (!process.env.NO_OPEN) openBrowser(url);
});

// Opens the URL in the default browser. Disable with NO_OPEN=1.
function openBrowser(url) {
  const command =
    process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(command, (err) => {
    if (err) console.log(`Open ${url} in your browser.`);
  });
}

listen(PORT, 10);
