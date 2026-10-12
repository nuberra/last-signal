/* LAST SIGNAL — Ansicht der Gejagten. Offen, kein Passwort. */
import { CONFIG } from './config.js';
import { store, DEMO } from './store.js';
import { TASKS, APPOINTMENTS } from './data.js';
import { exifGps } from './exif.js';
import {
  $, esc, pad2, formatCoordinate, timeHM, agoText, toast, beep, unlockAudio, shrinkImage,
  registerSW, notifyHunters, checkProximity, statusText, playerName,
} from './common.js';

const ME_KEY = 'ls-bandit';
const QUEUE_KEY = 'ls-loc-queue';
const LAST_KEY = 'ls-last-sent';
const MAX_UPLOAD = 50 * 1024 * 1024;

const root = $('#root');
let me = null;
try { me = JSON.parse(localStorage.getItem(ME_KEY)); } catch { /* leer */ }

const state = {
  conn: DEMO ? 'demo' : 'connecting',
  players: [],
  completions: {},
  proofs: [],
  uploading: {},
  onlyOpen: false,
  fix: null,
  geoError: '',
  lastSent: null,
  sending: false,
  wake: null,
};
try { state.lastSent = JSON.parse(localStorage.getItem(LAST_KEY)); } catch { /* leer */ }

registerSW();

/* ===================== Einrichtung ===================== */

function renderSetup() {
  let slot = CONFIG.BANDITS[0].id;
  root.innerHTML = `
    ${DEMO ? '<div class="demo-bar">Demo-Modus · nur dieses Gerät</div>' : ''}
    <div class="gate ls-anim-rise">
      <img class="mark" src="/icons/pin.svg" alt="">
      <div class="label">Staffel 01 · Stuttgart · 29.10. bis 01.11.2026</div>
      <h1 class="display d-xl" style="margin-top:16px">Last Signal</h1>
      <div class="display d-s" style="color:var(--orange);margin-top:8px">Bandits</div>
      <div class="field">
        <span class="label">Wer bist du</span>
        <div class="choice" id="slots">
          ${CONFIG.BANDITS.map((b, i) => `<button class="btn ${i === 0 ? 'on' : ''}" data-slot="${b.id}">${esc(b.name)}</button>`).join('')}
        </div>
      </div>
      <button class="btn solid block" id="go" style="margin-top:16px">Starten</button>
      <p class="label" style="margin-top:16px">Danach fragt das Gerät nach dem Standort. Erlauben ist Pflicht.</p>
    </div>`;
  root.querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => {
    slot = b.dataset.slot;
    root.querySelectorAll('[data-slot]').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#go').onclick = async () => {
    unlockAudio();
    me = { id: slot, name: CONFIG.BANDITS.find((b) => b.id === slot).name };
    localStorage.setItem(ME_KEY, JSON.stringify(me));
    store.upsertPlayer({ id: me.id, name: me.name, role: 'bandit' }).catch(() => {});
    start();
  };
}

/* ===================== Standort ===================== */

function startGeo() {
  if (!('geolocation' in navigator)) { state.geoError = 'STANDORT AUF DIESEM GERÄT NICHT VERFÜGBAR'; return; }
  navigator.geolocation.watchPosition(
    (p) => {
      const hadError = !!state.geoError;
      state.fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, ts: Date.now() };
      state.geoError = '';
      if (hadError) renderSignal();
    },
    (e) => { state.geoError = e.code === 1 ? 'STANDORT NICHT ERLAUBT. IN DEN EINSTELLUNGEN FREIGEBEN.' : 'KEIN GPS-SIGNAL'; renderSignal(); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
  );
}

/* Genaue Position: bis zu 15 s auf eine GPS-Messung mit <= 25 m warten und die beste
   Messung aus diesem Fenster nehmen. Grobe WLAN-/Funkzellen-Werte werden so vermieden. */
