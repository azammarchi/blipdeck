'use strict';

// ---------------------------------------------------------------------------
// Storage: i suoni (blob audio + metadati) vivono in IndexedDB nel browser.
// ---------------------------------------------------------------------------
const DB_NAME = 'soundpad';
const STORE = 'sounds';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbPromise = openDb();

async function dbOp(mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

const db = {
  all: () => dbOp('readonly', (s) => s.getAll()),
  put: (sound) => dbOp('readwrite', (s) => s.put(sound)),
  remove: (id) => dbOp('readwrite', (s) => s.delete(id)),
};

// ---------------------------------------------------------------------------
// Stato
// ---------------------------------------------------------------------------
const COLORS = ['#6c8cff', '#ff7a59', '#2ec4a6', '#c86cff', '#f5b942', '#ff5c8a', '#4cc3ff', '#8bd450'];
const RESERVED_CODES = new Set(['KeyR', 'Escape']);

const sounds = new Map(); // id -> { sound, audio, url, el }
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

function keyLabel(key) {
  if (!key) return '';
  if (key === ' ') return 'Spazio';
  return key.length === 1 ? key.toUpperCase() : key;
}

function nextColor() {
  return COLORS[sounds.size % COLORS.length];
}

// ---------------------------------------------------------------------------
// Pad
// ---------------------------------------------------------------------------
function addPad(sound) {
  const url = URL.createObjectURL(sound.blob);
  const audio = new Audio(url);
  audio.loop = !!sound.loop;
  audio.volume = masterVolume;

  const el = template.content.firstElementChild.cloneNode(true);
  el.style.setProperty('--pad-color', sound.color);
  const entry = { sound, audio, url, el };
  sounds.set(sound.id, entry);

  el.querySelector('.play').addEventListener('click', () => trigger(sound.id));
  el.querySelector('.assign').addEventListener('click', () => startAssign(sound.id));
  el.querySelector('.rename').addEventListener('click', () => rename(sound.id));
  el.querySelector('.loop').addEventListener('click', () => toggleLoop(sound.id));
  el.querySelector('.delete').addEventListener('click', () => removePad(sound.id));

  audio.addEventListener('play', () => {
    el.classList.add('playing');
    requestAnimationFrame(() => tickProgress(entry));
  });
  audio.addEventListener('pause', () => el.classList.remove('playing'));
  audio.addEventListener('ended', () => {
    el.classList.remove('playing');
    el.querySelector('.progress').style.width = '0';
  });
  audio.addEventListener('loadedmetadata', () => {
    // I file webm registrati da Chrome riportano durata Infinity: in quel caso
    // teniamo quella misurata durante la registrazione.
    if (Number.isFinite(audio.duration) && !sound.duration) {
      sound.duration = audio.duration;
      renderPad(entry);
    }
  });

  grid.appendChild(el);
  renderPad(entry);
  updateEmptyState();
}

function renderPad({ sound, el }) {
  el.querySelector('.name').textContent = sound.name;
  el.querySelector('.key').textContent = keyLabel(sound.key);
  el.querySelector('.duration').textContent = formatTime(sound.duration);
  el.querySelector('.loop').classList.toggle('on', !!sound.loop);
  el.classList.toggle('assigning', assigningId === sound.id);
}

function tickProgress(entry) {
  const { audio, sound, el } = entry;
  if (audio.paused) return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : sound.duration;
  const ratio = duration ? (audio.currentTime % duration) / duration : 0;
  el.querySelector('.progress').style.width = `${Math.min(1, ratio) * 100}%`;
  requestAnimationFrame(() => tickProgress(entry));
}

// Premere un pad lo fa ripartire da capo; se è in loop e sta suonando, lo ferma.
function trigger(id) {
  const { audio, sound } = sounds.get(id);
  if (sound.loop && !audio.paused) {
    audio.pause();
    audio.currentTime = 0;
    return;
  }
  audio.currentTime = 0;
  audio.play().catch((err) => console.error('Riproduzione fallita', err));
}

function stopAll() {
  for (const { audio, el } of sounds.values()) {
    audio.pause();
    audio.currentTime = 0;
    el.querySelector('.progress').style.width = '0';
  }
}

async function rename(id) {
  const entry = sounds.get(id);
  const name = prompt('Nome del suono', entry.sound.name);
  if (name === null || !name.trim()) return;
  entry.sound.name = name.trim();
  await db.put(entry.sound);
  renderPad(entry);
}

async function toggleLoop(id) {
  const entry = sounds.get(id);
  entry.sound.loop = !entry.sound.loop;
  entry.audio.loop = entry.sound.loop;
  await db.put(entry.sound);
  renderPad(entry);
}

async function removePad(id) {
  const entry = sounds.get(id);
  if (!confirm(`Eliminare "${entry.sound.name}"?`)) return;
  entry.audio.pause();
  URL.revokeObjectURL(entry.url);
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

async function assignKey(event) {
  const entry = sounds.get(assigningId);
  assigningId = null;
  if (event.code === 'Escape') {
    renderPad(entry);
    return;
  }
  if (event.code === 'Backspace' || event.code === 'Delete') {
    entry.sound.code = null;
    entry.sound.key = null;
  } else if (RESERVED_CODES.has(event.code)) {
    alert(`Il tasto ${keyLabel(event.key)} è riservato.`);
    renderPad(entry);
    return;
  } else {
    // Un tasto può essere legato a un solo suono: lo togliamo agli altri.
    for (const other of sounds.values()) {
      if (other !== entry && other.sound.code === event.code) {
        other.sound.code = null;
        other.sound.key = null;
        await db.put(other.sound);
        renderPad(other);
      }
    }
    entry.sound.code = event.code;
    entry.sound.key = event.key;
  }
  await db.put(entry.sound);
  renderPad(entry);
}

function updateEmptyState() {
  $('#emptyState').hidden = sounds.size > 0;
}

async function createSound(blob, name, duration) {
  const sound = {
    id: crypto.randomUUID(),
    name,
    blob,
    duration: duration || 0,
    color: nextColor(),
    code: null,
    key: null,
    loop: false,
    createdAt: Date.now(),
  };
  await db.put(sound);
  addPad(sound);
}

// ---------------------------------------------------------------------------
// Registrazione
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
    alert(`Impossibile accedere al microfono: ${err.message}`);
    return;
  }
  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    const duration = (performance.now() - recordStart) / 1000;
    stream.getTracks().forEach((t) => t.stop());
    setRecordingUi(false);
    const blob = new Blob(chunks, { type: recorder.mimeType });
    recorder = null;
    if (blob.size) await createSound(blob, `Suono ${sounds.size + 1}`, duration);
  };
  recorder.start();
  recordStart = performance.now();
  setRecordingUi(true);
}

