'use strict';

// ---------------------------------------------------------------------------
// Storage. The local app (served by server.js) saves sounds as real files in
// the project's sounds/ folder, through the server's small API. The online
// demo has no server, so there they live in the browser's IndexedDB. Both
// stores have the same interface: all(), put(sound), remove(id), firstRun().
// ---------------------------------------------------------------------------

// Served by server.js on this machine, or as the online demo (GitHub Pages)?
const IS_LOCAL_SERVER = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const DB_NAME = 'blipdeck';
const STORE = 'sounds';
// Before the rename to Blipdeck, data was saved under "soundpad" names.
const LEGACY_PREFIX = 'soundpad';
const SEEDED_KEY = 'blipdeck.seeded';

// --- Browser storage (IndexedDB) -------------------------------------------
let dbPromise = null; // opened on first use: the local app may never need it

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbOp(mode, fn) {
  dbPromise ||= openDb();
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    const fail = () => reject(tx.error || req?.error || new Error('IndexedDB transaction failed'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = fail;
    tx.onabort = fail;
  });
}

// In memory a sound keeps its audio as a Blob (and, once trimmed, its
// untrimmed audio as `original`); in the database both are stored as raw
// bytes. Some browsers can't store Blobs (Safari private windows, for one),
// while an ArrayBuffer is accepted everywhere. Records saved as Blobs by
// earlier versions are still read.
async function toRecord({ blob, original, ...sound }) {
  const record = { ...sound, audio: await blob.arrayBuffer(), mimeType: blob.type };
  if (original) Object.assign(record, { originalAudio: await original.arrayBuffer(), originalType: original.type });
  return record;
}

function fromRecord({ audio, mimeType, originalAudio, originalType, ...record }) {
  const sound = audio ? { ...record, blob: new Blob([audio], { type: mimeType }) } : record;
  if (originalAudio) sound.original = new Blob([originalAudio], { type: originalType });
  return sound;
}

const browserStore = {
  all: async () => (await dbOp('readonly', (s) => s.getAll())).map(fromRecord),
  // The bytes are read before the transaction opens: it would close itself
  // while waiting for them.
  put: async (sound) => {
    const record = await toRecord(sound);
    return dbOp('readwrite', (s) => s.put(record));
  },
  remove: (id) => dbOp('readwrite', (s) => s.delete(id)),
  firstRun: () => {
    const first = readSetting(SEEDED_KEY) === null;
    writeSetting(SEEDED_KEY, '1');
    return first;
  },
};

// --- File storage (local server) -------------------------------------------
async function api(method, path, body, type) {
  const response = await fetch(`/api/${path}`, {
    method,
    body,
    headers: type ? { 'Content-Type': type } : undefined,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${method} /api/${path} failed: ${response.status}`);
  return response;
}

// Audio is only uploaded when it changed: renaming, reordering or looping a
// pad just saves its details.
// Per sound, the exact audio the server has: after "Restore original" a sound
// gets back audio it had before, which must be uploaded again all the same.
const savedAudio = new Map(); // id -> the audio the server has
const savedOriginals = new Map(); // id -> the untrimmed audio the server has
let boardWasNew = false;

const DETAIL_FIELDS = ['name', 'duration', 'color', 'code', 'key', 'loop', 'order', 'createdAt', 'sample'];

const fileStore = {
  all: async () => {
    const board = await (await api('GET', 'board')).json();
    boardWasNew = board.firstRun;
    const loaded = await Promise.all(
      board.sounds.map(async (meta) => {
        const sound = Object.fromEntries(DETAIL_FIELDS.filter((f) => f in meta).map((f) => [f, meta[f]]));
        sound.id = meta.id;
        try {
          sound.blob = await (await api('GET', `sounds/${meta.id}/audio`)).blob();
        } catch (err) {
          // Deleted (or still being saved) by another tab right now, or its
          // file was removed by hand: load the others rather than none.
          console.warn(`Skipping "${meta.name}": its audio file can't be read`, err);
          return null;
        }
        savedAudio.set(meta.id, sound.blob);
        if (meta.originalFile) {
          try {
            sound.original = await (await api('GET', `sounds/${meta.id}/audio?original`)).blob();
            savedOriginals.set(meta.id, sound.original);
          } catch (err) {
            console.warn(`The untrimmed audio of "${meta.name}" can't be read`, err);
          }
        }
        return sound;
      }),
    );
    return loaded.filter(Boolean);
  },
  put: async (sound) => {
    const details = Object.fromEntries(DETAIL_FIELDS.filter((f) => f in sound).map((f) => [f, sound[f]]));
    await api('PUT', `sounds/${sound.id}`, JSON.stringify(details), 'application/json');
    if (savedAudio.get(sound.id) !== sound.blob) {
      await api('PUT', `sounds/${sound.id}/audio`, sound.blob, sound.blob.type || 'application/octet-stream');
      savedAudio.set(sound.id, sound.blob);
    }
    if (sound.original && savedOriginals.get(sound.id) !== sound.original) {
      await api('PUT', `sounds/${sound.id}/audio?original`, sound.original, sound.original.type || 'application/octet-stream');
      savedOriginals.set(sound.id, sound.original);
    } else if (!sound.original && savedOriginals.has(sound.id)) {
      await api('DELETE', `sounds/${sound.id}/audio?original`);
      savedOriginals.delete(sound.id);
    }
  },
  remove: async (id) => {
    await api('DELETE', `sounds/${id}`);
    savedAudio.delete(id);
    savedOriginals.delete(id);
  },
  // A brand-new sounds/ folder, unless this browser already saw a first run
  // (someone who deleted the sample pad before files existed).
  firstRun: () => boardWasNew && readSetting(SEEDED_KEY) === null,
};

const db = IS_LOCAL_SERVER ? fileStore : browserStore;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const COLORS = ['#6c8cff', '#ff7a59', '#2ec4a6', '#c86cff', '#f5b942', '#ff5c8a', '#4cc3ff', '#8bd450'];
const RESERVED_CODES = new Set(['KeyR', 'Escape']);
const VOLUME_KEY = 'blipdeck.volume';
const LANGUAGE_KEY = 'blipdeck.language';

const sounds = new Map(); // id -> { sound, el, buffer, bufferPromise, voice }
let assigningId = null;
let masterVolume = 1;

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');
const template = $('#padTemplate');

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The digit keys on the top row (Digit1) and on the numeric keypad (Numpad1)
// look the same to the user, so they count as the same shortcut.
function shortcutCode(code) {
  return code ? code.replace(/^Numpad(\d)$/, 'Digit$1') : code;
}