const GOOD_ACC = 25;
function freshFix(maxWait = 15000) {
  if (state.fix && Date.now() - state.fix.ts < 15000 && state.fix.accuracy <= GOOD_ACC) return Promise.resolve(state.fix);
  return new Promise((res, rej) => {
    let best = state.fix && Date.now() - state.fix.ts < 60000 ? state.fix : null;
    let done = false;
    const finish = (err) => {
      if (done) return; done = true;
      navigator.geolocation.clearWatch(id); clearTimeout(timer);
      if (best) { state.fix = best; res(best); } else rej(err || { code: 2 });
    };
    const id = navigator.geolocation.watchPosition((p) => {
      const f = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, ts: Date.now() };
      if (!best || f.accuracy < best.accuracy || Date.now() - best.ts > 60000) best = f;
      if (f.accuracy <= GOOD_ACC) finish();
    }, (e) => { if (e.code === 1) finish(e); }, { enableHighAccuracy: true, maximumAge: 0, timeout: maxWait });
    const timer = setTimeout(() => finish(), maxWait);
  });
}

/* Akkustand: nur Chrome/Android kennt die Battery-API, iPhone liefert nichts. */
async function batteryInfo() {
  try {
    if (!navigator.getBattery) return {};
    const b = await navigator.getBattery();
    return { battery: Math.round(b.level * 100), charging: b.charging };
  } catch { return {}; }
}

const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; } };
const writeQueue = (q) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-200)));

async function flushQueue() {
  const q = readQueue();
  while (q.length) {
    try { await store.addLocation(q[0]); q.shift(); writeQueue(q); } catch { break; }
  }
}

async function sendNow(source) {
  if (state.sending) return;
  state.sending = true; renderSignal();
  try {
    const f = await freshFix();
    const row = { player_id: me.id, lat: f.lat, lng: f.lng, accuracy: Math.round(f.accuracy), source, created_at: new Date().toISOString(), ...(await batteryInfo()) };
    state.lastSent = { at: row.created_at, lat: f.lat, lng: f.lng, accuracy: row.accuracy };
    localStorage.setItem(LAST_KEY, JSON.stringify(state.lastSent));
    try {
      await flushQueue();
      await store.addLocation(row);
      checkProximity(me.id, source);
      if (source !== 'auto') toast('Signal', 'Standort gesendet ' + timeHM(row.created_at), 'bandit');
    } catch {
      const q = readQueue(); q.push(row); writeQueue(q);
      if (source !== 'auto') toast('Signal', 'Kein Netz. Wird nachgesendet.', 'bandit');
    }
  } catch (e) {
    state.geoError = e && e.code === 1 ? 'STANDORT NICHT ERLAUBT. IN DEN EINSTELLUNGEN FREIGEBEN.' : 'KEIN GPS-SIGNAL';
    if (source === 'manual') toast('Signal', state.geoError);
  } finally {
    state.sending = false; renderSignal();
  }
}

function tick() {
  const last = state.lastSent ? new Date(state.lastSent.at).getTime() : 0;
  if (!state.sending && Date.now() - last >= CONFIG.LOCATION_INTERVAL_S * 1000) sendNow('auto');
  updateClock();
}

/* Jede Sekunde nur die laufenden Werte, damit die Knöpfe stehen bleiben. */
function updateClock() {
  const ls = state.lastSent;
  const last = ls ? new Date(ls.at).getTime() : 0;
  const left = Math.max(0, Math.round((last + CONFIG.LOCATION_INTERVAL_S * 1000 - Date.now()) / 1000));
  const n = $('#next'), a = $('#age');
  if (n) n.textContent = state.sending ? 'SENDET' : pad2(Math.floor(left / 60)) + ':' + pad2(left % 60);
  if (a) a.textContent = ls ? agoText(ls.at) : 'NOCH NICHT GESENDET';
}

async function toggleWake() {
  state.wantWake = !state.wake;
  await applyWake();
}

async function applyWake() {
  try {
    if (!state.wantWake) { if (state.wake) await state.wake.release(); state.wake = null; }
    else if (state.wake) return;
    else if ('wakeLock' in navigator) {
      state.wake = await navigator.wakeLock.request('screen');
      state.wake.addEventListener('release', () => { state.wake = null; renderSignal(); });
    } else { state.wantWake = false; toast('Bildschirm', 'Auf diesem Gerät nicht verfügbar'); }
  } catch { toast('Bildschirm', 'Nicht möglich'); }
  renderSignal();
}

/* ===================== Darstellung ===================== */

