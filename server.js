// Server statico minimale, senza dipendenze. Il microfono funziona solo in un
// contesto sicuro: http://localhost lo è, quindi basta servire i file da qui.
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

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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

// Se la porta è occupata proviamo le successive, invece di andare in crash.
function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`Porta ${port} occupata, provo la ${port + 1}...`);
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
  console.log(`Soundpad in ascolto su ${url}`);
  if (!process.env.NO_OPEN) openBrowser(url);
});

// Apre l'URL nel browser predefinito. Si disattiva con NO_OPEN=1.
function openBrowser(url) {
  const command =
    process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(command, (err) => {
    if (err) console.log(`Apri ${url} nel browser.`);
  });
}

listen(PORT, 10);