function setRecordingUi(recording) {
  $('#recordBtn').classList.toggle('recording', recording);
  $('#recordLabel').textContent = recording ? 'Stop' : 'Registra';
  const timer = $('#timer');
  timer.hidden = !recording;
  clearInterval(timerHandle);
  if (recording) {
    timer.textContent = '0:00';
    timerHandle = setInterval(() => {
      const s = Math.floor((performance.now() - recordStart) / 1000);
      timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }, 250);
  }
}

// ---------------------------------------------------------------------------
// Eventi globali
// ---------------------------------------------------------------------------
$('#recordBtn').addEventListener('click', toggleRecording);
$('#stopAllBtn').addEventListener('click', stopAll);

$('#masterVolume').addEventListener('input', (e) => {
  masterVolume = Number(e.target.value);
  for (const { audio } of sounds.values()) audio.volume = masterVolume;
  try { localStorage.setItem('soundpad.volume', String(masterVolume)); } catch {}
});

$('#importInput').addEventListener('change', async (e) => {
  for (const file of e.target.files) {
    await createSound(file, file.name.replace(/\.[^.]+$/, ''), 0);
  }
  e.target.value = '';
});

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;

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
  for (const [id, { sound }] of sounds) {
    if (sound.code === e.code) {
      e.preventDefault();
      trigger(id);
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------
(async () => {
  try {
    const saved = Number(localStorage.getItem('soundpad.volume'));
    if (saved >= 0 && saved <= 1 && localStorage.getItem('soundpad.volume') !== null) {
      masterVolume = saved;
      $('#masterVolume').value = String(saved);
    }
  } catch {}

  const all = await db.all();
  all.sort((a, b) => a.createdAt - b.createdAt).forEach(addPad);
  updateEmptyState();
})();