function keyLabel(key) {
  if (!key) return '';
  if (key === ' ') return t('spaceKey');
  return key.length === 1 ? key.toUpperCase() : key;
}

// Pads that were never moved have no `order` and stay in creation order,
// after the reordered ones (whose order is their position 0, 1, 2...).
function byOrder(a, b) {
  return (a.order ?? a.createdAt) - (b.order ?? b.createdAt);
}

function nextColor() {
  return COLORS[sounds.size % COLORS.length];
}

function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

// ---------------------------------------------------------------------------
// Playback: each sound is decoded into memory once and played through a single
// Web Audio graph that the browser mixes into one output stream. (One <audio>
// element per pad opens a stream per sound, and starting one could make the
// others stutter for a moment, especially in Safari.)
// ---------------------------------------------------------------------------
const STOP_FADE = 0.008; // seconds; a tiny fade-out avoids a click when cutting a sound

let audioCtx = null;
let masterGain = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext({ latencyHint: 'interactive' });
    masterGain = audioCtx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

// Decodes a pad's audio once. The promise is kept so that a pad pressed while
// it is still decoding plays as soon as it's ready.
function loadBuffer(entry) {
  entry.bufferPromise ||= entry.sound.blob
    .arrayBuffer()
    .then((data) => getAudioContext().decodeAudioData(data))
    .then((buffer) => {
      entry.buffer = buffer;
      if (!entry.sound.duration) {
        entry.sound.duration = buffer.duration;
        renderPad(entry);
      }
      return buffer;
    })
    .catch((err) => {
      entry.bufferPromise = null;
      throw err;
    });
  return entry.bufferPromise;
}

function forgetBuffer(entry) {
  stopVoice(entry);
  entry.buffer = null;
  entry.bufferPromise = null;
}

// ---------------------------------------------------------------------------
// Pads
// ---------------------------------------------------------------------------
function addPad(sound) {
  const el = template.content.firstElementChild.cloneNode(true);
  el.style.setProperty('--pad-color', sound.color);
  const entry = { sound, el, buffer: null, bufferPromise: null, voice: null };
  sounds.set(sound.id, entry);

  const play = el.querySelector('.play');
  play.addEventListener('click', () => suppressClick || trigger(sound.id));
  enableReorder(el, play);
  const more = el.querySelector('.more');
  more.addEventListener('click', () => openPadMenu(sound.id, more));

  grid.appendChild(el);
  renderPad(entry);
  updateEmptyState();
  // Decode in the background so the first press plays right away.
  loadBuffer(entry).catch((err) => console.warn(`Couldn't decode "${sound.name}"`, err));
}

function renderPad({ sound, el }) {
  el.querySelector('.name').textContent = sound.name;
  el.querySelector('.key').textContent = keyLabel(sound.key);
  el.querySelector('.duration').textContent = formatTime(sound.duration);
  el.classList.toggle('looping', !!sound.loop);
  el.classList.toggle('assigning', assigningId === sound.id);
}

function renderPlaying(entry) {
  entry.el.classList.toggle('playing', !!entry.voice);
  const { voice } = entry;
  if (voice) requestAnimationFrame(() => tickProgress(entry, voice));
  else entry.el.querySelector('.progress').style.width = '0';
}

// Runs every frame while `voice` is the pad's current sound; it stops by
// itself once the sound ends or is replaced.
function tickProgress(entry, voice) {
  if (entry.voice !== voice) return;
  const { duration } = voice.source.buffer;
  const elapsed = audioCtx.currentTime - voice.startedAt;
  const ratio = voice.source.loop ? (elapsed % duration) / duration : Math.min(1, elapsed / duration);
  entry.el.querySelector('.progress').style.width = `${ratio * 100}%`;
  requestAnimationFrame(() => tickProgress(entry, voice));
}

// Pressing a pad restarts it from the beginning; if it is looping and
// currently playing, pressing it stops it. Other pads are never affected.
async function trigger(id) {
  const entry = sounds.get(id);
  const ctx = getAudioContext();
  // Browsers only let audio start from a click or key press: this is one.
  if (ctx.state !== 'running') ctx.resume();
  if (entry.sound.loop && entry.voice) {
    stopVoice(entry);
    return;
  }
  let buffer;
  try {
    buffer = entry.buffer || (await loadBuffer(entry));
  } catch (err) {
    alert(t('audioReadError', { error: err?.message || err }));
    return;
  }
  if (!sounds.has(id)) return; // deleted while decoding
  stopVoice(entry);
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.loop = !!entry.sound.loop;
  source.connect(gain).connect(masterGain);
  const voice = { source, gain, startedAt: ctx.currentTime };
  source.onended = () => {
    if (entry.voice !== voice) return;
    entry.voice = null;
    renderPlaying(entry);
  };
  source.start();
  entry.voice = voice;
  renderPlaying(entry);
}

function stopVoice(entry) {
  const { voice } = entry;
  if (!voice) return;
  entry.voice = null;
  const now = audioCtx.currentTime;
  voice.gain.gain.setTargetAtTime(0, now, STOP_FADE / 3);
  voice.source.stop(now + STOP_FADE * 2);
  renderPlaying(entry);
}

function stopAll() {
  for (const entry of sounds.values()) stopVoice(entry);
}

async function rename(id) {
  const entry = sounds.get(id);
  const name = prompt(t('renamePrompt'), entry.sound.name);
  if (name === null || !name.trim()) return;
  entry.sound.name = name.trim();
  await db.put(entry.sound);
  renderPad(entry);
}

async function toggleLoop(id) {
  const entry = sounds.get(id);
  entry.sound.loop = !entry.sound.loop;
  // A playing sound picks up the change: turning loop off lets it finish.
  if (entry.voice) entry.voice.source.loop = entry.sound.loop;
  await db.put(entry.sound);
  renderPad(entry);
}

async function removePad(id) {
  const entry = sounds.get(id);
  if (!confirm(t('deleteConfirm', { name: entry.sound.name }))) return;
  forgetBuffer(entry);
  entry.el.remove();
  sounds.delete(id);
  if (assigningId === id) assigningId = null;
  await db.remove(id);
  updateEmptyState();
}

function startAssign(id) {
  const previous = assigningId;
  assigningId = assigningId === id ? null : id;
  if (previous && sounds.has(previous)) renderPad(sounds.get(previous));
  renderPad(sounds.get(id));
}

