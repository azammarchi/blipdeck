// Minimal static server with no dependencies. The microphone only works in a
// secure context: http://localhost is one, so serving the files from here is enough.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 5173;
const ROOT = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Every open tab keeps a connection on /events: when the last one closes (and
// doesn't come back within the grace period, which covers page reloads) the
// server stops. Disable with KEEP_RUNNING=1.
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

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/events') {
    handleEvents(req, res);
    return;
  }
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT)) {
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

// If the port is taken, try the next ones instead of crashing.
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