function renderShell() {
  root.innerHTML = `
    ${DEMO ? '<div class="demo-bar">Demo-Modus · nur dieses Gerät</div>' : ''}
    <div class="wrap">
      <div class="topbar">
        <div>
          <div class="label">Staffel 01 · Stuttgart</div>
          <div class="brand" style="margin-top:8px">Last Signal</div>
        </div>
        <div class="status label" id="conn"><span class="sq"></span><span></span></div>
      </div>
      <div class="panel" id="signal"></div>
      <div class="section" id="tally"></div>
      <div class="section">
        <div class="section-head"><h2 class="display d-s">Pflichttermine</h2><span class="label" id="appt-count"></span></div>
        <div id="appts"></div>
      </div>
      <div class="section">
        <div class="section-head">
          <h2 class="display d-s">Aufgaben</h2>
          <button class="btn quiet small" id="filter"></button>
        </div>
        <ul class="tasks" id="tasks"></ul>
      </div>
      <div class="section">
        <div class="label">Auf den Home-Bildschirm legen: iPhone Safari Teilen, Zum Home-Bildschirm. Android Chrome Menü, App installieren.</div>
        <div class="label" style="margin-top:16px">Standort wird nur gesendet, solange diese Seite offen ist. Gesperrter Bildschirm stoppt den Versand.</div>
        <button class="btn quiet small" id="reset" style="margin-top:24px">Gerät zurücksetzen</button>
      </div>
    </div>`;
  $('#filter').onclick = () => { state.onlyOpen = !state.onlyOpen; renderTasks(); };
  $('#reset').onclick = () => {
    if (!confirm('Platz und Namen auf diesem Gerät löschen?')) return;
    localStorage.removeItem(ME_KEY); location.reload();
  };
  renderConn(); renderSignal(); renderLists();
}

function renderConn() {
  const el = $('#conn'); if (!el) return;
  el.className = 'status label ' + state.conn;
  el.lastElementChild.textContent = statusText(state.conn);
}

function renderSignal() {
  const el = $('#signal'); if (!el) return;
  const ls = state.lastSent;
  const last = ls ? new Date(ls.at).getTime() : 0;
  const left = Math.max(0, Math.round((last + CONFIG.LOCATION_INTERVAL_S * 1000 - Date.now()) / 1000));
  const q = readQueue().length;
  el.innerHTML = `
    <span class="label panel-label">Signal</span>
    <div class="spur bandit">
      <div class="display d-m">${esc(me.name)}</div>
      <div class="label" style="margin-top:4px">${esc((CONFIG.BANDITS.find((b) => b.id === me.id) || {}).label || '')}</div>
    </div>
    <hr class="rule">
    <div class="kv">
      <span class="label">Letztes Signal</span>
      <span class="signal-big">${ls ? timeHM(ls.at) : '--:--'}</span>
      <span class="label">Alter</span>
      <span class="value" id="age">${ls ? agoText(ls.at) : 'NOCH NICHT GESENDET'}</span>
      <span class="label">Position</span>
      <span class="value">${ls ? formatCoordinate(ls.lat, ls.lng) : '-'}</span>
      <span class="label">Genauigkeit</span>
      <span class="value">${ls ? '±' + ls.accuracy + ' M' : '-'}${state.fix && !state.sending ? ' · JETZT ±' + Math.round(state.fix.accuracy) + ' M' : ''}</span>
      <span class="label">Nächster</span>
      <span class="value" id="next">${state.sending ? 'SENDET' : pad2(Math.floor(left / 60)) + ':' + pad2(left % 60)}</span>
      ${q ? `<span class="label">Wartend</span><span class="value">${q} OHNE NETZ</span>` : ''}
    </div>
    ${state.geoError ? `<div class="label" style="color:var(--bone);margin-top:16px">${esc(state.geoError)}</div>` : ''}
    <div class="btn-row" style="margin-top:16px">
      <button class="btn solid" id="send" ${state.sending ? 'disabled' : ''}>Jetzt senden</button>
      <button class="btn ${state.wantWake ? 'on' : ''}" id="wake">Bildschirm wach</button>
    </div>`;
  $('#send').onclick = () => { unlockAudio(); sendNow('manual'); };
  $('#wake').onclick = toggleWake;
}

function renderLists() { renderTally(); renderAppts(); renderTasks(); }

const isDone = (id) => !!(state.completions[id] && state.completions[id].done);
const proofsOf = (id) => state.proofs.filter((p) => p.task_id === id);

