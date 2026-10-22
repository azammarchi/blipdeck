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
  el.querySelector('.trim').addEventListener('click', () => openTrim(sound.id));
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
// Ritaglio: l'audio viene decodificato, si sceglie inizio/fine sulla forma
// d'onda e la parte tenuta viene salvata come WAV al posto dell'originale.
// ---------------------------------------------------------------------------
const MIN_TRIM = 0.05; // secondi
const FADE = 0.005; // dissolvenza ai bordi del taglio, evita i "click"

const trimDialog = $('#trimDialog');
const wave = $('.wave-wrap');
const trim = { entry: null, buffer: null, start: 0, end: 0, source: null, raf: 0 };
let audioCtx = null;
let dragging = null;

async function openTrim(id) {
  const entry = sounds.get(id);
  entry.audio.pause();
  audioCtx ||= new AudioContext();
  let buffer;
  try {
    buffer = await audioCtx.decodeAudioData(await entry.sound.blob.arrayBuffer());
  } catch (err) {
    alert(`Impossibile leggere l'audio: ${err.message}`);
    return;
  }
  Object.assign(trim, { entry, buffer, start: 0, end: buffer.duration });
  $('#trimName').textContent = `"${entry.sound.name}"`;
  trimDialog.showModal();
  drawWaveform();
  renderTrim();
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
}

function timeAt(clientX) {
  const rect = wave.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * trim.buffer.duration;
}

function moveHandle(t) {
  stopPreview();
  if (dragging === 'start') trim.start = Math.max(0, Math.min(t, trim.end - MIN_TRIM));
  else trim.end = Math.min(trim.buffer.duration, Math.max(t, trim.start + MIN_TRIM));
  renderTrim();
}

// Un clic o trascinamento sposta la maniglia più vicina al puntatore.
wave.addEventListener('pointerdown', (e) => {
  const t = timeAt(e.clientX);
  dragging = Math.abs(t - trim.start) <= Math.abs(t - trim.end) ? 'start' : 'end';
  wave.setPointerCapture(e.pointerId);
  moveHandle(t);
});
wave.addEventListener('pointermove', (e) => dragging && moveHandle(timeAt(e.clientX)));
wave.addEventListener('pointerup', () => (dragging = null));
wave.addEventListener('pointercancel', () => (dragging = null));

function startPreview() {
  stopPreview();
  const source = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  gain.gain.value = masterVolume;
  source.buffer = trim.buffer;
  source.connect(gain).connect(audioCtx.destination);
  const startedAt = audioCtx.currentTime;
  source.start(0, trim.start, trim.end - trim.start);
  source.onended = () => trim.source === source && stopPreview();
  trim.source = source;
  $('#trimPreviewBtn').textContent = '■ Stop';
  const playhead = $('#trimPlayhead');
  playhead.hidden = false;
  const tick = () => {
    const t = trim.start + (audioCtx.currentTime - startedAt);
    playhead.style.left = `${(Math.min(t, trim.end) / trim.buffer.duration) * 100}%`;
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
  $('#trimPreviewBtn').textContent = '▶ Anteprima';
}

// Toglie il silenzio iniziale e finale: soglia relativa al picco del suono.
function autoTrim() {
  const { buffer } = trim;
  const channels = [...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c));
  const level = (i) => Math.max(...channels.map((ch) => Math.abs(ch[i])));
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, level(i));
  if (!peak) return;
  const threshold = peak * 0.08;
  let first = 0;
  while (first < buffer.length && level(first) < threshold) first++;
  let last = buffer.length - 1;
  while (last > first && level(last) < threshold) last--;
  const pad = 0.05;
  stopPreview();
  trim.start = Math.max(0, first / buffer.sampleRate - pad);
  trim.end = Math.min(buffer.duration, last / buffer.sampleRate + pad);
  if (trim.end - trim.start < MIN_TRIM) trim.end = Math.min(buffer.duration, trim.start + MIN_TRIM);
  renderTrim();
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

async function saveTrim() {
  const { entry, buffer, start, end } = trim;
  stopPreview();
  entry.sound.blob = encodeWav(buffer, start, end);
  entry.sound.duration = end - start;
  await db.put(entry.sound);
  URL.revokeObjectURL(entry.url);
  entry.url = URL.createObjectURL(entry.sound.blob);
  entry.audio.src = entry.url;
  entry.el.querySelector('.progress').style.width = '0';
  renderPad(entry);
  trimDialog.close();
}

$('#trimPreviewBtn').addEventListener('click', () => (trim.source ? stopPreview() : startPreview()));
$('#trimAutoBtn').addEventListener('click', autoTrim);
$('#trimSaveBtn').addEventListener('click', saveTrim);
trimDialog.addEventListener('close', () => {
  stopPreview();
  trim.entry = null;
  trim.buffer = null;
});

// ---------------------------------------------------------------------------
// Export / import: un unico file JSON con tutti i suoni (audio in base64),
// nomi, tasti, colori e loop. Serve per backup o per spostarli su un altro PC.
// ---------------------------------------------------------------------------
const BANK_FORMAT = 'soundpad-bank';

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
    alert('Non ci sono suoni da esportare.');
    return;
  }
  const list = [...sounds.values()].map((e) => e.sound).sort((a, b) => a.createdAt - b.createdAt);
  const bank = {
    format: BANK_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    sounds: await Promise.all(
      list.map(async ({ blob, id, ...meta }) => ({ ...meta, audio: await blobToDataUrl(blob) })),
    ),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(bank)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `soundpad-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBank(file) {
  let bank;
  try {
    bank = JSON.parse(await file.text());
  } catch {
    alert(`"${file.name}" non è un file JSON valido.`);
    return;
  }
  if (bank?.format !== BANK_FORMAT || !Array.isArray(bank.sounds)) {
    alert(`"${file.name}" non è una soundboard esportata da Soundpad.`);
    return;
  }
  const replace =
    sounds.size > 0 &&
    confirm(
      `Importo ${bank.sounds.length} suoni.\n\n` +
        'OK = sostituisci tutti i suoni attuali\nAnnulla = aggiungili a quelli esistenti',
    );
  if (replace) {
    stopAll();
    for (const [id, entry] of sounds) {
      URL.revokeObjectURL(entry.url);
      entry.el.remove();
      await db.remove(id);
    }
    sounds.clear();
  }
  const usedCodes = new Set([...sounds.values()].map((e) => e.sound.code).filter(Boolean));
  for (const item of bank.sounds) {
    const blob = await (await fetch(item.audio)).blob();
    // In aggiunta, i tasti già usati restano ai suoni esistenti.
    const keepKey = item.code && !usedCodes.has(item.code) && !RESERVED_CODES.has(item.code);
    if (keepKey) usedCodes.add(item.code);
    const sound = {
      id: crypto.randomUUID(),
      name: String(item.name || 'Suono'),
      blob,
      duration: Number(item.duration) || 0,
      color: item.color || nextColor(),
      code: keepKey ? item.code : null,
      key: keepKey ? item.key : null,
      loop: !!item.loop,
      createdAt: Date.now() + sounds.size, // mantiene l'ordine del file
    };
    await db.put(sound);
    addPad(sound);
  }
  updateEmptyState();
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
    if (file.name.endsWith('.json') || file.type === 'application/json') {
      await importBank(file);
    } else {
      await createSound(file, file.name.replace(/\.[^.]+$/, ''), 0);
    }
  }
  e.target.value = '';
});

$('#exportBtn').addEventListener('click', exportBank);

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (trimDialog.open) return;
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