// The screen is updated first and saved afterwards: if saving fails, the pad
// must not stay stuck waiting for a key.
async function assignKey(event) {
  const entry = sounds.get(assigningId);
  assigningId = null;
  renderPad(entry);
  if (event.code === 'Escape') return;
  const code = shortcutCode(event.code);
  const changed = [entry];
  if (event.code === 'Backspace' || event.code === 'Delete') {
    entry.sound.code = null;
    entry.sound.key = null;
  } else if (RESERVED_CODES.has(code)) {
    alert(t('keyReserved', { key: keyLabel(event.key) }));
    return;
  } else {
    // A key can be bound to one sound only: take it away from the others.
    for (const other of sounds.values()) {
      if (other !== entry && shortcutCode(other.sound.code) === code) {
        other.sound.code = null;
        other.sound.key = null;
        changed.push(other);
      }
    }
    entry.sound.code = code;
    // With Num Lock off the keypad reports keys like "End": label it by digit.
    entry.sound.key = code.startsWith('Digit') ? code.slice(5) : event.key;
  }
  for (const item of changed) renderPad(item);
  announce(
    entry.sound.key
      ? t('announceKey', { name: entry.sound.name, key: keyLabel(entry.sound.key) })
      : t('announceKeyRemoved', { name: entry.sound.name }),
  );
  await save(...changed.map((item) => item.sound));
}

// Saves sounds, telling the user when the browser refuses to.
async function save(...list) {
  try {
    for (const sound of list) await db.put(sound);
  } catch (err) {
    console.error('Saving failed', err);
    alert(t('saveError', { error: err?.message || err?.name || String(err) }));
  }
}

// Runs whenever pads are added or removed.
function updateEmptyState() {
  $('#emptyState').hidden = sounds.size > 0;
  updateBackupNotice();
}

// `original`: the untrimmed audio, when the sound was trimmed on creation
// (recordings lose their silent edges automatically).
async function createSound(blob, name, duration, original) {
  const sound = {
    id: crypto.randomUUID(),
    name,
    blob,
    ...(original && { original }),
    duration: duration || 0,
    color: nextColor(),
    code: null,
    key: null,
    loop: false,
    createdAt: Date.now(),
  };
  await db.put(sound);
  addPad(sound);
  protectBrowserStorage();
}

// ---------------------------------------------------------------------------
// Online demo: the sounds live only in this browser, which may delete them to
// free up space. Once the visitor has sounds of their own, the app asks the
// browser to keep its data, and suggests an export every now and then.
// ---------------------------------------------------------------------------
const BACKUP_KEY = 'blipdeck.backupNoticeHiddenAt';
const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Sample pads don't count. (Samples seeded by earlier versions have no
// `sample` flag, so their names are checked too.)
function hasOwnSounds() {
  return [...sounds.values()].some(({ sound }) => !sound.sample && !(sound.name in SAMPLES));
}

function protectBrowserStorage() {
  if (IS_LOCAL_SERVER || !hasOwnSounds()) return;
  navigator.storage?.persist?.().catch(() => {});
}

function updateBackupNotice() {
  const hiddenAt = Number(readSetting(BACKUP_KEY)) || 0;
  $('#backupNotice').hidden = IS_LOCAL_SERVER || !hasOwnSounds() || Date.now() - hiddenAt < BACKUP_INTERVAL_MS;
}

function hideBackupNotice() {
  writeSetting(BACKUP_KEY, String(Date.now()));
  updateBackupNotice();
}

$('#backupExportBtn').addEventListener('click', () => exportBank());
$('#backupLaterBtn').addEventListener('click', hideBackupNotice);

// ---------------------------------------------------------------------------
// Reordering. With a mouse, press a pad and move to drag it right away. On a
// touch screen a swipe must keep scrolling the page, so a pad is lifted by a
// long press instead. Either way, a click or tap without moving plays it.
// ---------------------------------------------------------------------------
const DRAG_THRESHOLD = 6; // px a mouse must move before a press becomes a drag
const LONG_PRESS_MS = 400; // how long a finger must rest on a pad to lift it
let suppressClick = false;

// Moves and release are listened for on the window, not on the pad: moving the
// pad inside the grid detaches and re-attaches it to the DOM, which would drop
// pointer capture and freeze the drag halfway.
function enableReorder(el, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    let lastY = startY;
    let drag = null;
    let timer = null;

    if (touch) {
      timer = setTimeout(() => {
        timer = null;
        drag = startDrag(el, startX, startY);
        moveDrag(drag, lastX, lastY);
        navigator.vibrate?.(15);
      }, LONG_PRESS_MS);
    }

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!drag) {
        if (Math.hypot(lastX - startX, lastY - startY) < DRAG_THRESHOLD) return;
        if (touch) {
          // Moving before the long press: it's a swipe, let the page scroll.
          stop();
          return;
        }
        // Grab the pad where the press started, so it doesn't jump under the pointer.
        drag = startDrag(el, startX, startY);
      }
      ev.preventDefault();
      moveDrag(drag, lastX, lastY);
    };

    // While a pad is lifted the finger drags it, it doesn't scroll the page.
    const holdPage = (ev) => drag && ev.cancelable && ev.preventDefault();

    const onEnd = (ev) => {
      if (ev.pointerId !== undefined && ev.pointerId !== pointerId) return;
      const wasDragging = !!drag;
      stop();
      if (!wasDragging) return;
      // The click that follows the release must not play the sound.
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
    };

    const stop = () => {
      clearTimeout(timer);
      timer = null;
      if (drag) finishDrag(drag);
      drag = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('blur', onEnd);
      window.removeEventListener('touchmove', holdPage);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('blur', onEnd);
    window.addEventListener('touchmove', holdPage, { passive: false });
  });
  handle.addEventListener('contextmenu', (e) => e.preventDefault());
}

function startDrag(el, x, y) {
  const rect = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.classList.add('drag-ghost');
  Object.assign(ghost.style, {
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    left: `${rect.left}px`,
    top: `${rect.top}px`,
  });
  document.body.appendChild(ghost);
  document.body.classList.add('reordering');
  el.classList.add('drag-placeholder');
  return { el, ghost, dx: x - rect.left, dy: y - rect.top };
}

function moveDrag(drag, x, y) {
  drag.ghost.style.left = `${x - drag.dx}px`;
  drag.ghost.style.top = `${y - drag.dy}px`;
  const target = document.elementFromPoint(x, y)?.closest('.pad');
  if (!target || target === drag.el || target.parentElement !== grid) return;
  const pads = [...grid.children];
  if (pads.indexOf(drag.el) < pads.indexOf(target)) target.after(drag.el);
  else target.before(drag.el);
}

async function finishDrag(drag) {
  drag.ghost.remove();
  document.body.classList.remove('reordering');
  drag.el.classList.remove('drag-placeholder');
  await saveOrder();
}