function renderTally() {
  const el = $('#tally'); if (!el) return;
  const t = TASKS.filter((x) => isDone(x.id)).length;
  const a = APPOINTMENTS.filter((x) => isDone(x.id)).length;
  el.innerHTML = `
    <div style="display:flex;gap:32px;flex-wrap:wrap">
      <div><div class="label">Aufgaben</div><div class="tally"><span class="big">${pad2(t)}</span><span class="value muted">/24</span></div></div>
      <div><div class="label">Termine</div><div class="tally"><span class="big">${pad2(a)}</span><span class="value muted">/03</span></div></div>
    </div>`;
}

function apptState(a, now = Date.now()) {
  const s = new Date(a.start).getTime(), e = new Date(a.end).getTime();
  if (now < s) return { key: 'next', text: 'Kommt' };
  if (now <= e) return { key: 'now', text: 'Jetzt' };
  return { key: 'past', text: 'Vorbei' };
}

function renderAppts() {
  const el = $('#appts'); if (!el) return;
  $('#appt-count').textContent = pad2(APPOINTMENTS.filter((x) => isDone(x.id)).length) + '/03';
  el.innerHTML = APPOINTMENTS.map((a) => {
    const st = apptState(a);
    const c = state.completions[a.id];
    return `<div class="appt">
      <div>
        <div class="when"><span class="label" style="color:var(--bone)">${esc(a.day)}</span><span class="label">${esc(a.window)}</span><span class="state-tag ${st.key}">${st.text}</span></div>
        <div class="display d-xs" style="margin-top:8px">${esc(a.place)}</div>
        <div class="label" style="margin-top:4px">${esc(a.note)}</div>
        <div class="label" style="margin-top:4px">${formatCoordinate(a.lat, a.lng)}</div>
        ${c && c.done ? `<div class="label" style="margin-top:8px;color:var(--bone)">Erschienen ${timeHM(c.done_at)} · ${esc(playerName(state.players, c.done_by))}</div>` : ''}
        <a class="label" style="display:inline-block;margin-top:8px" href="https://maps.google.com/?q=${a.lat},${a.lng}" target="_blank" rel="noopener">Route öffnen</a>
      </div>
      <input type="checkbox" class="check" data-appt="${a.id}" ${c && c.done ? 'checked' : ''} aria-label="Erschienen">
    </div>`;
  }).join('');
  el.querySelectorAll('[data-appt]').forEach((cb) => cb.onchange = () => toggleDone(cb.dataset.appt, cb.checked, cb));
}

function proofLabel(p) {
  return { photo: 'Fotobeweis', video: 'Videobeweis', 'photo+video': 'Foto- oder Videobeweis', none: 'Kein Beweis, nur abhaken' }[p];
}
function acceptFor(p) {
  return p === 'video' ? 'video/*' : p === 'photo' ? 'image/*' : 'image/*,video/*';
}

function thumbHtml(p, removable) {
  const isVideo = (p.kind || '').startsWith('video');
  const media = !p.url ? '<div class="label" style="padding:8px">VIDEO</div>'
    : isVideo ? `<video src="${esc(p.url)}#t=0.1" muted playsinline preload="metadata"></video>`
    : `<img src="${esc(p.url)}" alt="" loading="lazy">`;
  return `<div class="thumb" data-view="${p.id}">${media}<span class="label tag">${isVideo ? 'VIDEO' : 'FOTO'}</span>${removable ? `<button class="rm" data-rm="${p.id}">Weg</button>` : ''}</div>`;
}