// Keyboard alternative to dragging, from the pad menu: one step at a time.
async function movePad(id, step) {
  const entry = sounds.get(id);
  const pads = [...grid.children];
  const position = pads.indexOf(entry.el) + step;
  const neighbour = pads[position];
  if (!neighbour) return;
  if (step < 0) neighbour.before(entry.el);
  else neighbour.after(entry.el);
  entry.el.querySelector('.play').focus({ preventScroll: true });
  entry.el.scrollIntoView({ block: 'nearest' });
  announce(t('announceMoved', { name: entry.sound.name, position: position + 1 }));
  await saveOrder();
}

// Saves the order the pads have on screen.
async function saveOrder() {
  const byEl = new Map([...sounds.values()].map((entry) => [entry.el, entry]));
  const pads = [...grid.children];
  for (let i = 0; i < pads.length; i++) {
    const { sound } = byEl.get(pads[i]);
    if (sound.order !== i) {
      sound.order = i;
      await db.put(sound);
    }
  }
}

// ---------------------------------------------------------------------------
// Trimming: the audio is decoded, start/end are picked on the waveform and the
// kept part is saved as WAV in place of the original.
// ---------------------------------------------------------------------------
const MIN_TRIM = 0.05; // seconds
const FADE = 0.005; // fade at the cut edges, avoids audible clicks

const trimDialog = $('#trimDialog');
const wave = $('.wave-wrap');
const trim = { entry: null, buffer: null, start: 0, end: 0, source: null, raf: 0 };
let dragging = null;

async function openTrim(id) {
  const entry = sounds.get(id);
  stopVoice(entry);
  let buffer;
  try {
    buffer = entry.buffer || (await loadBuffer(entry));
  } catch (err) {
    alert(t('audioReadError', { error: err.message }));
    return;
  }
  Object.assign(trim, { entry, buffer, start: 0, end: buffer.duration });
  renderTrimHeading();
  $('#trimRestoreBtn').hidden = !entry.sound.original;
  trimDialog.showModal();
  drawWaveform();
  renderTrim();
}

function renderTrimHeading() {
  if (trim.entry) $('#trimHeading').textContent = t('trimHeading', { name: trim.entry.sound.name });
}

function drawWaveform() {
  const canvas = $('#trimCanvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const channels = [...Array(trim.buffer.numberOfChannels)].map((_, c) => trim.buffer.getChannelData(c));
  const step = Math.max(1, Math.floor(trim.buffer.length / width));
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = trim.entry.sound.color;
  for (let x = 0; x < width; x++) {
    let min = 0;
    let max = 0;
    for (let i = x * step; i < (x + 1) * step && i < trim.buffer.length; i++) {
      for (const ch of channels) {
        if (ch[i] < min) min = ch[i];
        if (ch[i] > max) max = ch[i];
      }
    }
    const top = ((1 - max) / 2) * height;
    const bottom = ((1 - min) / 2) * height;
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
}

function renderTrim() {
  const total = trim.buffer.duration;
  const startPct = (trim.start / total) * 100;
  const endPct = (trim.end / total) * 100;
  $('#trimHandleStart').style.left = `${startPct}%`;
  $('#trimHandleEnd').style.left = `${endPct}%`;
  Object.assign($('#trimShadeStart').style, { left: '0', width: `${startPct}%` });
  Object.assign($('#trimShadeEnd').style, { left: `${endPct}%`, right: '0' });
  $('#trimStartLabel').textContent = `${trim.start.toFixed(2)}s`;
  $('#trimEndLabel').textContent = `${trim.end.toFixed(2)}s`;
  $('#trimLengthLabel').textContent = `${(trim.end - trim.start).toFixed(2)}s`;
  for (const [handle, time] of [[$('#trimHandleStart'), trim.start], [$('#trimHandleEnd'), trim.end]]) {
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', total.toFixed(2));
    handle.setAttribute('aria-valuenow', time.toFixed(2));
    handle.setAttribute('aria-valuetext', `${time.toFixed(2)}s`);
  }
}

// The handles are sliders for the keyboard too: arrows move by 0.05 s,
// Shift+arrows by 0.5 s, Home/End to the edges.
for (const [handle, which] of [[$('#trimHandleStart'), 'start'], [$('#trimHandleEnd'), 'end']]) {
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.5 : 0.05;
    const moves = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
    let time;
    if (e.key in moves) time = trim[which] + moves[e.key];
    else if (e.key === 'Home') time = 0;
    else if (e.key === 'End') time = trim.buffer.duration;
    else return;
    e.preventDefault();
    dragging = which;
    moveHandle(time);
    dragging = null;
  });
}

function timeAt(clientX) {
  const rect = wave.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * trim.buffer.duration;
}

function moveHandle(time) {
  stopPreview();
  if (dragging === 'start') trim.start = Math.max(0, Math.min(time, trim.end - MIN_TRIM));
  else trim.end = Math.min(trim.buffer.duration, Math.max(time, trim.start + MIN_TRIM));
  renderTrim();
}

// A click or drag moves whichever handle is closest to the pointer.
wave.addEventListener('pointerdown', (e) => {
  const time = timeAt(e.clientX);
  dragging = Math.abs(time - trim.start) <= Math.abs(time - trim.end) ? 'start' : 'end';
  wave.setPointerCapture(e.pointerId);
  moveHandle(time);
});
wave.addEventListener('pointermove', (e) => dragging && moveHandle(timeAt(e.clientX)));
wave.addEventListener('pointerup', () => (dragging = null));
wave.addEventListener('pointercancel', () => (dragging = null));

// Switches a data-i18n element to another key and re-translates it.
function setLabel(el, key) {
  el.dataset.i18n = key;
  el.textContent = t(key);
}

function setPreviewButton(playing) {
  const button = $('#trimPreviewBtn');
  setLabel(button.querySelector('span'), playing ? 'previewStop' : 'preview');
  button.querySelector('use').setAttribute('href', playing ? '#i-stop' : '#i-play');
}

function startPreview() {
  stopPreview();
  const ctx = getAudioContext();
  if (ctx.state !== 'running') ctx.resume();
  const source = ctx.createBufferSource();
  source.buffer = trim.buffer;
  source.connect(masterGain);
  const startedAt = ctx.currentTime;
  source.start(0, trim.start, trim.end - trim.start);
  source.onended = () => trim.source === source && stopPreview();
  trim.source = source;
  setPreviewButton(true);
  const playhead = $('#trimPlayhead');
  playhead.hidden = false;
  const tick = () => {
    const time = trim.start + (audioCtx.currentTime - startedAt);
    playhead.style.left = `${(Math.min(time, trim.end) / trim.buffer.duration) * 100}%`;
    trim.raf = requestAnimationFrame(tick);
  };
  tick();
}

function stopPreview() {
  if (trim.source) {
    const source = trim.source;
    trim.source = null;
    try { source.stop(); } catch {}
  }
  cancelAnimationFrame(trim.raf);
  $('#trimPlayhead').hidden = true;
  setPreviewButton(false);
}

// Returns {start, end} without the leading and trailing silence, or null if
// the sound is practically mute (then there is nothing to cut). The threshold
// is relative to the sound's peak.
function silenceBounds(buffer) {
  const channels = [...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c));
  const level = (i) => {
    let max = 0;
    for (const ch of channels) max = Math.max(max, Math.abs(ch[i]));
    return max;
  };
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, level(i));
  if (peak < 0.01) return null;
  const threshold = peak * 0.08;
  let first = 0;
  while (first < buffer.length && level(first) < threshold) first++;
  let last = buffer.length - 1;
  while (last > first && level(last) < threshold) last--;
  const pad = 0.05;
  const start = Math.max(0, first / buffer.sampleRate - pad);
  let end = Math.min(buffer.duration, last / buffer.sampleRate + pad);
  if (end - start < MIN_TRIM) end = Math.min(buffer.duration, start + MIN_TRIM);
  return { start, end };
}

function autoTrim() {
  const bounds = silenceBounds(trim.buffer);
  if (!bounds) return;
  stopPreview();
  trim.start = bounds.start;
  trim.end = bounds.end;
  renderTrim();
}

// After a recording: removes the silence at the edges. If the audio can't be
// decoded or there is nothing to remove, the recording is kept as it is.
async function trimRecording(blob, duration) {
  try {
    const buffer = await getAudioContext().decodeAudioData(await blob.arrayBuffer());
    const bounds = silenceBounds(buffer);
    if (!bounds || bounds.end - bounds.start > buffer.duration - 0.02) return { blob, duration };
    // The raw recording is kept, so the automatic trim can be undone.
    return { blob: encodeWav(buffer, bounds.start, bounds.end), duration: bounds.end - bounds.start, original: blob };
  } catch (err) {
    console.warn('Automatic trim failed', err);
    return { blob, duration };
  }
}