function renderTasks() {
  const el = $('#tasks'); if (!el) return;
  $('#filter').textContent = state.onlyOpen ? 'Alle zeigen' : 'Nur offene';
  const list = TASKS.filter((t) => !state.onlyOpen || !isDone(t.id));
  el.innerHTML = list.map((t) => {
    const done = isDone(t.id);
    const c = state.completions[t.id];
    const proofs = proofsOf(t.id);
    const needs = t.proof !== 'none';
    const canCheck = done || !needs || proofs.length > 0;
    const busy = state.uploading[t.id];
    return `<li class="task ${done ? 'done' : ''}">
      <div class="idx">${pad2(t.n)}</div>
      <div class="body">
        <div class="head">
          <div class="title">${esc(t.title)}</div>
          <input type="checkbox" class="check" data-task="${t.id}" ${done ? 'checked' : ''} ${canCheck ? '' : 'disabled'} aria-label="Erledigt">
        </div>
        <div class="meta">
          <span class="label">${proofLabel(t.proof)}</span>
          ${done ? `<span class="label" style="color:var(--bone)">Erledigt ${timeHM(c.done_at)} · ${esc(playerName(state.players, c.done_by))}</span>`
            : needs && !proofs.length ? '<span class="label">Abhaken erst nach Upload</span>' : ''}
        </div>
      </div>
      ${needs ? `<div class="tools">
        ${proofs.length ? `<div class="thumbs">${proofs.map((p) => thumbHtml(p, !done)).join('')}</div>` : ''}
        ${busy ? `<div><div class="label" style="margin-bottom:8px">Upload läuft</div><div class="upload-progress"></div></div>` : ''}
        ${!done ? `<div class="btn-row">
          <button class="btn small" data-up="${t.id}" data-cam="1" ${busy ? 'disabled' : ''}>Kamera</button>
          <button class="btn small" data-up="${t.id}" ${busy ? 'disabled' : ''}>Datei</button>
        </div>` : ''}
      </div>` : ''}
    </li>`;
  }).join('');
  el.querySelectorAll('[data-task]').forEach((cb) => cb.onchange = () => toggleDone(cb.dataset.task, cb.checked, cb));
  el.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => pickFile(b.dataset.up, !!b.dataset.cam));
  el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); removeProof(Number(b.dataset.rm) || b.dataset.rm); });
  el.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => openProof(b.dataset.view));
}

function openProof(id) {
  const p = state.proofs.find((x) => String(x.id) === String(id));
  if (!p || !p.url) return;
  const isVideo = (p.kind || '').startsWith('video');
  const lb = document.createElement('div');
  lb.className = 'lightbox ls-anim-settle';
  lb.innerHTML = `<div class="lb-bar"><span class="label">${esc(timeHM(p.created_at))}</span><button class="btn small">Schliessen</button></div>
    <div class="lb-media">${isVideo ? `<video src="${esc(p.url)}" controls playsinline autoplay></video>` : `<img src="${esc(p.url)}" alt="">`}</div>`;
  lb.querySelector('button').onclick = () => lb.remove();
  document.body.appendChild(lb);
}

/* ===================== Aktionen ===================== */

/* Ein festes Dateifeld ausserhalb der Liste: überlebt Live-Updates,
   während die Kamera offen ist. */
let picker = null, pickTask = null;
function pickFile(taskId, camera) {
  const t = TASKS.find((x) => x.id === taskId);
  if (!picker) {
    picker = document.createElement('input');
    picker.type = 'file'; picker.hidden = true;
    document.body.appendChild(picker);
    picker.onchange = () => { if (picker.files[0] && pickTask) upload(pickTask, picker.files[0]); picker.value = ''; };
  }
  pickTask = taskId;
  picker.accept = acceptFor(t.proof);
  if (camera) picker.setAttribute('capture', 'environment'); else picker.removeAttribute('capture');
  picker.click();
}

async function upload(taskId, raw) {
  unlockAudio();
  /* Ort des Beweises: GPS aus dem Foto (EXIF), sonst die aktuelle Position des Geraets.
     EXIF zuerst lesen, das Verkleinern entfernt die Metadaten. */
  const exif = await exifGps(raw);
  const devicePos = exif ? null : freshFix(8000).catch(() => null);
  const file = await shrinkImage(raw);
  if (file.size > MAX_UPLOAD) { toast('Upload', 'Datei zu gross, maximal 50 MB. Video kürzen.'); return; }
  state.uploading[taskId] = true; renderTasks();
  try {
    const { url, path } = await store.uploadProof(file, taskId);
    const dev = devicePos ? await devicePos : null;
    const geo = exif ? { lat: exif.lat, lng: exif.lng, geo_source: 'exif' } : dev ? { lat: dev.lat, lng: dev.lng, geo_source: 'device' } : {};
    const [row] = await store.addProof({ task_id: taskId, url, path, kind: file.type || 'application/octet-stream', uploaded_by: me.id, ...geo });
    if (row && !state.proofs.some((p) => p.id === row.id)) state.proofs.push(row);
    toast('Beweis', 'Hochgeladen. Aufgabe kann abgehakt werden.', 'bandit');
  } catch (e) {
    console.error(e);
    toast('Upload', 'Fehlgeschlagen. Netz prüfen und erneut versuchen.');
  } finally {
    delete state.uploading[taskId]; renderTasks();
  }
}