function encodeWav(buffer, start, end) {
  const rate = buffer.sampleRate;
  const channels = [...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c));
  const from = Math.floor(start * rate);
  const to = Math.min(buffer.length, Math.ceil(end * rate));
  const frames = to - from;
  const bytes = frames * channels.length * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (offset, str) => [...str].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels.length, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);

  const fadeFrames = Math.min(Math.floor(FADE * rate), Math.floor(frames / 2));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    const fade = fadeFrames ? Math.min(1, i / fadeFrames, (frames - 1 - i) / fadeFrames) : 1;
    for (const ch of channels) {
      const v = Math.max(-1, Math.min(1, ch[from + i] * fade));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

// The first trim keeps the untrimmed audio as `original`, so "Restore
// original" can undo every trim since.
async function saveTrim() {
  const { entry, buffer, start, end } = trim;
  stopPreview();
  entry.sound.original ||= entry.sound.blob;
  entry.sound.blob = encodeWav(buffer, start, end);
  entry.sound.duration = end - start;
  forgetBuffer(entry);
  loadBuffer(entry).catch((err) => console.warn('Could not decode the trimmed sound', err));
  renderPad(entry);
  trimDialog.close();
  await save(entry.sound);
}

$('#trimPreviewBtn').addEventListener('click', () => (trim.source ? stopPreview() : startPreview()));
$('#trimAutoBtn').addEventListener('click', autoTrim);
$('#trimSaveBtn').addEventListener('click', saveTrim);

async function restoreOriginal() {
  const { entry } = trim;
  if (!entry?.sound.original) return;
  stopPreview();
  entry.sound.blob = entry.sound.original;
  delete entry.sound.original;
  forgetBuffer(entry);
  trimDialog.close();
  try {
    entry.sound.duration = (await loadBuffer(entry)).duration;
  } catch (err) {
    console.warn('Could not decode the original sound', err);
  }
  renderPad(entry);
  await save(entry.sound);
}

$('#trimRestoreBtn').addEventListener('click', restoreOriginal);
trimDialog.addEventListener('close', () => {
  stopPreview();
  trim.entry = null;
  trim.buffer = null;
});

// ---------------------------------------------------------------------------
// Export / import: a single JSON file with every sound (audio as base64),
// names, keys, colors and loop. Used for backups or moving to another computer.
// ---------------------------------------------------------------------------
const BANK_FORMAT = 'blipdeck-bank';
const LEGACY_BANK_FORMAT = 'soundpad-bank';
const importDialog = $('#importDialog');

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function exportBank() {
  if (!sounds.size) {
    alert(t('nothingToExport'));
    return;
  }
  const list = [...sounds.values()].map((e) => e.sound).sort(byOrder);
  const bank = {
    format: BANK_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    sounds: await Promise.all(
      list.map(async ({ blob, original, id, ...meta }) => ({
        ...meta,
        audio: await blobToDataUrl(blob),
        ...(original && { originalAudio: await blobToDataUrl(original) }),
      })),
    ),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(bank)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `blipdeck-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  hideBackupNotice(); // a fresh backup: no need to remind for a while
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Asks whether imported sounds replace the current ones or are added to them.
// Resolves to 'replace', 'add' or 'cancel'.
function askImportMode(count) {
  $('#importHeading').textContent = t('importHeading', { count });
  importDialog.returnValue = 'cancel';
  importDialog.showModal();
  return new Promise((resolve) => {
    importDialog.addEventListener('close', () => resolve(importDialog.returnValue || 'cancel'), { once: true });
  });
}

async function importBank(file) {
  let bank;
  try {
    bank = JSON.parse(await file.text());
  } catch {
    alert(t('invalidJson', { file: file.name }));
    return;
  }
  const knownFormat = bank?.format === BANK_FORMAT || bank?.format === LEGACY_BANK_FORMAT;
  if (!knownFormat || !Array.isArray(bank.sounds)) {
    alert(t('notABank', { file: file.name }));
    return;
  }
  const mode = sounds.size > 0 ? await askImportMode(bank.sounds.length) : 'add';
  if (mode === 'cancel') return;
  if (mode === 'replace') {
    stopAll();
    for (const [id, entry] of sounds) {
      forgetBuffer(entry);
      entry.el.remove();
      await db.remove(id);
    }
    sounds.clear();
  }
  const usedCodes = new Set([...sounds.values()].map((e) => e.sound.code).filter(Boolean));
  for (const item of bank.sounds) {
    const blob = await (await fetch(item.audio)).blob();
    const original = item.originalAudio ? await (await fetch(item.originalAudio)).blob() : undefined;
    // When adding, keys already in use stay with the existing sounds.
    const keepKey = item.code && !usedCodes.has(item.code) && !RESERVED_CODES.has(item.code);
    if (keepKey) usedCodes.add(item.code);
    const sound = {
      id: crypto.randomUUID(),
      name: String(item.name || t('defaultName')),
      blob,
      ...(original && { original }),
      duration: Number(item.duration) || 0,
      color: item.color || nextColor(),
      code: keepKey ? item.code : null,
      key: keepKey ? item.key : null,
      loop: !!item.loop,
      createdAt: Date.now() + sounds.size, // keeps the file's order
    };
    await db.put(sound);
    addPad(sound);
  }
  updateEmptyState();
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
let recorder = null;
let recordStart = 0;
let timerHandle = null;

async function toggleRecording() {
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert(t('micError', { error: err.message }));
    return;
  }
  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    const duration = (performance.now() - recordStart) / 1000;
    stream.getTracks().forEach((track) => track.stop());
    setRecordingUi(false);
    const blob = new Blob(chunks, { type: recorder.mimeType });
    recorder = null;
    if (!blob.size) return;
    const trimmed = await trimRecording(blob, duration);
    const name = t('soundName', { n: sounds.size + 1 });
    await createSound(trimmed.blob, name, trimmed.duration, trimmed.original);
    announce(t('announceRecordingSaved', { name }));
  };
  recorder.start();
  recordStart = performance.now();
  setRecordingUi(true);
}

// Tells screen reader users what just happened (the region is aria-live).
function announce(message) {
  const region = $('#announcer');
  region.textContent = '';
  requestAnimationFrame(() => (region.textContent = message));
}

function setRecordingUi(recording) {
  if (recording) announce(t('announceRecording'));
  $('#recordBtn').classList.toggle('recording', recording);
  setLabel($('#recordLabel'), recording ? 'stop' : 'record');
  const timer = $('#timer');
  timer.hidden = !recording;
  clearInterval(timerHandle);
  if (recording) {
    timer.textContent = '0:00';
    timerHandle = setInterval(() => {
      const s = Math.floor((performance.now() - recordStart) / 1000);
      timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
  }
}

// ---------------------------------------------------------------------------
// Popup menus (pad actions, language list). Only one is open at a time; it
// closes on a click outside, Esc, Tab, scrolling or resizing the window.
// ---------------------------------------------------------------------------
let openPopup = null; // { menu, anchor, onClose }

function popupItems(menu) {
  return [...menu.querySelectorAll('button:not(:disabled), li')];
}

function showPopup(menu, anchor, onClose) {
  closePopup();
  menu.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  positionPopup(menu, anchor);
  openPopup = { menu, anchor, onClose };
  const items = popupItems(menu);
  (items.find((item) => item.getAttribute('aria-selected') === 'true') || items[0])?.focus();
}

function closePopup({ restoreFocus = false } = {}) {
  if (!openPopup) return;
  const { menu, anchor, onClose } = openPopup;
  openPopup = null;
  menu.hidden = true;
  anchor.setAttribute('aria-expanded', 'false');
  onClose?.();
  if (restoreFocus) anchor.focus();
}

// Opens below the anchor, aligned to its end edge. If it doesn't fit below it
// goes above; if it fits in neither, it takes the roomier side and scrolls.
function positionPopup(menu, anchor) {
  menu.style.maxHeight = '';
  const rect = anchor.getBoundingClientRect();
  const { width, height } = menu.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  const margin = 8;
  const gap = 6;
  const left = Math.min(Math.max(margin, rtl ? rect.left : rect.right - width), innerWidth - width - margin);
  const below = innerHeight - rect.bottom - gap - margin;
  const above = rect.top - gap - margin;
  let top;
  if (height <= below || below >= above) {
    top = rect.bottom + gap;
    menu.style.maxHeight = `${below}px`;
  } else {
    menu.style.maxHeight = `${above}px`;
    top = rect.top - gap - Math.min(height, above);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function handlePopupKey(e) {
  const items = popupItems(openPopup.menu);
  const index = items.indexOf(document.activeElement);
  const focusAt = (i) => items[(i + items.length) % items.length].focus();
  switch (e.key) {
    case 'Escape':
      closePopup({ restoreFocus: true });
      break;
    case 'Tab':
      closePopup();
      return;
    case 'ArrowDown':
      focusAt(index + 1);
      break;
    case 'ArrowUp':
      focusAt(index - 1);
      break;
    case 'Home':
      focusAt(0);
      break;
    case 'End':
      focusAt(items.length - 1);
      break;
    case 'Enter':
    case ' ':
      // Buttons activate by themselves; list items need a click.
      if (items[index]?.tagName !== 'LI') return;
      items[index].click();
      break;
    default:
      return;
  }
  e.preventDefault();
}

document.addEventListener('pointerdown', (e) => {
  if (!openPopup || openPopup.menu.contains(e.target) || openPopup.anchor.contains(e.target)) return;
  closePopup();
});
window.addEventListener('resize', () => closePopup());
// The menu is fixed-positioned: if the page scrolls it would drift away from
// its anchor. Scrolling inside the menu itself (a long language list) is fine.
window.addEventListener(
  'scroll',
  (e) => {
    if (openPopup && !(e.target instanceof Node && openPopup.menu.contains(e.target))) closePopup();
  },
  true,
);

// --- Pad actions menu ------------------------------------------------------
const padMenu = $('#padMenu');
let menuSoundId = null;

function openPadMenu(id, anchor) {
  if (openPopup?.anchor === anchor) {
    closePopup();
    return;
  }
  menuSoundId = id;
  const { el, sound } = sounds.get(id);
  padMenu.querySelector('[data-action="loop"]').setAttribute('aria-checked', String(!!sound.loop));
  padMenu.querySelector('[data-action="moveEarlier"]').disabled = !el.previousElementSibling;
  padMenu.querySelector('[data-action="moveLater"]').disabled = !el.nextElementSibling;
  showPopup(padMenu, anchor, () => (menuSoundId = null));
}

const PAD_ACTIONS = {
  assign: startAssign,
  trim: openTrim,
  rename,
  loop: toggleLoop,
  moveEarlier: (id) => movePad(id, -1),
  moveLater: (id) => movePad(id, 1),
  delete: removePad,
};

padMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-action]');
  if (!item || !menuSoundId) return;
  const id = menuSoundId;
  closePopup();
  sounds.get(id).el.querySelector('.play').focus({ preventScroll: true });
  PAD_ACTIONS[item.dataset.action](id);
});

// --- Language picker -------------------------------------------------------
const languageButton = $('#languageButton');
const languageList = $('#languageList');

function flagUrl(code) {
  return `data:image/svg+xml,${encodeURIComponent(LANGUAGES[code].flag)}`;
}

for (const [code, { name }] of Object.entries(LANGUAGES)) {
  const item = document.createElement('li');
  item.setAttribute('role', 'option');
  item.tabIndex = -1;
  item.lang = code;
  item.dataset.code = code;
  item.innerHTML = '<img class="flag" alt=""><span></span><svg class="icon check" aria-hidden="true"><use href="#i-check"/></svg>';
  item.querySelector('img').src = flagUrl(code);
  item.querySelector('span').textContent = name;
  languageList.append(item);
}

function applyLanguage(code) {
  const applied = setLanguage(code);
  languageButton.querySelector('.flag').src = flagUrl(applied);
  languageButton.querySelector('.lang-name').textContent = LANGUAGES[applied].name;
  for (const item of languageList.children) {
    item.setAttribute('aria-selected', String(item.dataset.code === applied));
  }
  translate(document);
  translate(template.content);
  for (const entry of sounds.values()) renderPad(entry);
  renderTrimHeading();
}

languageButton.addEventListener('click', () => {
  if (openPopup?.anchor === languageButton) closePopup();
  else showPopup(languageList, languageButton);
});

languageList.addEventListener('click', (e) => {
  const item = e.target.closest('li');
  if (!item) return;
  // Focus goes back to the button, never stays on a control that would
  // swallow the pads' keyboard shortcuts.
  closePopup({ restoreFocus: true });
  applyLanguage(item.dataset.code);
  writeSetting(LANGUAGE_KEY, currentLanguage);
});

// ---------------------------------------------------------------------------
// Global events
// ---------------------------------------------------------------------------
$('#recordBtn').addEventListener('click', toggleRecording);
$('#stopAllBtn').addEventListener('click', stopAll);

$('#masterVolume').addEventListener('input', (e) => {
  masterVolume = Number(e.target.value);
  masterGain?.gain.setTargetAtTime(masterVolume, audioCtx.currentTime, 0.01);
  writeSetting(VOLUME_KEY, String(masterVolume));
});

$('#importInput').addEventListener('change', async (e) => {
  for (const file of e.target.files) {
    if (file.name.endsWith('.json') || file.type === 'application/json') {
      await importBank(file);
    } else {
      await createSound(file, file.name.replace(/\.[^.]+$/, ''), 0);
    }
  }
  e.target.value = '';
});

$('#exportBtn').addEventListener('click', exportBank);

// Online demo only: forgets everything changed in this browser and reloads,
// so startup seeds the sample pads again as on a first visit.
const resetDemoBtn = $('#resetDemoBtn');
resetDemoBtn.hidden = IS_LOCAL_SERVER;

async function resetDemo() {
  if (!confirm(t('resetDemoConfirm'))) return;
  stopAll();
  for (const id of [...sounds.keys()]) await db.remove(id);
  for (const key of [VOLUME_KEY, LANGUAGE_KEY, SEEDED_KEY, BACKUP_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
  location.reload();
}

resetDemoBtn.addEventListener('click', resetDemo);

// Shortcuts are ignored only while typing text: other focused controls (the
// volume slider, a button that was just clicked) must not swallow them.
function isTextField(el) {
  return (
    el instanceof Element &&
    el.matches(
      'textarea, [contenteditable=""], [contenteditable="true"], ' +
        'input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"], [type="file"])',
    )
  );
}

document.addEventListener('keydown', (e) => {
  if (openPopup) {
    handlePopupKey(e);
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (trimDialog.open || importDialog.open) return;
  if (isTextField(e.target)) return;

  if (assigningId) {
    e.preventDefault();
    assignKey(e);
    return;
  }
  if (e.repeat) return;

  if (e.code === 'Escape') {
    stopAll();
    return;
  }
  if (e.code === 'KeyR') {
    toggleRecording();
    return;
  }
  const code = shortcutCode(e.code);
  for (const [id, { sound }] of sounds) {
    if (shortcutCode(sound.code) === code) {
      e.preventDefault();
      trigger(id);
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// Sample pads, synthesized in code (there are no audio files in the repo).
// On the very first launch the local app gets the "Ding" pad on the 1 key;
// the online demo gets the whole set on keys 1-8. Once deleted they never
// come back.
// ---------------------------------------------------------------------------
const SAMPLE_RATE = 44100;

async function render(seconds, build) {
  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE);
  build(ctx);
  return ctx.startRendering();
}

function envelope(ctx, at, peak, decay) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  gain.connect(ctx.destination);
  return gain;
}

function tone(ctx, { type = 'sine', freq, to, at = 0, peak = 0.5, decay = 0.3 }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + decay);
  osc.connect(envelope(ctx, at, peak, decay));
  osc.start(at);
  osc.stop(at + decay + 0.05);
}

function noise(ctx, { at = 0, peak = 0.5, decay = 0.2, filter = 'highpass', freq = 1000, sweepTo }) {
  const buffer = ctx.createBuffer(1, Math.ceil(SAMPLE_RATE * (decay + 0.05)), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const biquad = ctx.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.setValueAtTime(freq, at);
  if (sweepTo) {
    biquad.frequency.exponentialRampToValueAtTime(sweepTo, at + decay / 2);
    biquad.frequency.exponentialRampToValueAtTime(freq, at + decay);
  }
  source.connect(biquad).connect(envelope(ctx, at, peak, decay));
  source.start(at);
}

const SAMPLES = {
  Ding: () =>
    render(1.4, (ctx) => {
      for (const [freq, at] of [[1318.5, 0], [1046.5, 0.18]]) { // E6, C6
        tone(ctx, { freq, at, peak: 0.5, decay: 1.1 });
        tone(ctx, { freq: freq * 2.01, at, peak: 0.12, decay: 0.8 });
        tone(ctx, { freq: freq * 3, at, peak: 0.05, decay: 0.5 });
      }
    }),
  Kick: () => render(0.5, (ctx) => tone(ctx, { freq: 150, to: 40, peak: 0.9, decay: 0.45 })),
  Snare: () =>
    render(0.3, (ctx) => {
      noise(ctx, { freq: 1500, peak: 0.6, decay: 0.22 });
      tone(ctx, { type: 'triangle', freq: 190, to: 120, peak: 0.4, decay: 0.12 });
    }),
  'Hi-hat': () => render(0.12, (ctx) => noise(ctx, { freq: 7000, peak: 0.45, decay: 0.07 })),
  Laser: () => render(0.45, (ctx) => tone(ctx, { type: 'sawtooth', freq: 1800, to: 90, peak: 0.3, decay: 0.38 })),
  Coin: () =>
    render(0.6, (ctx) => {
      tone(ctx, { type: 'square', freq: 988, peak: 0.25, decay: 0.08 });
      tone(ctx, { type: 'square', freq: 1319, at: 0.08, peak: 0.25, decay: 0.45 });
    }),
  Whoosh: () =>
    render(0.9, (ctx) => noise(ctx, { filter: 'bandpass', freq: 300, sweepTo: 3000, peak: 0.7, decay: 0.85 })),
  'Power-up': () =>
    render(0.6, (ctx) => {
      [523.3, 659.3, 784, 1046.5].forEach((freq, i) => // C5 E5 G5 C6
        tone(ctx, { type: 'square', freq, at: i * 0.07, peak: 0.2, decay: i === 3 ? 0.3 : 0.07 }));
    }),
};

async function seedSamples(names) {
  for (const [i, name] of names.entries()) {
    const buffer = await SAMPLES[name]();
    // Bring every sample to the same peak so none sounds much louder.
    const data = buffer.getChannelData(0);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    if (peak) for (let j = 0; j < data.length; j++) data[j] *= 0.8 / peak;
    const sound = {
      id: crypto.randomUUID(),
      name,
      blob: encodeWav(buffer, 0, buffer.duration),
      duration: buffer.duration,
      color: COLORS[i % COLORS.length],
      code: `Digit${i + 1}`,
      key: String(i + 1),
      loop: false,
      sample: true,
      createdAt: Date.now() + i,
    };
    await db.put(sound);
    addPad(sound);
  }
}

async function databaseExists(name) {
  // indexedDB.open() would create a database that doesn't exist, so check
  // first. Without databases() (old browsers) we can't tell: assume no.
  if (!indexedDB.databases) return false;
  return (await indexedDB.databases()).some((d) => d.name === name);
}

// Moves sounds and settings saved under the old "soundpad" names into the
// current browser storage, once, so nothing is lost after the rename.
async function migrateLegacyData() {
  for (const key of [VOLUME_KEY, LANGUAGE_KEY, SEEDED_KEY]) {
    const legacyKey = key.replace('blipdeck', LEGACY_PREFIX);
    const value = readSetting(legacyKey);
    if (value === null) continue;
    if (readSetting(key) === null) writeSetting(key, value);
    try {
      localStorage.removeItem(legacyKey);
    } catch {}
  }

  if (!(await databaseExists(LEGACY_PREFIX))) return;
  const legacy = await new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_PREFIX);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (legacy.objectStoreNames.contains(STORE)) {
    const old = await new Promise((resolve, reject) => {
      const req = legacy.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const record of old) await browserStore.put(fromRecord(record));
  }
  legacy.close();
  indexedDB.deleteDatabase(LEGACY_PREFIX);
}

// Local app: sounds saved in the browser by earlier versions move into the
// sounds/ folder. The browser copy is only deleted once every file is saved.
async function moveBrowserSoundsToFiles() {
  if (!IS_LOCAL_SERVER || !(await databaseExists(DB_NAME))) return;
  const stored = await browserStore.all();
  const onDisk = new Set((await fileStore.all()).map((sound) => sound.id));
  for (const sound of stored) if (!onDisk.has(sound.id)) await fileStore.put(sound);
  const saved = new Set((await fileStore.all()).map((sound) => sound.id));
  if (stored.every((sound) => saved.has(sound.id))) {
    (await dbPromise)?.close();
    dbPromise = null;
    indexedDB.deleteDatabase(DB_NAME);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
(async () => {
  try {
    await migrateLegacyData();
    await moveBrowserSoundsToFiles();
  } catch (err) {
    console.warn('Could not move sounds saved by an earlier version', err);
  }

  applyLanguage(readSetting(LANGUAGE_KEY) || DEFAULT_LANGUAGE);

  const savedVolume = readSetting(VOLUME_KEY);
  if (savedVolume !== null && Number(savedVolume) >= 0 && Number(savedVolume) <= 1) {
    masterVolume = Number(savedVolume);
  }
  // Always set, even with nothing saved: Firefox restores the slider's last
  // position on reload, which may not be the volume in use.
  $('#masterVolume').value = String(masterVolume);

  let all = [];
  try {
    all = await db.all();
  } catch (err) {
    console.error('Could not load the sounds', err);
    alert(t('loadError', { error: err?.message || err }));
  }
  all.sort(byOrder).forEach(addPad);

  const firstRun = db.firstRun();
  writeSetting(SEEDED_KEY, '1');
  if (firstRun && !all.length) await seedSamples(IS_LOCAL_SERVER ? ['Ding'] : Object.keys(SAMPLES));
  updateEmptyState();
  // Startup is over (pads loaded or seeded): the test suite waits for this.
  document.documentElement.dataset.ready = 'true';
})();

// ---------------------------------------------------------------------------
// Diagnostics: open the app with ?debug to see on screen every key press that
// reaches the page, what the app did with it, and any error.
// ---------------------------------------------------------------------------
if (new URLSearchParams(location.search).has('debug')) {
  const panel = document.createElement('pre');
  panel.className = 'debug-panel';
  document.body.append(panel);
  const lines = [];
  const log = (text) => {
    lines.push(`${new Date().toLocaleTimeString()}  ${text}`);
    panel.textContent = lines.slice(-12).join('\n');
  };
  document.addEventListener(
    'keydown',
    (e) => {
      const mods = ['shift', 'ctrl', 'alt', 'meta'].filter((m) => e[`${m}Key`]).join('+') || '-';
      const target = e.target instanceof Element ? `${e.target.tagName.toLowerCase()}${e.target.className ? '.' + e.target.className : ''}` : 'document';
      const match = [...sounds.values()].find((x) => shortcutCode(x.sound.code) === shortcutCode(e.code));
      const state = [
        openPopup && 'menu-open',
        assigningId && 'assigning',
        trimDialog.open && 'trim-open',
        importDialog.open && 'import-open',
        isTextField(e.target) && 'text-field',
      ].filter(Boolean).join(',') || 'idle';
      log(`key=${JSON.stringify(e.key)} code=${e.code || '(empty)'} mods=${mods} target=${target} state=${state} pad=${match ? match.sound.name : '-'}`);
    },
    true,
  );
  window.addEventListener('error', (e) => log(`ERROR ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => log(`REJECTED ${e.reason?.message || e.reason?.name || e.reason}`));
  log(`debug on · ${navigator.userAgent}`);
}

// Link to the local server: it keeps running while at least one tab is open
// and stops by itself when the last one is closed. The online demo has no
// server to talk to.
if (IS_LOCAL_SERVER) new EventSource('/events');