async function removeProof(id) {
  if (!confirm('Diesen Beweis entfernen?')) return;
  try {
    await store.deleteProof(id);
    state.proofs = state.proofs.filter((p) => p.id !== id);
    renderTasks();
  } catch { toast('Beweis', 'Entfernen fehlgeschlagen'); }
}

async function toggleDone(id, done, cb) {
  unlockAudio();
  const task = TASKS.find((t) => t.id === id);
  const appt = APPOINTMENTS.find((a) => a.id === id);
  if (!done && !confirm('Wieder auf offen setzen?')) { cb.checked = true; return; }
  if (done && task && task.proof !== 'none' && !proofsOf(id).length) { cb.checked = false; toast('Aufgabe', 'Zuerst Beweis hochladen'); return; }
  cb.disabled = true;
  try {
    const [row] = await store.setCompletion(id, done, me.id);
    state.completions[id] = row || { task_id: id, done, done_by: me.id, done_at: new Date().toISOString() };
    renderLists();
    if (done) {
      if (navigator.vibrate) navigator.vibrate(60);
      const what = task ? 'AUFGABE ' + pad2(task.n) + ' ERLEDIGT' : 'PFLICHTTERMIN ' + pad2(appt.n) + ' ERLEDIGT';
      notifyHunters(what, (task ? task.title : appt.place) + ' · ' + me.name.toUpperCase());
      /* Bei jeder Abgabe wird der Standort mitgeschickt; der 20-Minuten-Takt startet neu. */
      sendNow('task');
    }
  } catch {
    cb.checked = !done; cb.disabled = false;
    toast('Aufgabe', 'Speichern fehlgeschlagen. Netz prüfen.');
  }
}

/* ===================== Live-Daten ===================== */

async function loadAll() {
  try {
    const [players, completions, proofs] = await Promise.all([store.getPlayers(), store.getCompletions(), store.getProofs()]);
    state.players = players;
    state.completions = Object.fromEntries(completions.map((c) => [c.task_id, c]));
    state.proofs = proofs;
    renderLists();
  } catch (e) {
    console.error(e);
    state.conn = 'offline'; renderConn();
  }
}

function onEvent({ table, type, row }) {
  if (table === 'players') {
    state.players = state.players.filter((p) => p.id !== row.id).concat(type === 'DELETE' ? [] : [row]);
    renderLists();
  } else if (table === 'completions') {
    const before = state.completions[row.task_id];
    state.completions[row.task_id] = row;
    renderLists();
    if (row.done && !(before && before.done) && row.done_by !== me.id) {
      const t = TASKS.find((x) => x.id === row.task_id);
      toast(playerName(state.players, row.done_by), (t ? pad2(t.n) + ' ' + t.title : 'Pflichttermin') + ' erledigt', 'bandit');
    }
  } else if (table === 'proofs') {
    if (type === 'DELETE') state.proofs = state.proofs.filter((p) => p.id !== row.id);
    else if (!state.proofs.some((p) => p.id === row.id)) state.proofs.push(row);
    renderTasks();
  }
}

function start() {
  renderShell();
  store.upsertPlayer({ id: me.id, name: me.name, role: 'bandit' }).catch(() => {});
  loadAll();
  store.subscribe(onEvent, (s) => { if (!DEMO) { const was = state.conn; state.conn = s; renderConn(); if (was !== 'live' && s === 'live') loadAll(); } });
  startGeo();
  setInterval(tick, 1000);
  tick();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (state.wantWake) applyWake();
    tick();
    loadAll();
  });
  window.addEventListener('online', flushQueue);
}

/* Namen sind fest vergeben: gespeicherten Platz immer mit dem Namen aus der Konfiguration abgleichen. */
const mySlot = me && CONFIG.BANDITS.find((b) => b.id === me.id);
if (mySlot) { me.name = mySlot.name; localStorage.setItem(ME_KEY, JSON.stringify(me)); start(); } else renderSetup();
