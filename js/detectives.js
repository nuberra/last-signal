/* LAST SIGNAL — Ansicht der Jäger. Karte, Aufgaben, Export. */
import { CONFIG } from './config.js';
import { store, DEMO } from './store.js';
import { TASKS, APPOINTMENTS, POI_CATEGORIES, LIVE_LAYERS, ALERT_RADIUS_M, GAME_START, GAME_END } from './data.js';
import { loadOsm, cachedOsm, loadRoutes } from './osm.js';
import { openState, openText, windowsUntil, stays, walkMin, driveMin, transitMin, guessLines, hm, DAYS } from './hunt.js';
import {
  $, esc, pad2, formatCoordinate, distanceM, formatDistance, timeHM, agoText, toast, beep, unlockAudio,
  registerSW, statusText, playerName, playerColor, pushSupported, enablePush, pushActive,
} from './common.js';

const L = window.L;
const AUTH_KEY = 'ls-hunter-ok';
const PREF_KEY = 'ls-hunter-prefs-v2';
const STALE_MIN = 30;
const root = $('#root');

const DEFAULT_LAYERS = { ...Object.fromEntries(POI_CATEGORIES.map((c) => [c.id, true])), oepnv: true, gym: false, spielplatz: false, cafe: false, apotheke: false, fotos: true, notizen: false, zeichnungen: false, jaeger: true, halte: true };
let prefs = { layers: { ...DEFAULT_LAYERS }, rings: false, reach: true, tiles: 'light', route: 'all', sheet: true, showAll: false };
try { const saved = JSON.parse(localStorage.getItem(PREF_KEY)) || {}; prefs = { ...prefs, ...saved, layers: { ...DEFAULT_LAYERS, ...(saved.layers || {}) } }; } catch { /* Standard */ }
if (!['light', 'transit'].includes(prefs.tiles)) prefs.tiles = 'light';
const NAME_KEY = 'ls-hunter-name';
let hunterName = localStorage.getItem(NAME_KEY) || '';
const myHunterId = () => 'h:' + hunterName.toLowerCase();
const savePrefs = () => localStorage.setItem(PREF_KEY, JSON.stringify(prefs));

const state = {
  conn: DEMO ? 'demo' : 'connecting',
  tab: 'map',
  players: [],
  locs: {},            // player_id -> sichtbare Punkte (Gejagte: nur freigegebene)
  raw: {},             // player_id -> alle gespeicherten Punkte
  completions: {},
  proofs: [],
  inside: new Set(),   // "player|poi" innerhalb 500 m
  alarms: [],
  alarmLog: [],
  desk: false,
  sub: 'lage',
  unseenTasks: 0,
  soundOn: false,
  push: false,
  me: null,           // eigener Standort {lat,lng,acc,ts}
  placingCar: false,
  osm: null,
  osmStatus: '',
  items: [],          // Notizen und Zeichnungen der Jaeger
  drawing: false,
  drawColor: '#6E8CA8',
};

const BANDIT_IDS = () => {
  const ids = CONFIG.BANDITS.map((b) => b.id);
  state.players.filter((p) => p.role === 'bandit' && !ids.includes(p.id)).forEach((p) => ids.push(p.id));
  /* Testgeraet nur zeigen, solange es Punkte hat */
  const t = CONFIG.TEST_TRACKER;
  if (t && state.locs[t.id] && state.locs[t.id].length) ids.push(t.id);
  return ids;
};
const latest = (id) => { const a = state.locs[id]; return a && a.length ? a[a.length - 1] : null; };
/* Neuester gespeicherter Punkt, auch wenn noch nicht freigegeben: nur fuer Funkstille. */
const latestRaw = (id) => { const a = state.raw[id]; return a && a.length ? a[a.length - 1] : null; };
const allPois = () => POI_CATEGORIES.flatMap((c) => c.items.map((it) => ({ ...it, cat: c.id, catLabel: c.label, key: c.id + ':' + it.name })));
const visiblePois = () => allPois().filter((p) => prefs.layers[p.cat] && !poiDone(p));

registerSW();

/* ===================== Passwort ===================== */

function renderGate() {
  root.innerHTML = `
    <div class="gate ls-anim-rise">
      <img class="mark" src="/icons/pin.svg" alt="">
      <div class="label">Staffel 01 · Stuttgart</div>
      <h1 class="display d-xl" style="margin-top:16px">Last Signal</h1>
      <div class="display d-s" style="color:var(--steel);margin-top:8px">Detectives</div>
      <form id="f">
        <label class="field">
          <span class="label">Dein Name</span>
          <input id="hn" autocomplete="given-name" maxlength="16" value="${esc(hunterName)}">
        </label>
        <label class="field">
          <span class="label">Passwort</span>
          <input id="pw" type="password" autocomplete="current-password" autocapitalize="off">
        </label>
        <div class="label error" id="err"></div>
        <button class="btn solid block" style="margin-top:16px">Öffnen</button>
      </form>
    </div>`;
  $('#f').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#pw').value.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!$('#hn').value.trim()) { $('#err').textContent = 'NAME FEHLT'; return; }
    if (v !== CONFIG.HUNTER_PASSWORD.toLowerCase()) { $('#err').textContent = 'PASSWORT FALSCH'; return; }
    hunterName = $('#hn').value.trim().toUpperCase(); localStorage.setItem(NAME_KEY, hunterName);
    localStorage.setItem(AUTH_KEY, '1');
    unlockAudio(); state.soundOn = true;
    start();
  };
}

/* ===================== Rahmen ===================== */

function renderShell() {
  root.innerHTML = `
    <div class="app">
      ${DEMO ? '<div class="demo-bar">Demo-Modus · nur dieses Gerät</div>' : ''}
      <div class="app-head">
        <div class="brand">Last Signal</div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn quiet small" id="sound"></button>
          <button class="btn quiet small" id="push" hidden>Push</button>
          <div class="status label" id="conn"><span class="sq"></span><span></span></div>
        </div>
      </div>
      <div class="app-body">
      <div class="view" id="v-map">
        <div id="map"></div>
        <div class="map-overlay map-top" id="alarms"></div>
        <div class="map-overlay map-tools">
          <button class="btn" id="b-layers">Ebenen</button>
          <button class="btn" id="b-fit">Alle</button>
          <button class="btn" id="b-me">Ich</button>
          <button class="btn" id="b-car">Auto</button>
          <button class="btn" id="b-compass">Kompass</button>
        </div>
        <div class="layers" id="layers" hidden></div>
        <div class="drawbar" id="drawbar" hidden></div>
        <div class="drawbar replaybar" id="replaybar" hidden></div>
        <div class="map-overlay map-bottom">
          <div class="sheet ${prefs.sheet ? '' : 'collapsed'}" id="sheet">
            <div class="sheet-handle" id="sheet-handle"><span class="label">Bandits</span><span class="label" id="sheet-sum"></span></div>
            <div class="sheet-body" id="cards"></div>
          </div>
        </div>
      </div>
      <aside class="side">
        <nav class="tabs side-tabs">
          <button data-tab="bandits">Bandits</button>
          <button data-tab="tasks">Aufgaben<span class="badge" hidden></span></button>
          <button data-tab="more">Mehr</button>
        </nav>
        <div class="view scroll" id="v-bandits" hidden><div class="wrap" id="bandits-wrap"></div></div>
        <div class="view scroll" id="v-tasks" hidden><div class="wrap" id="tasks-wrap"></div></div>
        <div class="view scroll" id="v-more" hidden>
          <div class="wrap">
            <div class="seg more-seg">
              <button class="btn" data-sub="lage">Lage</button>
              <button class="btn" data-sub="notes">Notizen</button>
              <button class="btn" data-sub="export">Export</button>
            </div>
            <div class="more-tools">
              <span class="label">Werkzeuge</span>
              <div class="btn-row">
                <button class="btn small" id="b-draw">Zeichnen</button>
                <button class="btn small" id="b-time">Verlauf</button>
                <button class="btn small" id="b-tiles"></button>
              </div>
            </div>
          </div>
          <div class="wrap" id="lage-wrap"></div>
          <div class="wrap" id="notes-wrap" hidden></div>
          <div class="wrap" id="export-wrap" hidden></div>
        </div>
      </aside>
      </div>
      <nav class="tabs mobile-tabs">
        <button data-tab="map">Karte</button>
        <button data-tab="tasks">Aufgaben<span class="badge" hidden></span></button>
        <button data-tab="more">Mehr</button>
      </nav>
    </div>`;
  root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
  root.querySelectorAll('[data-sub]').forEach((b) => b.onclick = () => setSub(b.dataset.sub));
  $('#sheet-handle').onclick = () => { prefs.sheet = !prefs.sheet; savePrefs(); $('#sheet').classList.toggle('collapsed', !prefs.sheet); };
  $('#b-layers').onclick = () => { const el = $('#layers'); el.hidden = !el.hidden; $('#b-layers').classList.toggle('on', !el.hidden); };
  $('#b-fit').onclick = fitAll;
  $('#b-me').onclick = toggleMe;
  $('#b-tiles').onclick = () => { prefs.tiles = TILE_ORDER[(TILE_ORDER.indexOf(prefs.tiles) + 1) % TILE_ORDER.length]; savePrefs(); applyTiles(); };
  $('#b-draw').onclick = () => { if (!state.desk) setTab('map'); setDrawing(!state.drawing); };
  $('#b-time').onclick = () => { if (!state.desk) setTab('map'); setTimeout(toggleReplay, 50); };
  $('#b-compass').onclick = () => {
    const ids = BANDIT_IDS().filter((id) => latest(id));
    if (!ids.length) return toast('Kompass', 'Noch kein Signal');
    const near = state.me ? ids.sort((a, b) => distanceM(state.me, latest(a)) - distanceM(state.me, latest(b)))[0] : ids[0];
    openCompass(near);
  };
  $('#b-car').onclick = () => {
    state.placingCar = !state.placingCar;
    $('#b-car').classList.toggle('on', state.placingCar);
    if (state.placingCar) toast('Auto', 'Auf die Karte tippen, wo das Auto steht', 'detective');
  };
  $('#sound').onclick = () => { unlockAudio(); state.soundOn = true; beep('task'); renderSound(); };
  $('#push').onclick = async () => {
    try {
      await enablePush('detective');
      state.push = true; renderPush();
      toast('Push', 'Aktiv auf diesem Gerät', 'detective');
    } catch (e) {
      const ios = /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone;
      toast('Push', ios ? 'Auf dem iPhone zuerst zum Home-Bildschirm hinzufügen, dort öffnen' : e.message);
    }
  };
  document.addEventListener('pointerdown', () => { if (!state.soundOn) { unlockAudio(); state.soundOn = true; renderSound(); } }, { once: true });
  renderConn(); renderSound(); renderPush();
  initMap();
  renderLayers();
  /* Desktop ab 1024 px: Karte links fest, Seitenleiste rechts. Mobil: Reiter unten. */
  const mq = window.matchMedia('(min-width: 1024px)');
  const applyDesk = () => {
    state.desk = mq.matches;
    document.body.classList.toggle('desk', state.desk);
    if (state.desk && state.tab === 'map') state.tab = 'bandits';
    if (!state.desk && state.tab === 'bandits') state.tab = 'map';
    setTab(state.tab);
    setTimeout(() => map.invalidateSize(), 50);
  };
  mq.addEventListener('change', applyDesk);
  applyDesk();
}

function setTab(tab) {
  state.tab = tab;
  root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#v-map').hidden = !state.desk && tab !== 'map';
  $('#v-bandits').hidden = tab !== 'bandits';
  $('#v-tasks').hidden = tab !== 'tasks';
  $('#v-more').hidden = tab !== 'more';
  if (tab === 'map') setTimeout(() => map.invalidateSize(), 0);
  if (tab === 'bandits') renderCards();
  if (tab === 'tasks') { state.unseenTasks = 0; renderBadge(); renderTasks(); }
  if (tab === 'more') setSub(state.sub);
}

/* Unterbereiche von "Mehr": Lage, Notizen, Export */
const isSub = (sub) => state.tab === 'more' && state.sub === sub;
function setSub(sub) {
  state.sub = sub;
  root.querySelectorAll('[data-sub]').forEach((b) => b.classList.toggle('on', b.dataset.sub === sub));
  $('#lage-wrap').hidden = sub !== 'lage';
  $('#notes-wrap').hidden = sub !== 'notes';
  $('#export-wrap').hidden = sub !== 'export';
  if (sub === 'lage') renderLage();
  if (sub === 'notes') renderNotes();
  if (sub === 'export') renderExport();
}

function renderConn() {
  const el = $('#conn'); if (!el) return;
  el.className = 'status label ' + state.conn;
  el.lastElementChild.textContent = statusText(state.conn);
}
function renderSound() { const b = $('#sound'); if (b) { b.textContent = state.soundOn ? 'Ton an' : 'Ton aus'; b.classList.toggle('quiet', state.soundOn); } }
function renderPush() {
  const b = $('#push'); if (!b) return;
  b.hidden = !pushSupported() || state.push;
}
function renderBadge() {
  root.querySelectorAll('.badge').forEach((b) => { b.hidden = !state.unseenTasks; b.textContent = state.unseenTasks; });
}

/* ===================== Karte ===================== */

let map, tiles, poiGroups = {}, poiMarkers = [], ringGroup, liveGroups = {}, playerLayers = {};
let meMarker = null, meCircle = null, meWatch = null, carMarker = null;
const canvas = () => (canvas.r ||= L.canvas({ padding: 0.3 }));
const TILES = {
  light: { label: 'Hell', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
  transit: { label: 'ÖPNV', url: 'https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png', opt: { maxZoom: 18, attribution: 'Karte <a href="https://memomaps.de/">memomaps.de</a> CC-BY-SA, Daten &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
};
const TILE_ORDER = ['light', 'transit'];
const lineColor = () => '#0C0C0E';
/* Kartenfarbe eines Spielers: Bone ist auf heller Karte unsichtbar, dort Ink. */
const mapColor = (id) => { const c = playerColor(id); return c.toUpperCase() === '#F0EBE1' ? '#0C0C0E' : c; };

const taskCode = (id) => id.replace(/^t/, '');
const poiDone = (it) => it.tasks.length > 0 && it.tasks.every(isDone);
const openPois = () => allPois().filter((p) => !poiDone(p));

function sqIcon(size, fill, border, cls = '') {
  return L.divIcon({
    className: 'ls-sq ' + cls,
    html: `<div style="width:${size}px;height:${size}px;background:${fill};border:2px solid ${border}"></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
}

/* Ortsmarke: Nummer der Aufgabe + Kurzwort, Name ab Zoom 16. Keine Icons, nur Wortlabels. */
function poiIcon(c, it) {
  const code = it.code || it.tasks.map(taskCode).join(' ');
  const st = openState(it.hours);
  const closed = !st.always && !st.open;
  return L.divIcon({
    className: 'ls-poi',
    html: `<div class="poi poi-${c.id} ${poiDone(it) ? 'poi-done' : ''} ${closed ? 'poi-closed' : ''}"><b>${esc(code)}</b><span>${esc(c.tag)}</span>${closed ? '<i>ZU</i>' : ''}<em>${esc(it.name)}</em></div>`,
    iconSize: [0, 0], iconAnchor: [0, 0],
  });
}

function chipIcon(text, cls, style = '') {
  return L.divIcon({ className: 'ls-poi', html: `<div class="chip ${cls}" style="${style}">${esc(text)}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
}

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([48.7784, 9.1800], 13);
  applyTiles();
  ringGroup = L.layerGroup().addTo(map);
  for (const c of POI_CATEGORIES) {
    const g = L.layerGroup();
    for (const it of c.items) {
      const m = L.marker([it.lat, it.lng], { icon: poiIcon(c, it), zIndexOffset: c.id === 'termine' ? 400 : 200 });
      m.bindPopup(() => poiPopup(it, c));
      m._ls = { c, it };
      poiMarkers.push(m);
      g.addLayer(m);
    }
    poiGroups[c.id] = g;
  }
  for (const l of LIVE_LAYERS) liveGroups[l.id] = L.layerGroup();
  applyLayers();
  map.on('zoomend', () => { applyZoomClass(); applyLiveVisibility(); });
  applyZoomClass();
  map.on('click', (e) => {
    $('#layers').hidden = true; $('#b-layers').classList.remove('on');
    if (state.placingCar) { state.placingCar = false; $('#b-car').classList.remove('on'); setCar(e.latlng.lat, e.latlng.lng); }
  });
  /* Langes Druecken (mobil) oder Rechtsklick: Auto abstellen oder Notiz an diesem Ort */
  map.on('contextmenu', (e) => {
    if (state.drawing) return;
    L.popup().setLatLng(e.latlng).setContent(`<div class="label">${formatCoordinate(e.latlng.lat, e.latlng.lng)}</div>
      <button class="btn small solid" style="margin-top:8px;width:100%" data-car-here>Auto hier abstellen</button>
      <button class="btn small" style="margin-top:6px;width:100%" data-note-here>Notiz hier</button>`).openOn(map);
  });
  initPopupActions();
  initDrawing();
  loadLive(false);
}

function applyZoomClass() {
  const z = map.getZoom();
  const el = map.getContainer();
  el.classList.toggle('z-mid', z >= 14);
  el.classList.toggle('z-near', z >= 16);
}

function applyTiles() {
  if (tiles) map.removeLayer(tiles);
  const t = TILES[prefs.tiles] || TILES.light;
  tiles = L.tileLayer(t.url, t.opt).addTo(map);
  tiles.bringToBack();
  const next = TILE_ORDER[(TILE_ORDER.indexOf(prefs.tiles) + 1) % TILE_ORDER.length];
  $('#b-tiles').textContent = TILES[next].label;
  map.getContainer().classList.add('tiles-light');
  applyLayers();
}

function poiPopup(it, c) {
  const rows = BANDIT_IDS().map((id) => {
    const l = latest(id); if (!l) return '';
    return `<div>${esc(playerName(state.players, id))}: ${formatDistance(distanceM(l, it))}</div>`;
  }).join('');
  const car = carPos();
  const from = state.me || car;
  const tasks = it.tasks.map((t) => TASKS.find((x) => x.id === t) || APPOINTMENTS.find((x) => x.id === t)).filter(Boolean);
  return `<div class="label">${esc(c.label)}</div>
    <div style="margin:4px 0 8px;font-family:var(--font-display);font-size:22px;line-height:1;text-transform:uppercase">${esc(it.name)}</div>
    ${tasks.map((t) => `<div class="muted">${pad2(t.n)} ${esc(t.title || t.place)} · ${isDone(t.id) ? 'ERLEDIGT' : 'OFFEN'}</div>`).join('')}
    ${it.hours ? `<div style="margin-top:4px">${esc(openText(openState(it.hours)))} · heute ${esc(openState(it.hours).today)}</div>` : ''}
    <div class="muted" style="margin-top:4px">${formatCoordinate(it.lat, it.lng)}</div>
    ${rows ? '<hr class="rule" style="margin:8px 0">' + rows : ''}
    ${car ? `<div>Auto: ca. ${driveMin(distanceM(car, it))} min · <a href="${gmaps(car, it, 'driving')}" target="_blank" rel="noopener">Route</a></div>` : ''}
    ${from && !car ? `<div><a href="${gmaps(from, it, 'walking')}" target="_blank" rel="noopener">Route</a></div>` : ''}`;
}

/* Ort sichtbar? Erledigte und mehr als 60 min geschlossene Orte nur mit "Alle Orte zeigen". */
function poiRelevant(it, now = new Date()) {
  if (prefs.showAll) return true;
  if (poiDone(it)) return false;
  const st = openState(it.hours, now);
  return st.always || st.open || (st.next && st.next - now < 60 * 60000);
}

function applyLayers() {
  if (!ringGroup) return;
  ringGroup.clearLayers();
  const hot = new Set([...state.inside].map((k) => k.split('|')[1]));
  for (const m of poiMarkers) {
    const g = poiGroups[m._ls.c.id];
    const show = poiRelevant(m._ls.it);
    if (show && !g.hasLayer(m)) g.addLayer(m);
    if (!show && g.hasLayer(m)) g.removeLayer(m);
  }
  for (const c of POI_CATEGORIES) {
    const on = !!prefs.layers[c.id];
    if (on && !map.hasLayer(poiGroups[c.id])) poiGroups[c.id].addTo(map);
    if (!on && map.hasLayer(poiGroups[c.id])) map.removeLayer(poiGroups[c.id]);
    if (!on) continue;
    for (const it of c.items) {
      if (poiDone(it) || !poiRelevant(it)) continue;
      const isHot = hot.has(c.id + ':' + it.name);
      if (!prefs.rings && !isHot) continue;
      L.circle([it.lat, it.lng], {
        radius: ALERT_RADIUS_M, color: isHot ? '#FF4D0F' : lineColor(), weight: isHot ? 3 : 1.5,
        opacity: isHot ? 0.9 : 0.55, dashArray: isHot ? null : '6 6',
        fill: true, fillColor: isHot ? '#FF4D0F' : lineColor(), fillOpacity: isHot ? 0.07 : 0.04, interactive: false,
      }).addTo(ringGroup);
    }
  }
  applyLiveVisibility();
}

function refreshPoiIcons() {
  for (const m of poiMarkers) m.setIcon(poiIcon(m._ls.c, m._ls.it));
  applyLayers();
}

/* ---- Live-Ebenen aus OpenStreetMap ---- */

async function loadLive(force) {
  state.osmStatus = 'laedt';
  renderLayers();
  try {
    state.osm = await loadOsm(force);
    state.osmStatus = 'ok';
    buildLive();
    loadLines(force);
  } catch (e) {
    console.error(e);
    state.osm = state.osm || cachedOsm();
    state.osmStatus = 'fehler';
    if (state.osm) buildLive();
  }
  renderLayers();
  if (isSub('lage')) renderLage();
}

function buildLive() {
  const o = state.osm; if (!o) return;
  for (const l of LIVE_LAYERS) liveGroups[l.id].clearLayers();
  const hotNames = new Set(hotspots().slice(0, 8).map((h) => h.st[2]));
  for (const s of o.oepnv) {
    const hot = hotNames.has(s[2]);
    const m = L.marker([s[0], s[1]], { icon: chipIcon(s[3], 'chip-st' + (hot ? ' chip-hot' : '')), zIndexOffset: hot ? 300 : 100 });
    m.bindTooltip(s[2] + ' · ' + s[3], { className: 'ls-tip', direction: 'top', offset: [0, -10] });
    m.bindPopup(() => stationPopup(s));
    liveGroups.oepnv.addLayer(m);
  }
  const dot = { gym: 'chip-gym', spielplatz: 'chip-play', cafe: 'chip-cafe', apotheke: 'chip-apo' };
  for (const id of ['gym', 'spielplatz', 'cafe', 'apotheke']) {
    const meta = LIVE_LAYERS.find((l) => l.id === id);
    for (const p of o[id] || []) {
      const m = L.marker([p[0], p[1]], { icon: chipIcon(meta.tag, 'chip-sm ' + dot[id]) });
      m.bindTooltip(p[2], { className: 'ls-tip', direction: 'top', offset: [0, -8] });
      liveGroups[id].addLayer(m);
    }
  }
  applyLiveVisibility();
}

function applyLiveVisibility() {
  if (!map) return;
  const z = map.getZoom();
  for (const l of LIVE_LAYERS) {
    const show = !!prefs.layers[l.id] && z >= l.minZoom;
    if (show && !map.hasLayer(liveGroups[l.id])) liveGroups[l.id].addTo(map);
    if (!show && map.hasLayer(liveGroups[l.id])) map.removeLayer(liveGroups[l.id]);
  }
}

function stationPopup(s) {
  const h = hotspots().find((x) => x.st[2] === s[2]);
  const car = carPos();
  return `<div class="label">Haltestelle ${esc(s[3])}</div>
    <div style="margin:4px 0 8px;font-family:var(--font-display);font-size:22px;line-height:1;text-transform:uppercase">${esc(s[2])}</div>
    ${h ? `<div class="muted">Offene Orte in 800 M: ${h.near.map((n) => esc(n.code)).join(', ')}</div>` : '<div class="muted">Keine offenen Orte in 800 M</div>'}
    ${BANDIT_IDS().map((id) => { const l = latest(id); return l ? `<div>${esc(playerName(state.players, id))}: ${formatDistance(distanceM(l, { lat: s[0], lng: s[1] }))}</div>` : ''; }).join('')}
    ${car ? `<div style="margin-top:4px">Auto: ca. ${driveMin(distanceM(car, { lat: s[0], lng: s[1] }))} min · <a href="${gmaps(car, { lat: s[0], lng: s[1] }, 'driving')}" target="_blank" rel="noopener">Route</a></div>` : ''}
    <button class="btn small" style="margin-top:8px;width:100%" data-dep="${esc(s[2])}">Abfahrten</button><div class="deps"></div>`;
}

/* Haltestellen, an denen die Gejagten am ehesten aussteigen: pro offener Aufgabe zaehlt
   der naechste passende Ort innerhalb 800 m, je naeher desto mehr. Anstehende
   Pflichttermine (naechste 4 Stunden) zaehlen doppelt. */
const HOT_R = 800;
function hotspots() {
  const o = state.osm; if (!o) return [];
  const now = Date.now();
  const spots = openPois();
  const res = [];
  for (const st of o.oepnv) {
    const pt = { lat: st[0], lng: st[1] };
    const best = {};
    for (const p of spots) {
      const d = distanceM(pt, p); if (d > HOT_R) continue;
      const appt = APPOINTMENTS.find((a) => p.tasks.includes(a.id));
      const soon = appt && new Date(appt.start).getTime() - now < 4 * 3600e3 && new Date(appt.end).getTime() > now;
      const w = (1 - d / HOT_R) * (soon ? 2 : 1);
      const key = p.tasks.join(',');
      if (!best[key] || best[key].w < w) best[key] = { w, d, code: (p.code || p.tasks.map(taskCode).join('/')) + ' ' + p.name, p };
    }
    const near = Object.values(best).sort((a, b) => a.d - b.d);
    const score = near.reduce((s, n) => s + n.w, 0);
    if (score > 0) res.push({ st, score, near });
  }
  return res.sort((a, b) => b.score - a.score);
}

function nearestStation(pt) {
  const o = state.osm; if (!o || !o.oepnv.length || !pt) return null;
  let best = null;
  for (const s of o.oepnv) { const d = distanceM(pt, { lat: s[0], lng: s[1] }); if (!best || d < best.d) best = { s, d }; }
  return best;
}

/* ---- Ebenen-Menue ---- */

function renderLayers() {
  const el = $('#layers'); if (!el) return;
  const row = (id, label, cnt, note = '') => `<div class="layer-row" data-layer="${id}"><input type="checkbox" class="check" ${prefs.layers[id] ? 'checked' : ''} tabindex="-1"><span class="name">${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</span><span class="cnt">${cnt}</span></div>`;
  const o = state.osm;
  el.innerHTML = `
    <div class="lhead"><span class="label">Ebenen</span><button class="btn small quiet" id="l-close">Zu</button></div>
    <div class="lsub label">Feste Orte · mit Alarm</div>
    ${POI_CATEGORIES.map((c) => row(c.id, c.label, pad2(c.items.length))).join('')}
    <div class="layer-row" data-showall="1"><input type="checkbox" class="check" ${prefs.showAll ? 'checked' : ''} tabindex="-1"><span class="name">Auch erledigte und geschlossene Orte<small>sonst ausgeblendet</small></span></div>
    <div class="layer-row" data-rings="1"><input type="checkbox" class="check" ${prefs.rings ? 'checked' : ''} tabindex="-1"><span class="name">Umkreis ${ALERT_RADIUS_M} M bei allen Orten<small>sonst nur, wenn ein Gejagter drin ist</small></span></div>
    <div class="lsub label">OpenStreetMap · ohne Alarm${state.osmStatus === 'laedt' ? ' · lädt' : state.osmStatus === 'fehler' ? ' · nicht erreichbar' : ''}</div>
    ${LIVE_LAYERS.map((l) => row(l.id, l.label, o ? String((o[l.id] || []).length) : '-', 'ab Zoom ' + l.minZoom + (l.tasks.length ? ' · Aufgabe ' + l.tasks.map(taskCode).join('/') : ''))).join('')}
    <div class="lsub label">Jäger</div>
    ${row('jaeger', 'Anderer Jäger', String(hunterIds().length))}
    ${row('notizen', 'Notizen mit Ort', pad2(notes().filter((n) => n.lat != null).length))}
    ${row('zeichnungen', 'Zeichnungen', pad2(drawings().length))}
    ${row('halte', 'Halte ab 10 min', '')}
    ${row('fotos', 'Beweisfotos', pad2(state.proofs.filter((p) => p.lat != null).length), 'Ort aus Foto oder Handy')}
    <div class="layer-row" data-reach="1"><input type="checkbox" class="check" ${prefs.reach ? 'checked' : ''} tabindex="-1"><span class="name">Reichweite seit Signal<small>${REACH_M_PER_MIN} M pro Minute</small></span></div>
    <div style="padding:12px 16px">
      <div class="label" style="margin-bottom:8px">Route</div>
      <div class="seg">${[['1h', '1 H'], ['6h', '6 H'], ['all', 'Alles'], ['none', 'Aus']].map(([k, t]) => `<button class="btn ${prefs.route === k ? 'on' : ''}" data-route="${k}">${t}</button>`).join('')}</div>
    </div>
    <div style="padding:0 16px 12px" class="btn-row"><button class="btn small quiet" data-all="1">Alle an</button><button class="btn small quiet" data-all="0">Alle aus</button><button class="btn small quiet" id="l-reload">OSM neu</button></div>`;
  $('#l-close').onclick = () => { el.hidden = true; $('#b-layers').classList.remove('on'); };
  el.querySelectorAll('[data-layer]').forEach((r) => r.onclick = () => {
    prefs.layers[r.dataset.layer] = !prefs.layers[r.dataset.layer]; savePrefs();
    applyLayers(); renderLayers(); evaluateProximity(true); renderCards(); drawItems(); drawProofs(); drawHunters(); drawStays();
  });
  el.querySelector('[data-rings]').onclick = () => { prefs.rings = !prefs.rings; savePrefs(); applyLayers(); renderLayers(); };
  el.querySelector('[data-showall]').onclick = () => { prefs.showAll = !prefs.showAll; savePrefs(); applyLayers(); renderLayers(); };
  el.querySelector('[data-reach]').onclick = () => { prefs.reach = !prefs.reach; savePrefs(); drawPlayers(); renderLayers(); };
  el.querySelectorAll('[data-route]').forEach((b) => b.onclick = () => { prefs.route = b.dataset.route; savePrefs(); renderLayers(); drawPlayers(); });
  el.querySelectorAll('[data-all]').forEach((b) => b.onclick = () => {
    [...POI_CATEGORIES, ...LIVE_LAYERS].forEach((c) => prefs.layers[c.id] = b.dataset.all === '1'); savePrefs();
    applyLayers(); renderLayers(); evaluateProximity(true); renderCards();
  });
  $('#l-reload').onclick = () => loadLive(true);
}

function routeSince() {
  const now = Date.now();
  return { '1h': now - 3600e3, '6h': now - 6 * 3600e3, all: 0, none: Infinity }[prefs.route] ?? 0;
}

/* ---- Gejagte ---- */

/* Annahme fuer die Reichweite: OEPNV mit Umsteigen und Warten im Schnitt ~12 km/h. */
const REACH_M_PER_MIN = 200;
const ageMin = (l) => (Date.now() - new Date(l.created_at).getTime()) / 60000;

function motion(id) {
  const pts = state.locs[id] || [];
  if (pts.length < 2) return null;
  const b = pts[pts.length - 1];
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i];
    const mins = (new Date(b.created_at) - new Date(a.created_at)) / 60000;
    if (mins > 45) return null;
    const d = distanceM(a, b);
    if (d >= 60 && mins >= 2) { const kmh = (d / 1000) / (mins / 60); return kmh < 150 ? { dir: bearing(a, b), kmh, mins, from: a, to: b } : null; }
  }
  return null;
}

function drawPlayers() {
  if (!map) return;
  const since = routeSince();
  for (const id of BANDIT_IDS()) {
    const color = mapColor(id);
    const pts = visiblePts(id);
    let pl = playerLayers[id];
    if (!pl) {
      pl = playerLayers[id] = {
        reach: L.circle([0, 0], { radius: 1, color, weight: 1.5, opacity: 0.7, dashArray: '2 6', fill: true, fillColor: color, fillOpacity: 0.04, interactive: false }),
        acc: L.circle([0, 0], { radius: 1, color, weight: 1, opacity: 0.8, fill: true, fillColor: color, fillOpacity: 0.15, interactive: false }),
        route: L.polyline([], { color, weight: 3, opacity: 0.85, lineJoin: 'miter' }).addTo(map),
        dots: L.layerGroup().addTo(map),
        marker: null,
      };
    }
    const shown = pts.filter((p) => new Date(p.created_at).getTime() >= since);
    pl.route.setLatLngs(shown.map((p) => [p.lat, p.lng]));
    pl.dots.clearLayers();
    shown.slice(0, -1).forEach((p) => {
      L.circleMarker([p.lat, p.lng], { renderer: canvas(), radius: 4, color: '#0C0C0E', weight: 1, fillColor: color, fillOpacity: 1 })
        .bindTooltip(timeHM(p.created_at) + (p.source === 'owntracks' ? ' · OT' : ''), { className: 'ls-tip' }).addTo(pl.dots);
    });
    const l = shownLatest(id);
    if (!l) { if (pl.marker) { map.removeLayer(pl.marker); pl.marker = null; } map.removeLayer(pl.reach); map.removeLayer(pl.acc); continue; }
    const age = state.replayT ? 0 : ageMin(l);
    const reachR = Math.min(age * REACH_M_PER_MIN, 10000);
    if (prefs.reach && age >= 2) { pl.reach.setLatLng([l.lat, l.lng]).setRadius(reachR); if (!map.hasLayer(pl.reach)) pl.reach.addTo(map); }
    else map.removeLayer(pl.reach);
    if (l.accuracy && l.accuracy > 10) { pl.acc.setLatLng([l.lat, l.lng]).setRadius(l.accuracy); if (!map.hasLayer(pl.acc)) pl.acc.addTo(map); }
    else map.removeLayer(pl.acc);
    const stale = age > STALE_MIN;
    const icon = L.divIcon({
      className: 'ls-player' + (stale ? ' stale' : ''),
      html: `<div style="position:relative;width:26px;height:26px;color:${color}"><div class="pulse"></div><div class="core" style="background:${color};border-color:${color === '#0C0C0E' ? '#F0EBE1' : '#0C0C0E'}"></div></div>`,
      iconSize: [26, 26], iconAnchor: [13, 13],
    });
    const tip = `${esc(playerName(state.players, id))} <span style="font-family:var(--font-mono);font-size:11px;color:var(--ash)">${timeHM(l.created_at)}</span>`;
    if (!pl.marker) {
      pl.marker = L.marker([l.lat, l.lng], { icon, zIndexOffset: 1000 }).addTo(map);
      pl.marker.bindTooltip(tip, { permanent: true, direction: 'right', offset: [16, 0], className: 'ls-tip player' });
    } else {
      pl.marker.setLatLng([l.lat, l.lng]); pl.marker.setIcon(icon); pl.marker.setTooltipContent(tip);
    }
  }
}

function fitAll() {
  const pts = BANDIT_IDS().map(latest).filter(Boolean).map((l) => [l.lat, l.lng]);
  if (state.me) pts.push([state.me.lat, state.me.lng]);
  const car = carPos(); if (car) pts.push([car.lat, car.lng]);
  if (!pts.length) { map.setView([48.7784, 9.1800], 13); return; }
  if (pts.length === 1) map.setView(pts[0], 16);
  else map.fitBounds(pts, { padding: [64, 64], maxZoom: 16 });
}

/* ---- Eigener Standort: hohe Genauigkeit, Genauigkeitskreis, schlechte Messungen verwerfen ---- */

function toggleMe() {
  const b = $('#b-me');
  if (meWatch !== null) {
    /* An: erster Tipp zentriert, zweiter Tipp (schon zentriert) schaltet aus. */
    if (state.me) {
      const c = map.latLngToContainerPoint([state.me.lat, state.me.lng]);
      const mid = map.getSize().divideBy(2);
      if (c.distanceTo(mid) > 40) { map.setView([state.me.lat, state.me.lng], Math.max(map.getZoom(), 16)); return; }
    }
    navigator.geolocation.clearWatch(meWatch); meWatch = null;
    if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
    if (meCircle) { map.removeLayer(meCircle); meCircle = null; }
    state.me = null; b.classList.remove('on'); b.textContent = 'Ich';
    if (isSub('lage')) renderLage();
    return;
  }
  if (!('geolocation' in navigator)) return toast('Ich', 'Standort nicht verfügbar');
  b.classList.add('on'); b.textContent = 'Ich …';
  let first = true;
  meWatch = navigator.geolocation.watchPosition((p) => {
    const fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() };
    /* grobe Messung (WLAN/Funkzelle) nicht ueber eine gute, frische legen */
    if (state.me && fix.acc > state.me.acc * 3 && fix.ts - state.me.ts < 30000) return;
    state.me = fix;
    const ll = [fix.lat, fix.lng];
    if (!meMarker) {
      meCircle = L.circle(ll, { radius: fix.acc, color: '#6E8CA8', weight: 1, fillColor: '#6E8CA8', fillOpacity: 0.15, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { icon: sqIcon(18, '#6E8CA8', '#0C0C0E'), zIndexOffset: 900 }).addTo(map);
      meMarker.bindTooltip('Ich', { className: 'ls-tip', direction: 'left', offset: [-12, 0] });
    } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(fix.acc); }
    b.textContent = 'Ich ±' + Math.round(fix.acc) + ' M';
    shareMe(fix);
    if (first) { first = false; map.setView(ll, Math.max(map.getZoom(), 16)); }
    if (isSub('lage')) renderLage();
  }, (e) => {
    toast('Ich', e.code === 1 ? 'Standort nicht erlaubt' : 'Kein GPS-Signal');
    if (e.code === 1) { b.classList.remove('on'); b.textContent = 'Ich'; navigator.geolocation.clearWatch(meWatch); meWatch = null; }
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}

/* ---- Auto der Jaeger: als Punkt 'car' in locations, fuer beide Jaeger sichtbar ---- */

function carPos() {
  const l = latest('car');
  return l && l.source !== 'clear' ? l : null;
}

async function setCar(lat, lng) {
  try {
    await store.addLocation({ player_id: 'car', lat, lng, source: 'hunter', created_at: new Date().toISOString() });
    toast('Auto', 'Abgestellt ' + formatCoordinate(lat, lng), 'detective');
  } catch { toast('Auto', 'Speichern fehlgeschlagen'); }
}
async function clearCar() {
  const c = carPos(); if (!c) return;
  try { await store.addLocation({ player_id: 'car', lat: c.lat, lng: c.lng, source: 'clear', created_at: new Date().toISOString() }); } catch { toast('Auto', 'Fehlgeschlagen'); }
}

function drawCar() {
  if (!map) return;
  const c = carPos();
  if (!c) { if (carMarker) { map.removeLayer(carMarker); carMarker = null; } return; }
  if (!carMarker) {
    carMarker = L.marker([c.lat, c.lng], { icon: chipIcon('AUTO', 'chip-car'), zIndexOffset: 950 }).addTo(map);
    carMarker.bindPopup(() => `<div class="label">Auto · ${timeHM(c.created_at)}</div><div class="muted">${formatCoordinate(c.lat, c.lng)}</div>
      ${state.me ? `<div style="margin-top:4px">Zu Fuss ca. ${walkMin(distanceM(state.me, c))} min · <a href="${gmaps(state.me, c, 'walking')}" target="_blank" rel="noopener">Route</a></div>` : ''}`);
  } else carMarker.setLatLng([c.lat, c.lng]);
}

/* ---- Zeitschaetzung: Luftlinie mit Umwegfaktor. Echte Route ueber Google Maps. ---- */
function gmaps(from, to, mode) {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode}`;
}

/* ===================== Naehe-Alarm ===================== */

function nearList(id, pois = visiblePois()) {
  const l = latest(id); if (!l) return [];
  return pois.map((p) => ({ poi: p, d: distanceM(l, p) })).sort((a, b) => a.d - b.d);
}

function evaluateProximity(silent) {
  const nowInside = new Set();
  const fresh = [];
  for (const id of BANDIT_IDS()) {
    for (const { poi, d } of nearList(id)) {
      const key = id + '|' + poi.key;
      const was = state.inside.has(key);
      if (d <= ALERT_RADIUS_M || (was && d <= ALERT_RADIUS_M + 50)) {
        nowInside.add(key);
        if (!was) fresh.push({ id, poi, d });
      }
    }
  }
  const changed = nowInside.size !== state.inside.size || [...nowInside].some((k) => !state.inside.has(k));
  state.inside = nowInside;
  if (changed) applyLayers();
  if (silent || !fresh.length) return;
  for (const f of fresh) {
    const text = `${playerName(state.players, f.id)} ist ${Math.round(f.d)} M von ${f.poi.name} entfernt`;
    systemNotify('ALARM ' + ALERT_RADIUS_M + ' M', text);
  }
  /* Ein Alarmkasten pro Ereignis, nächster Ort zuerst; aeltere Alarme werden ersetzt. */
  fresh.sort((a, b) => a.d - b.d);
  const at = new Date().toISOString();
  fresh.forEach((f) => state.alarmLog.unshift({ at, poi: f.poi, text: `${playerName(state.players, f.id)} ist ${Math.round(f.d)} M von ${f.poi.name} entfernt` }));
  state.alarmLog = state.alarmLog.slice(0, 30);
  state.alarms = [{
    at: new Date().toISOString(), id: fresh[0].id, poi: fresh[0].poi, fresh: true,
    lines: fresh.map((f) => `${playerName(state.players, f.id)} ist ${Math.round(f.d)} M von ${f.poi.name} entfernt`),
  }];
  if (state.soundOn) beep('alarm'); else if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
  renderAlarms();
}

function renderAlarms() {
  const el = $('#alarms'); if (!el) return;
  el.innerHTML = state.alarms.map((a, i) => `
    <div class="alarm ${a.fresh ? 'fresh' : ''}" data-alarm="${i}" style="--alarm-spur:${playerColor(a.id)}">
      <div class="label">Alarm ${timeHM(a.at)} · ${ALERT_RADIUS_M} M · Tippen schliesst</div>
      <div class="alarm-text">${esc(a.lines[0])}</div>
      ${a.lines.slice(1).map((l) => `<div class="alarm-more">${esc(l)}</div>`).join('')}
    </div>`).join('');
  state.alarms.forEach((a) => a.fresh = false);
  el.querySelectorAll('[data-alarm]').forEach((d) => d.onclick = () => {
    const a = state.alarms[Number(d.dataset.alarm)];
    state.alarms.splice(Number(d.dataset.alarm), 1); renderAlarms();
    if (a) map.setView([a.poi.lat, a.poi.lng], Math.max(map.getZoom(), 15));
  });
}

async function systemNotify(title, body) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { const reg = await navigator.serviceWorker.getRegistration(); reg && reg.showNotification(title, { body, icon: '/icons/detective-192.png', tag: title + body }); } catch { /* egal */ }
}

/* ===================== Spielerkarten ===================== */

function renderCards() {
  const el = $('#cards'); if (!el) return;
  const ids = BANDIT_IDS();
  const seen = ids.map(latest).filter(Boolean);
  $('#sheet-sum').textContent = ids.map((id) => { const l = latest(id); return playerName(state.players, id) + ' ' + (l ? timeHM(l.created_at) : '--:--'); }).join(' · ');
  el.innerHTML = cardsHtml(ids);
  bindCards(el);
  const side = $('#bandits-wrap');
  if (side && state.desk && state.tab === 'bandits') {
    side.innerHTML = `
      <div class="section-head"><h2 class="display d-s">Bandits</h2><span class="label">${seen.length ? 'Letztes Signal ' + timeHM(seen.map((l) => l.created_at).sort().pop()) : 'Noch kein Signal'}</span></div>
      ${cardsHtml(ids)}
      <div class="section">
        <div class="section-head"><h2 class="display d-s">Alarme</h2><span class="label">Umkreis ${ALERT_RADIUS_M} M</span></div>
        ${state.alarmLog.length ? state.alarmLog.map((a) => `<div class="log-row" data-poi="${esc(a.poi.key)}"><span class="label">${timeHM(a.at)}</span><span class="value" style="font-size:13px">${esc(a.text.toUpperCase())}</span></div>`).join('') : '<div class="label" style="padding:16px 0">Noch kein Alarm</div>'}
      </div>
`;
    bindCards(side);
    side.querySelectorAll('[data-poi]').forEach((r) => r.onclick = () => {
      const p = allPois().find((x) => x.key === r.dataset.poi); if (p) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
    });
    side.querySelectorAll('[data-loc]').forEach((r) => r.onclick = () => map.setView(r.dataset.loc.split(',').map(Number), Math.max(map.getZoom(), 16)));
  }
}

function historyHtml() {
  const rows = BANDIT_IDS().flatMap((id) => (state.locs[id] || []).slice(-12).map((l) => ({ ...l, pid: id })))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 16);
  if (!rows.length) return '<div class="label" style="padding:16px 0">Noch kein Signal</div>';
  return rows.map((l) => `<div class="log-row" data-loc="${l.lat},${l.lng}" style="--pc:${playerColor(l.pid)}"><span class="label">${timeHM(l.created_at)}</span><span class="value" style="font-size:13px"><span class="dot"></span>${esc(playerName(state.players, l.pid))} ${formatCoordinate(l.lat, l.lng)}</span></div>`).join('');
}

/* Bandit-Karte: Wo sind sie (Signal, Akku), wohin (Linie, 3 Ziele), schaffen wir es (Wettlauf). */
function cardsHtml(ids) {
  return ids.map((id) => {
    const l = latest(id);
    const color = playerColor(id);
    if (!l) return `<div class="pcard" style="--pc:${color}"><div class="row"><span class="display d-s">${esc(playerName(state.players, id))}</span><span class="label">Kein Signal</span></div></div>`;
    const bt = batteryText(id);
    const goals = prognosis(id);
    return `<div class="pcard" style="--pc:${color}">
      <div class="row" data-player="${id}"><span class="display d-s">${esc(playerName(state.players, id))}</span><span class="label ${ageMin(l) > 20 ? 'age-old' : ''}">${agoText(l.created_at)}${bt ? ' · ' + esc(bt) : ''}</span></div>
      ${silent(latestRaw(id)) ? `<div class="silence">FUNKSTILLE SEIT ${Math.round(ageMin(latestRaw(id)))} MIN</div>` : ''}
      ${isGated(id) ? `<div class="label" style="margin-top:4px">Nächstes Signal ${timeHM(new Date(nextReveal()).toISOString())}</div>` : ''}
      ${lineHtml(id)}
      <div class="goals">${goals.map((x) => `<div class="goal" data-goal="${x.p.lat},${x.p.lng}">
        <span class="num goal-pct">${x.pct}%</span>
        <div><div class="value">${esc(((x.p.code || x.p.tasks.map(taskCode).join('/')) + ' ' + x.p.name).toUpperCase())}</div>
        ${raceHtml(id, x.p)}</div></div>`).join('')}</div>
      <div class="btn-row card-btns"><button class="btn small" data-compass="${id}">Kompass</button><button class="btn small quiet" data-player="${id}">Auf Karte</button></div>
    </div>`;
  }).join('');
}

function bindCards(el) {
  el.querySelectorAll('[data-player]').forEach((c) => c.onclick = () => {
    const l = latest(c.dataset.player); if (l) { if (!state.desk) setTab('map'); map.setView([l.lat, l.lng], Math.max(map.getZoom(), 16)); }
  });
  el.querySelectorAll('[data-goal]').forEach((c) => c.onclick = () => map.setView(c.dataset.goal.split(',').map(Number), Math.max(map.getZoom(), 15)));
  el.querySelectorAll('[data-compass]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openCompass(b.dataset.compass); });
}

/* ===================== Lage: Auto, Wege, Termine, Haltestellen ===================== */

function nextAppointment() {
  const now = Date.now();
  return APPOINTMENTS.filter((a) => new Date(a.end).getTime() > now && !isDone(a.id))
    .sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}

function untilText(iso) {
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (min <= 0) return 'LÄUFT';
  const h = Math.floor(min / 60);
  if (h >= 24) return 'IN ' + Math.floor(h / 24) + ' T ' + (h % 24) + ' H';
  return 'IN ' + (h ? h + ' H ' : '') + pad2(min % 60) + ' MIN';
}

function routeLink(from, to, mode, text = 'Route') {
  return `<a class="label" href="${gmaps(from, to, mode)}" target="_blank" rel="noopener">${text}</a>`;
}

function renderLage() {
  const el = $('#lage-wrap'); if (!el || !isSub('lage')) return;
  const car = carPos();
  const me = state.me;
  const appt = nextAppointment();
  const hs = hotspots().slice(0, 10);
  const line = (k, v, link = '') => `<div class="lage-row"><span class="label">${k}</span><span class="value">${v}</span>${link}</div>`;

  const ways = BANDIT_IDS().map((id) => {
    const l = latest(id);
    if (!l) return `<div class="pcard" style="--pc:${playerColor(id)}"><div class="row"><span class="display d-s">${esc(playerName(state.players, id))}</span><span class="label">Kein Signal</span></div></div>`;
    const mo = motion(id);
    const st = nearestStation(l);
    const age = ageMin(l);
    return `<div class="pcard" data-player="${id}" style="--pc:${playerColor(id)}">
      <div class="row"><span class="display d-s">${esc(playerName(state.players, id))}</span><span class="label">Signal ${timeHM(l.created_at)} · ${agoText(l.created_at)}</span></div>
      ${car ? line('Auto hin', `ca. ${driveMin(distanceM(car, l))} MIN · ${formatDistance(distanceM(car, l))}`, routeLink(car, l, 'driving')) : ''}
      ${me ? line('Zu Fuss', `ca. ${walkMin(distanceM(me, l))} MIN · ${formatDistance(distanceM(me, l))}`, routeLink(me, l, 'walking')) : ''}
      ${st ? line('Haltestelle', `${esc(st.s[2].toUpperCase())} ${st.s[3]} · ${formatDistance(st.d)}`) : ''}
      ${mo ? line('Bewegung', `${mo.dir} · ${mo.kmh.toFixed(1)} KM/H`) : ''}
      ${age >= 2 ? line('Reichweite', `bis ca. ${formatDistance(Math.min(age * REACH_M_PER_MIN, 10000))}`) : ''}
      ${batteryText(id) ? line('Akku', batteryText(id)) : ''}
      ${lineHtml(id)}
      <button class="btn small" style="margin-top:8px" data-compass="${id}">Kompass</button>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="section-head"><h2 class="display d-s">Auto</h2><span class="label">${car ? 'Abgestellt ' + timeHM(car.created_at) : 'Nicht gesetzt'}</span></div>
    ${car ? `<div style="padding-top:8px">${line('Position', formatCoordinate(car.lat, car.lng), routeLink(me || car, car, 'walking', 'Karte'))}
      ${me ? line('Ich zum Auto', `ca. ${walkMin(distanceM(me, car))} MIN · ${formatDistance(distanceM(me, car))}`, routeLink(me, car, 'walking')) : '<div class="label" style="padding:8px 0">"Ich" auf der Karte einschalten für die Zeit zum Auto.</div>'}</div>` : ''}
    <div class="btn-row" style="margin-top:12px">
      <button class="btn small solid" id="car-me">Auto = mein Standort</button>
      <button class="btn small" id="car-map">Auf Karte tippen</button>
      ${car ? '<button class="btn small quiet" id="car-clear">Entfernen</button>' : ''}
    </div>
    <div class="label" style="margin-top:8px">Tipp: Auf der Karte lange drücken setzt das Auto direkt.</div>

    <div class="section">
      <div class="section-head"><h2 class="display d-s">Wege</h2><span class="label">Schätzung · Route = Google Maps</span></div>
      ${ways}
    </div>

    ${hunterIds().length ? `<div class="section">
      <div class="section-head"><h2 class="display d-s">Jäger</h2></div>
      ${hunterIds().map((id) => { const l = latest(id); return `<div class="lage-row" data-ll="${l.lat},${l.lng}"><span class="label">${esc(hunterLabel(id))}</span><span class="value">${agoText(l.created_at)}${me ? ' · ' + formatDistance(distanceM(me, l)) : ''}</span><span></span></div>`; }).join('')}
    </div>` : ''}

    <div class="section">
      <div class="section-head"><h2 class="display d-s">Letzte Chance</h2><span class="label">Öffnungszeiten bis Spielende</span></div>
      ${lastChanceHtml()}
    </div>

    <div class="section">
      <div class="section-head"><h2 class="display d-s">Halte</h2><span class="label">Ab 10 min an einem Ort</span></div>
      ${BANDIT_IDS().map((id) => stays(state.locs[id] || []).slice(-5).reverse().map((st) => { const np = nearestPoiAny(st); return `<div class="lage-row" data-ll="${st.lat},${st.lng}"><span class="label">${esc(playerName(state.players, id))}</span><span class="value">${hm(st.from)}–${hm(st.to)} · ${st.min} MIN${np && np.d < 300 ? ' · ' + esc(np.p.name.toUpperCase()) : ''}</span><span></span></div>`; }).join('')).join('') || '<div class="label" style="padding:8px 0">Noch keine Halte</div>'}
    </div>

    <div class="section">
      <div class="section-head"><h2 class="display d-s">Pflichttermine</h2><span class="label">Anwesenheit aus Signalen</span></div>
      ${APPOINTMENTS.map(apptHtml).join('')}
    </div>

    ${appt ? `<div class="section">
      <div class="section-head"><h2 class="display d-s">Nächster Termin</h2><span class="label">${untilText(appt.start)}</span></div>
      <div class="pcard" data-poi-ll="${appt.lat},${appt.lng}" style="--pc:var(--bone)">
        <div class="row"><span class="display d-s">${esc(appt.place)}</span></div>
        <div class="label" style="margin-top:4px">${esc(appt.day)} ${esc(appt.window)} · ${esc(appt.note)}</div>
        ${car ? line('Auto hin', `ca. ${driveMin(distanceM(car, appt))} MIN`, routeLink(car, appt, 'driving')) : ''}
        ${me ? line('Zu Fuss', `ca. ${walkMin(distanceM(me, appt))} MIN`, routeLink(me, appt, 'walking')) : ''}
      </div>
    </div>` : ''}

    <div class="section">
      <div class="section-head"><h2 class="display d-s">Haltestellen</h2><span class="label">Wahrscheinliche Ausstiege</span></div>
      <div class="label" style="padding:8px 0">S-Bahn und Stadtbahn mit den meisten offenen Aufgaben-Orten in ${HOT_R} M. Termine in den nächsten 4 H zählen doppelt.</div>
      ${!state.osm ? `<div class="label" style="padding:8px 0">${state.osmStatus === 'laedt' ? 'Haltestellen werden geladen' : 'Haltestellen nicht geladen'}</div><button class="btn small" id="osm-retry">Neu laden</button>`
        : hs.length ? hs.map((h, i) => `<div class="hot-row" data-ll="${h.st[0]},${h.st[1]}">
          <span class="num hot-rank">${pad2(i + 1)}</span>
          <div><div class="value">${esc(h.st[2].toUpperCase())} <span class="muted">${h.st[3]}</span></div>
          <div class="label" style="margin-top:2px">${h.near.map((n) => esc(n.code) + ' ' + formatDistance(n.d)).join(' · ')}</div>
          ${car ? `<div class="label" style="margin-top:2px">Auto ca. ${driveMin(distanceM(car, { lat: h.st[0], lng: h.st[1] }))} MIN</div>` : ''}</div>
          <span class="hot-bar"><i style="width:${Math.round((h.score / hs[0].score) * 100)}%"></i></span>
        </div>`).join('') : '<div class="label">Keine offenen Orte in Haltestellennähe</div>'}
    </div>`;

  const goMap = (lat, lng, z = 16) => { if (!state.desk) setTab('map'); setTimeout(() => map.setView([lat, lng], Math.max(map.getZoom(), z)), 50); };
  el.querySelectorAll('[data-ll]').forEach((r) => r.onclick = () => { const [a, b] = r.dataset.ll.split(',').map(Number); goMap(a, b); });
  el.querySelectorAll('[data-poi-ll]').forEach((r) => r.onclick = () => { const [a, b] = r.dataset.poiLl.split(',').map(Number); goMap(a, b, 15); });
  el.querySelectorAll('[data-player]').forEach((c) => c.onclick = (e) => { if (e.target.closest('a')) return; const l = latest(c.dataset.player); if (l) goMap(l.lat, l.lng); });
  $('#car-me').onclick = () => {
    if (state.me && Date.now() - state.me.ts < 60000) return setCar(state.me.lat, state.me.lng);
    toast('Auto', 'Standort wird bestimmt', 'detective');
    navigator.geolocation.getCurrentPosition((p) => setCar(p.coords.latitude, p.coords.longitude),
      () => toast('Auto', 'Kein Standort'), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  };
  $('#car-map').onclick = () => { state.placingCar = true; $('#b-car').classList.add('on'); if (!state.desk) setTab('map'); toast('Auto', 'Auf die Karte tippen, wo das Auto steht', 'detective'); };
  if ($('#car-clear')) $('#car-clear').onclick = clearCar;
  if ($('#osm-retry')) $('#osm-retry').onclick = () => loadLive(true);
  el.querySelectorAll('[data-compass]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openCompass(b.dataset.compass); });
}

/* ===================== Jaeger untereinander ===================== */

let lastShared = null;
/* Eigene Position fuer den anderen Jaeger: hoechstens alle 45 s oder bei 25 m Bewegung. */
function shareMe(fix) {
  if (!hunterName || fix.acc > 100) return;
  const now = Date.now();
  if (lastShared && now - lastShared.t < 45000 && distanceM(lastShared, fix) < 25) return;
  lastShared = { lat: fix.lat, lng: fix.lng, t: now };
  store.addLocation({ player_id: myHunterId(), lat: fix.lat, lng: fix.lng, accuracy: Math.round(fix.acc), source: 'hunter', created_at: new Date().toISOString() }).catch(() => {});
}

const hunterIds = () => Object.keys(state.locs).filter((k) => k.startsWith('h:') && k !== myHunterId());
const hunterLabel = (id) => id.slice(2).toUpperCase();
let hunterMarkers = {};
function drawHunters() {
  if (!map) return;
  for (const id of hunterIds()) {
    const l = latest(id);
    const show = prefs.layers.jaeger && l && ageMin(l) < 180;
    let m = hunterMarkers[id];
    if (!show) { if (m) { map.removeLayer(m); delete hunterMarkers[id]; } continue; }
    const text = hunterLabel(id) + ' ' + (ageMin(l) < 2 ? '' : Math.round(ageMin(l)) + "'");
    const icon = chipIcon(text.trim(), 'chip-hunter' + (ageMin(l) > 10 ? ' chip-old' : ''));
    if (!m) {
      m = hunterMarkers[id] = L.marker([l.lat, l.lng], { icon, zIndexOffset: 880 }).addTo(map);
      m.bindPopup(() => { const x = latest(id); return `<div class="label">Jäger · ${timeHM(x.created_at)} · ${agoText(x.created_at)}</div><div style="font-family:var(--font-display);font-size:22px;text-transform:uppercase">${esc(hunterLabel(id))}</div>${state.me ? `<div>${formatDistance(distanceM(state.me, x))} · zu Fuss ca. ${walkMin(distanceM(state.me, x))} min</div>` : ''}`; });
    } else { m.setLatLng([l.lat, l.lng]); m.setIcon(icon); }
  }
}

function ensureName() {
  if (hunterName) return;
  const box = document.createElement('div');
  box.className = 'lightbox ls-anim-settle';
  box.innerHTML = `<div class="gate" style="min-height:auto;flex:1"><div class="display d-m">Dein Name</div>
    <div class="label" style="margin-top:8px">Damit der andere Jäger dich auf der Karte sieht und Notizen zugeordnet werden.</div>
    <label class="field"><input id="hn2" maxlength="16" autocomplete="given-name"></label>
    <button class="btn solid block" id="hn2-ok" style="margin-top:16px">Speichern</button></div>`;
  document.body.appendChild(box);
  box.querySelector('#hn2-ok').onclick = () => {
    const v = box.querySelector('#hn2').value.trim(); if (!v) return;
    hunterName = v.toUpperCase(); localStorage.setItem(NAME_KEY, hunterName); box.remove();
  };
}

/* ===================== Notizen und Zeichnungen ===================== */

let itemLayers = {};
const notes = () => state.items.filter((i) => i.kind === 'note');
const drawings = () => state.items.filter((i) => i.kind === 'drawing');

function drawItems() {
  if (!map) return;
  const keep = new Set();
  for (const it of state.items) {
    if (it.kind !== 'note' && it.kind !== 'drawing') continue;
    const key = String(it.id);
    const visible = it.kind === 'note' ? prefs.layers.notizen && it.lat != null : prefs.layers.zeichnungen;
    if (!visible) continue;
    keep.add(key);
    if (itemLayers[key] && itemLayers[key]._v === it.updated_at) continue;
    if (itemLayers[key]) map.removeLayer(itemLayers[key]);
    let layer;
    if (it.kind === 'note') {
      const ki = it.data.source === 'claude';
      layer = L.marker([it.lat, it.lng], { icon: chipIcon(ki ? 'KI' + (it.data.pct != null ? ' ' + it.data.pct + '%' : '') : 'NOTIZ', ki ? 'chip-ki' : 'chip-note'), zIndexOffset: 600 });
      layer.bindPopup(() => `<div class="label">Notiz · ${esc(it.author || '')} · ${timeHM(it.created_at)}</div><div style="margin:6px 0;white-space:pre-wrap">${esc(it.data.text || '')}</div><button class="btn small quiet" data-del-item="${it.id}">Löschen</button>`);
    } else {
      layer = L.polyline(it.data.pts || [], { color: it.data.color || '#6E8CA8', weight: 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round' });
      layer.bindPopup(() => `<div class="label">Zeichnung · ${esc(it.author || '')} · ${timeHM(it.created_at)}</div><button class="btn small quiet" style="margin-top:6px" data-del-item="${it.id}">Löschen</button>`);
    }
    layer._v = it.updated_at;
    layer.addTo(map);
    itemLayers[key] = layer;
  }
  for (const key of Object.keys(itemLayers)) if (!keep.has(key)) { map.removeLayer(itemLayers[key]); delete itemLayers[key]; }
}

async function addNote(text, pos) {
  text = (text || '').trim(); if (!text) return;
  try {
    await store.addItem({ kind: 'note', data: { text }, lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, author: hunterName });
  } catch (e) { toast('Notiz', /hunter_items/.test(String(e.message || e)) ? 'Datenbank-Erweiterung 02 fehlt' : 'Speichern fehlgeschlagen'); }
}

async function deleteItem(id) {
  if (!confirm('Wirklich löschen?')) return;
  try { await store.deleteItem(Number(id)); state.items = state.items.filter((i) => String(i.id) !== String(id)); drawItems(); renderNotes(); }
  catch { toast('Löschen', 'Fehlgeschlagen'); }
}

function renderNotes() {
  const el = $('#notes-wrap'); if (!el || !isSub('notes')) return;
  const list = notes().slice().reverse();
  el.innerHTML = `
    <div class="section-head"><h2 class="display d-s">Notizen</h2><span class="label">Für beide Jäger · live</span></div>
    <textarea id="note-text" rows="4" placeholder="Idee, Beobachtung, Plan …" style="margin-top:16px"></textarea>
    <label class="layer-row" style="padding:10px 0;border:0"><input type="checkbox" class="check" id="note-geo" ${state.me ? 'checked' : ''}><span class="name">Mit meinem Standort auf der Karte</span></label>
    <div class="btn-row"><button class="btn solid" id="note-save">Speichern</button></div>
    <div class="label" style="margin-top:8px">Auf der Karte lange drücken: Notiz genau an diesem Ort.</div>
    <div class="section">
      ${list.length ? list.map((n) => `<div class="note-row">
        <div class="row"><span class="label">${timeHM(n.created_at)} · ${esc(n.author || '')}</span>
          <span>${n.lat != null ? `<button class="btn small quiet" data-note-map="${n.id}">Karte</button> ` : ''}<button class="btn small quiet" data-note-edit="${n.id}">Ändern</button> <button class="btn small quiet" data-del-item="${n.id}">Weg</button></span></div>
        <div class="note-text">${esc(n.data.text || '')}</div></div>`).join('') : '<div class="label">Noch keine Notizen</div>'}
    </div>
    <div class="section">
      <div class="section-head"><h2 class="display d-s">Zeichnungen</h2><span class="label">${pad2(drawings().length)}</span></div>
      <div class="btn-row" style="margin-top:12px"><button class="btn" id="draw-start">Auf der Karte zeichnen</button>${drawings().length ? '<button class="btn quiet" id="draw-clear">Alle löschen</button>' : ''}</div>
    </div>`;
  $('#note-save').onclick = async () => {
    const pos = $('#note-geo').checked && state.me ? state.me : null;
    if ($('#note-geo').checked && !state.me) toast('Notiz', '"Ich" ist aus, Notiz ohne Ort gespeichert');
    await addNote($('#note-text').value, pos);
    $('#note-text').value = '';
  };
  el.querySelectorAll('[data-del-item]').forEach((b) => b.onclick = () => deleteItem(b.dataset.delItem));
  el.querySelectorAll('[data-note-map]').forEach((b) => b.onclick = () => {
    const n = state.items.find((i) => String(i.id) === b.dataset.noteMap); if (!n) return;
    if (!state.desk) setTab('map');
    setTimeout(() => { map.setView([n.lat, n.lng], Math.max(map.getZoom(), 16)); const l = itemLayers[String(n.id)]; if (l) l.openPopup(); }, 60);
  });
  el.querySelectorAll('[data-note-edit]').forEach((b) => b.onclick = async () => {
    const n = state.items.find((i) => String(i.id) === b.dataset.noteEdit); if (!n) return;
    const t = prompt('Notiz ändern', n.data.text || ''); if (t == null) return;
    try { await store.updateItem(n.id, { data: { ...n.data, text: t } }); } catch { toast('Notiz', 'Fehlgeschlagen'); }
  });
  $('#draw-start').onclick = () => { if (!state.desk) setTab('map'); setDrawing(true); };
  if ($('#draw-clear')) $('#draw-clear').onclick = async () => {
    if (!confirm('Alle Zeichnungen löschen?')) return;
    for (const d of drawings()) await store.deleteItem(d.id).catch(() => {});
    state.items = state.items.filter((i) => i.kind !== 'drawing'); drawItems(); renderNotes();
  };
}

/* ---- Zeichenmodus: Finger oder Maus zeichnet, Karte steht still ---- */

const DRAW_COLORS = [['#6E8CA8', 'Steel'], ['#0C0C0E', 'Ink'], ['#7A7A74', 'Ash']];
let stroke = null;

function setDrawing(on) {
  state.drawing = on;
  $('#b-draw').classList.toggle('on', on);
  const bar = $('#drawbar');
  bar.hidden = !on;
  const c = map.getContainer();
  c.classList.toggle('drawing', on);
  if (on) {
    if (!state.desk) { prefs.sheet = false; $('#sheet').classList.add('collapsed'); }
    map.dragging.disable(); map.touchZoom.disable(); map.doubleClickZoom.disable(); map.boxZoom.disable();
    bar.innerHTML = `<span class="label">Zeichnen</span>${DRAW_COLORS.map(([col, n]) => `<button class="swatch ${state.drawColor === col ? 'on' : ''}" data-col="${col}" title="${n}" style="background:${col}"></button>`).join('')}
      <button class="btn small" id="draw-undo">Zurück</button><button class="btn small solid" id="draw-done">Fertig</button>`;
    bar.querySelectorAll('[data-col]').forEach((b) => b.onclick = () => { state.drawColor = b.dataset.col; setDrawing(true); });
    $('#draw-done').onclick = () => setDrawing(false);
    $('#draw-undo').onclick = async () => {
      const mine = drawings().filter((d) => d.author === hunterName); const last = mine[mine.length - 1];
      if (last) { await store.deleteItem(last.id).catch(() => {}); state.items = state.items.filter((i) => i.id !== last.id); drawItems(); }
    };
  } else {
    map.dragging.enable(); map.touchZoom.enable(); map.doubleClickZoom.enable(); map.boxZoom.enable();
  }
}

function initDrawing() {
  const c = map.getContainer();
  const pt = (e) => { const r = c.getBoundingClientRect(); return L.point(e.clientX - r.left, e.clientY - r.top); };
  c.addEventListener('pointerdown', (e) => {
    if (!state.drawing || e.target.closest('.map-overlay, .drawbar, .layers, .leaflet-popup')) return;
    e.preventDefault(); e.stopPropagation();
    c.setPointerCapture(e.pointerId);
    const p = pt(e);
    stroke = { last: p, pts: [map.containerPointToLatLng(p)], line: L.polyline([], { color: state.drawColor, weight: 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(map) };
  }, true);
  c.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    e.preventDefault(); e.stopPropagation();
    const p = pt(e);
    if (p.distanceTo(stroke.last) < 4) return;
    stroke.last = p; stroke.pts.push(map.containerPointToLatLng(p)); stroke.line.setLatLngs(stroke.pts);
  }, true);
  const end = async (e) => {
    if (!stroke) return;
    e.preventDefault(); e.stopPropagation();
    const s = stroke; stroke = null;
    map.removeLayer(s.line);
    if (s.pts.length < 2) return;
    const pts = s.pts.map((ll) => [+ll.lat.toFixed(6), +ll.lng.toFixed(6)]);
    try { await store.addItem({ kind: 'drawing', data: { pts, color: state.drawColor }, author: hunterName }); }
    catch (err) { toast('Zeichnen', /hunter_items/.test(String(err.message || err)) ? 'Datenbank-Erweiterung 02 fehlt' : 'Speichern fehlgeschlagen'); }
  };
  c.addEventListener('pointerup', end, true);
  c.addEventListener('pointercancel', end, true);
}

/* ===================== Popups: Knoepfe darin verdrahten ===================== */

function initPopupActions() {
  map.on('popupopen', (ev) => {
    const el = ev.popup.getElement(); if (!el) return;
    const ll = ev.popup.getLatLng();
    el.querySelectorAll('[data-del-item]').forEach((b) => b.onclick = () => { map.closePopup(); deleteItem(b.dataset.delItem); });
    el.querySelectorAll('[data-car-here]').forEach((b) => b.onclick = () => { map.closePopup(); setCar(ll.lat, ll.lng); });
    el.querySelectorAll('[data-note-here]').forEach((b) => b.onclick = () => { const t = prompt('Notiz an diesem Ort'); map.closePopup(); if (t) addNote(t, { lat: ll.lat, lng: ll.lng }); });
    el.querySelectorAll('[data-dep]').forEach((b) => b.onclick = () => loadDepartures(b.dataset.dep, el.querySelector('.deps'), ev.popup));
    el.querySelectorAll('[data-proof]').forEach((b) => b.onclick = () => openProof(b.dataset.proof));
  });
}

/* ===================== Abfahrten (VVS) ===================== */

async function loadDepartures(name, box, popup) {
  if (!box) return;
  box.innerHTML = '<div class="label">Lädt …</div>';
  popup && popup.update();
  try {
    const r = await fetch('/api/departures?name=' + encodeURIComponent(name));
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const rows = j.departures.slice(0, 10).map((d) => {
      const plan = new Date(d.planned), est = d.est ? new Date(d.est) : null;
      const delay = est ? Math.round((est - plan) / 60000) : 0;
      const inMin = Math.max(0, Math.round(((est || plan) - Date.now()) / 60000));
      return `<div class="dep"><b>${esc(d.line)}</b><span>${esc(d.dest)}</span><i>${timeHM(plan)}${delay > 0 ? ' +' + delay : ''} · ${inMin}'</i></div>`;
    }).join('');
    box.innerHTML = `<div class="label" style="margin:6px 0 4px">${esc(j.stop)}</div>${rows || '<div class="label">Keine Abfahrten</div>'}`;
  } catch {
    box.innerHTML = `<div class="label">Fahrplan nicht erreichbar. <a href="https://www.vvs.de/" target="_blank" rel="noopener">vvs.de</a></div>`;
  }
  popup && popup.update();
}

/* ===================== Prognose: wohin als naechstes ===================== */

function bearingDeg(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/* Punkte pro offenem Ort: Naehe (je naeher, desto wahrscheinlicher), Bewegungsrichtung
   (liegt der Ort voraus?) und anstehende Pflichttermine. Pro Aufgabe zaehlt nur der beste Ort. */
function prognosis(id) {
  const l = latest(id); if (!l) return [];
  const mo = motion(id);
  const now = Date.now();
  const best = {};
  for (const p of openPois()) {
    const d = distanceM(l, p);
    let score = Math.exp(-d / 2500);
    const why = [formatDistance(d)];
    if (mo && d > 150) {
      const diff = Math.abs(((bearingDeg(l, p) - bearingDeg(mo.from, mo.to)) + 540) % 360 - 180);
      const f = 0.6 + 0.8 * Math.max(0, Math.cos(diff * Math.PI / 180));
      score *= f;
      if (diff < 45) why.push('in Bewegungsrichtung');
    }
    const st = poiOpen(p);
    if (!st.always && !st.open) {
      const wait = st.next ? (st.next - now) / 60000 : Infinity;
      if (wait > 60) { score *= 0.15; why.push(st.next ? 'zu bis ' + DAYS[st.next.getDay()] + ' ' + hm(st.next) : 'zu'); }
      else why.push('öffnet ' + hm(st.next));
    } else if (st.open && st.until && (st.until - now) / 60000 < 45) { score *= 0.6; why.push('schliesst ' + hm(st.until)); }
    const appt = APPOINTMENTS.find((a) => p.tasks.includes(a.id));
    if (appt) {
      const toStart = (new Date(appt.start).getTime() - now) / 60000;
      const ended = new Date(appt.end).getTime() < now;
      if (ended) continue;
      if (toStart <= 0) { score *= 4; why.push('Termin läuft'); }
      else if (toStart < 180) { score *= 1 + 3 * (1 - toStart / 180); why.push('Termin in ' + Math.round(toStart) + ' min'); }
      else score *= 0.3;
    }
    const key = p.tasks.join(',');
    if (!best[key] || best[key].score < score) best[key] = { p, d, score, why };
  }
  const list = Object.values(best).sort((a, b) => b.score - a.score);
  const total = list.reduce((s, x) => s + x.score, 0) || 1;
  return list.slice(0, 3).map((x) => ({ ...x, pct: Math.round((x.score / total) * 100) }));
}

/* ===================== Pflichttermine pruefen ===================== */

const APPT_RADIUS = 150;
/* Laengste zusammenhaengende Anwesenheit im Zeitfenster: aufeinanderfolgende Signale
   innerhalb von 150 m (plus Messgenauigkeit), Luecken bis 25 min zaehlen durch. */
function apptCheck(a) {
  const s = new Date(a.start).getTime() - 10 * 60e3, e = new Date(a.end).getTime() + 10 * 60e3;
  const now = Date.now();
  const per = BANDIT_IDS().map((id) => {
    const pts = (state.locs[id] || []).filter((p) => { const t = new Date(p.created_at).getTime(); return t >= s && t <= e; });
    let bestMin = 0, runStart = null, prevT = null, anyIn = false;
    for (const p of pts) {
      const t = new Date(p.created_at).getTime();
      const inside = distanceM(p, a) <= APPT_RADIUS + Math.min(p.accuracy || 0, 100);
      if (inside) {
        anyIn = true;
        if (runStart === null || t - prevT > 25 * 60e3) runStart = t;
        prevT = t;
        bestMin = Math.max(bestMin, (t - runStart) / 60000);
      } else { runStart = null; prevT = null; }
    }
    return { id, pts: pts.length, anyIn, min: Math.round(bestMin) };
  });
  const status = now < s ? 'kommt' : now <= e ? 'laeuft' : 'vorbei';
  return { status, per };
}

function apptHtml(a) {
  const c = apptCheck(a);
  const head = isDone(a.id) ? 'ABGEHAKT' : c.status === 'kommt' ? untilText(a.start) : c.status === 'laeuft' ? 'LÄUFT' : 'VORBEI';
  const rows = c.status === 'kommt' ? '' : c.per.map((p) => {
    const ok = p.min >= a.stay;
    const txt = !p.pts ? 'keine Signale im Fenster' : !p.anyIn ? `${p.pts} Signale, nie vor Ort` : ok ? `erfüllt · gemessen ${p.min} min` : `${p.min} von ${a.stay} min gemessen`;
    return `<div class="lage-row"><span class="label">${esc(playerName(state.players, p.id))}</span><span class="value ${ok ? '' : 'muted'}">${esc(txt.toUpperCase())}</span><span></span></div>`;
  }).join('');
  return `<div class="appt-check"><div class="row"><span class="value">T${a.n} ${esc(a.place.toUpperCase())}</span><span class="label">${head}</span></div>
    <div class="label" style="margin:2px 0 4px">${esc(a.day)} ${esc(a.window)} · Pflicht ${a.stay} min · Radius ${APPT_RADIUS} m</div>${rows}</div>`;
}

/* ===================== Beweisfotos auf der Karte ===================== */

let proofMarkers = {};
function drawProofs() {
  if (!map) return;
  const keep = new Set();
  for (const p of state.proofs) {
    if (p.lat == null || !prefs.layers.fotos) continue;
    const key = String(p.id); keep.add(key);
    if (proofMarkers[key]) continue;
    const t = TASKS.find((x) => x.id === p.task_id) || APPOINTMENTS.find((x) => x.id === p.task_id);
    const code = t ? (t.title ? pad2(t.n) : 'T' + t.n) : '';
    const m = L.marker([p.lat, p.lng], { icon: chipIcon('FOTO ' + code, 'chip-proof'), zIndexOffset: 700 }).addTo(map);
    m.bindPopup(() => `<div class="label">Beweis ${code} · ${esc(playerName(state.players, p.uploaded_by))} · ${timeHM(p.created_at)}</div>
      ${p.url && !(p.kind || '').startsWith('video') ? `<img src="${esc(p.url)}" alt="" style="width:200px;margin:6px 0;cursor:pointer" data-proof="${p.id}">` : `<button class="btn small" style="margin:6px 0" data-proof="${p.id}">Ansehen</button>`}
      <div class="muted">${p.geo_source === 'exif' ? 'Ort aus dem Foto (GPS)' : 'Ort des Handys beim Hochladen'}</div>`);
    proofMarkers[key] = m;
  }
  for (const key of Object.keys(proofMarkers)) if (!keep.has(key)) { map.removeLayer(proofMarkers[key]); delete proofMarkers[key]; }
}

/* ===================== Oeffnungszeiten, Wettlauf, letzte Chance ===================== */

const poiOpen = (p, t = new Date()) => openState(p.hours, t);

/* Schnellste Ankunft der Jaeger an einem Ziel: zu Fuss, mit dem Auto (zu Fuss zum Auto +
   Fahrt) oder der andere Jaeger zu Fuss. */
function ourEta(to) {
  const opts = [];
  const car = carPos();
  if (state.me) opts.push({ min: walkMin(distanceM(state.me, to)), how: 'zu Fuss' });
  if (car) opts.push({ min: (state.me ? walkMin(distanceM(state.me, car)) : 0) + driveMin(distanceM(car, to)), how: 'Auto' });
  for (const id of hunterIds()) { const l = latest(id); if (l && ageMin(l) < 30) opts.push({ min: walkMin(distanceM(l, to)), how: hunterLabel(id) }); }
  return opts.sort((a, b) => a.min - b.min)[0] || null;
}

function raceHtml(id, to) {
  const l = latest(id); if (!l) return '';
  const them = transitMin(distanceM(l, to)) - Math.round(ageMin(l));   // seit dem Signal schon unterwegs
  const us = ourEta(to);
  const sie = them > 0 ? `SIE ca. ${them}'` : 'SIE KÖNNTEN SCHON DORT SEIN';
  if (!us) return `<div class="race">${sie} · für eure Zeit "Ich" oder Auto setzen</div>`;
  const diff = Math.max(0, them) - us.min;
  return `<div class="race ${diff >= 0 ? 'race-win' : ''}">${sie} · IHR ${us.min}' (${esc(us.how)}) · ${diff >= 0 ? diff + "' VORSPRUNG" : -diff + "' ZU SPÄT"}</div>`;
}

/* Offene Aufgaben mit begrenzten Oeffnungszeiten: wie viel Zeit bleibt bis Spielende? */
function lastChanceHtml() {
  const now = new Date(), end = new Date(GAME_END);
  const rows = [];
  for (const t of TASKS) {
    if (isDone(t.id)) continue;
    const places = allPois().filter((p) => p.tasks.includes(t.id) && p.hours);
    if (!places.length) continue;
    const wins = windowsUntil(places[0].hours, now, end) || [];
    const min = wins.reduce((s, w) => s + w.min, 0);
    rows.push({ t, wins, min, open: poiOpen(places[0]) });
  }
  if (!rows.length) return '<div class="label" style="padding:8px 0">Keine offenen Aufgaben mit Öffnungszeiten</div>';
  return rows.sort((a, b) => a.min - b.min).map((r) => `<div class="lage-row" style="grid-template-columns:40px 1fr">
    <span class="num ${r.min < 600 ? 'hot-num' : ''}">${pad2(r.t.n)}</span>
    <div><div class="value">${esc(r.t.title.toUpperCase())}</div>
    <div class="label" style="margin-top:2px">${r.wins.length ? esc(r.wins.slice(0, 4).map((w) => w.text).join(' · ')) : 'Bis Spielende nicht mehr offen'}</div>
    <div class="label" style="margin-top:2px;color:var(--bone)">${esc(openText(r.open))}</div></div></div>`).join('');
}

/* ===================== Funkstille, Akku ===================== */

const SILENCE_MIN = 25;
/* Bei offener Seite: einmal pro Funkstille Meldung und Ton. */
const silenceWarned = {};
function checkSilence() {
  for (const id of BANDIT_IDS()) {
    const l = latestRaw(id);
    if (!silent(l) || silenceWarned[id] === l.created_at) continue;
    silenceWarned[id] = l.created_at;
    toast('Funkstille ' + playerName(state.players, id), 'Seit ' + Math.round(ageMin(l)) + ' Minuten kein Signal', 'bandit');
    if (state.soundOn) beep('alarm');
  }
}
const silent = (l) => l && ageMin(l) >= SILENCE_MIN && Date.now() >= new Date(GAME_START).getTime() && Date.now() <= new Date(GAME_END).getTime();
const lastBattery = (id) => { const a = state.locs[id] || []; for (let i = a.length - 1; i >= 0; i--) if (a[i].battery != null) return a[i]; return null; };
function batteryText(id) {
  const b = lastBattery(id); if (!b) return '';
  return 'AKKU ' + b.battery + '%' + (b.charging ? ' LÄDT' : '') + (ageMin(b) > 30 ? ' (' + timeHM(b.created_at) + ')' : '');
}

/* ===================== Kompass ===================== */

let compass = null;
function openCompass(target) {
  closeCompass();
  const el = document.createElement('div');
  el.className = 'compass ls-anim-settle';
  el.innerHTML = `<div class="lb-bar"><span class="label" id="cp-title"></span><button class="btn small" id="cp-close">Schliessen</button></div>
    <div class="cp-targets">${BANDIT_IDS().map((id) => `<button class="btn small ${id === target ? 'on' : ''}" data-cp="${id}">${esc(playerName(state.players, id))}</button>`).join('')}</div>
    <div class="cp-dial"><div class="cp-arrow" id="cp-arrow"></div><div class="cp-n">N</div></div>
    <div class="cp-dist num" id="cp-dist">--</div>
    <div class="label" id="cp-info" style="text-align:center"></div>
    <button class="btn" id="cp-perm" hidden>Kompass erlauben</button>`;
  document.body.appendChild(el);
  compass = { el, target, heading: null, lastVib: 0 };
  el.querySelector('#cp-close').onclick = closeCompass;
  el.querySelectorAll('[data-cp]').forEach((b) => b.onclick = () => openCompass(b.dataset.cp));
  if (meWatch === null) toggleMe();
  const onOri = (e) => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
    if (h != null) { compass.heading = h; updateCompass(); }
  };
  compass.onOri = onOri;
  const start = () => { window.addEventListener('deviceorientationabsolute', onOri); window.addEventListener('deviceorientation', onOri); };
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
    const b = el.querySelector('#cp-perm'); b.hidden = false;
    b.onclick = async () => { try { if (await DeviceOrientationEvent.requestPermission() === 'granted') { b.hidden = true; start(); } } catch { toast('Kompass', 'Nicht erlaubt'); } };
  } else start();
  compass.timer = setInterval(updateCompass, 1000);
  updateCompass();
}

function closeCompass() {
  if (!compass) return;
  window.removeEventListener('deviceorientationabsolute', compass.onOri);
  window.removeEventListener('deviceorientation', compass.onOri);
  clearInterval(compass.timer);
  compass.el.remove(); compass = null;
}

function updateCompass() {
  if (!compass) return;
  const l = latest(compass.target);
  const el = compass.el;
  el.querySelector('#cp-title').textContent = 'Kompass · ' + playerName(state.players, compass.target);
  if (!l) { el.querySelector('#cp-dist').textContent = '--'; el.querySelector('#cp-info').textContent = 'Kein Signal'; return; }
  if (!state.me) { el.querySelector('#cp-info').textContent = 'Eigener Standort wird bestimmt'; return; }
  const d = distanceM(state.me, l);
  const brg = bearingDeg(state.me, l);
  const rot = compass.heading == null ? brg : brg - compass.heading;
  el.querySelector('#cp-arrow').style.transform = `rotate(${rot}deg)`;
  el.querySelector('.cp-dial').classList.toggle('north-up', compass.heading == null);
  el.querySelector('#cp-dist').textContent = d < 1000 ? Math.round(d) + ' M' : (d / 1000).toFixed(2) + ' KM';
  el.querySelector('#cp-info').textContent = `Signal ${timeHM(l.created_at)} · ${agoText(l.created_at)} · ±${l.accuracy ?? '?'} M · ich ±${Math.round(state.me.acc)} M` + (compass.heading == null ? ' · ohne Kompass: Norden oben' : '');
  /* Vibration: je naeher, desto haeufiger */
  const every = d < 50 ? 1500 : d < 150 ? 3000 : d < 400 ? 6000 : 0;
  if (every && navigator.vibrate && Date.now() - compass.lastVib > every) { navigator.vibrate(d < 50 ? [120, 60, 120] : 80); compass.lastVib = Date.now(); }
}

/* ===================== Halte und Zeitregler ===================== */

let stayLayer = null;
function drawStays() {
  if (!map) return;
  if (!stayLayer) stayLayer = L.layerGroup().addTo(map);
  stayLayer.clearLayers();
  if (!prefs.layers.halte) return;
  for (const id of BANDIT_IDS()) {
    for (const s of stays(visiblePts(id))) {
      const m = L.marker([s.lat, s.lng], { icon: chipIcon(`HALT ${s.min}'`, 'chip-stay', `border-color:${mapColor(id)}`), zIndexOffset: 500 });
      const np = nearestPoiAny(s);
      m.bindPopup(`<div class="label">${esc(playerName(state.players, id))} · Halt</div><div>${hm(s.from)}–${hm(s.to)}${s.ongoing ? ' (läuft)' : ''} · ${s.min} min · ${s.n} Signale</div>${np && np.d < 300 ? `<div class="muted">${formatDistance(np.d)} von ${esc(np.p.name)}</div>` : ''}`);
      stayLayer.addLayer(m);
    }
  }
}

function nearestPoiAny(pt) {
  let best = null;
  for (const p of allPois()) { const d = distanceM(pt, p); if (!best || d < best.d) best = { p, d }; }
  return best;
}

/* Zeitregler: state.replayT = null heisst live. Sonst werden Route und Position bis zu diesem
   Zeitpunkt gezeigt. */
const visiblePts = (id) => { const a = state.locs[id] || []; return state.replayT ? a.filter((p) => new Date(p.created_at).getTime() <= state.replayT) : a; };
const shownLatest = (id) => { const a = visiblePts(id); return a.length ? a[a.length - 1] : null; };

function replayRange() {
  let min = Infinity;
  for (const id of BANDIT_IDS()) for (const p of state.locs[id] || []) min = Math.min(min, new Date(p.created_at).getTime());
  return min === Infinity ? null : [min, Date.now()];
}

function toggleReplay() {
  const bar = $('#replaybar');
  if (!bar.hidden) { stopReplay(); bar.hidden = true; $('#b-time').classList.remove('on'); state.replayT = null; drawPlayers(); drawStays(); return; }
  const r = replayRange(); if (!r) return toast('Verlauf', 'Noch keine Signale');
  bar.hidden = false; $('#b-time').classList.add('on');
  if (!state.desk) { prefs.sheet = false; $('#sheet').classList.add('collapsed'); }
  state.replayT = r[1];
  bar.innerHTML = `<button class="btn small" id="rp-play">Abspielen</button>
    <input type="range" id="rp-range" min="${r[0]}" max="${r[1]}" step="60000" value="${r[1]}">
    <span class="label num" id="rp-time"></span><button class="btn small solid" id="rp-live">Live</button>`;
  const range = $('#rp-range');
  const apply = () => { state.replayT = Number(range.value); $('#rp-time').textContent = new Date(state.replayT).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase(); drawPlayers(); drawStays(); };
  range.oninput = () => { stopReplay(); apply(); };
  $('#rp-live').onclick = toggleReplay;
  $('#rp-play').onclick = () => {
    if (state.replayTimer) return stopReplay();
    if (Number(range.value) >= Number(range.max)) range.value = range.min;
    $('#rp-play').textContent = 'Pause';
    /* 10 Minuten Spielzeit pro Sekunde */
    state.replayTimer = setInterval(() => {
      range.value = Math.min(Number(range.max), Number(range.value) + 10 * 60000 / 4);
      apply();
      if (Number(range.value) >= Number(range.max)) stopReplay();
    }, 250);
  };
  apply();
}
function stopReplay() { clearInterval(state.replayTimer); state.replayTimer = null; const b = $('#rp-play'); if (b) b.textContent = 'Abspielen'; }

/* ===================== Linien erraten ===================== */

async function loadLines(force) {
  if (!state.osm) return;
  try { state.routes = await loadRoutes(state.osm.oepnv, force); } catch (e) { console.error(e); state.routes = state.routes || null; }
  drawLineGuess(); renderCards(); renderLage();
}

let lineLayer = null;
function lineGuesses(id) { return guessLines(state.locs[id] || [], state.routes); }

function drawLineGuess() {
  if (!map) return;
  if (!lineLayer) lineLayer = L.layerGroup().addTo(map);
  lineLayer.clearLayers();
  if (state.replayT) return;
  for (const id of BANDIT_IDS()) {
    const g = lineGuesses(id)[0]; if (!g) continue;
    const l = latest(id); if (!l || ageMin(l) > 45) continue;
    L.polyline([[l.lat, l.lng], ...g.next.map((s) => [s.lat, s.lng])], { color: mapColor(id), weight: 2, dashArray: '2 8', opacity: 0.9, interactive: false }).addTo(lineLayer);
    g.next.forEach((s, k) => L.marker([s.lat, s.lng], { icon: chipIcon(`${g.ref} ${hm(s.eta)}`, 'chip-next'), zIndexOffset: 650 - k })
      .bindTooltip(`${s.name} · ${g.ref} Richtung ${g.to}`, { className: 'ls-tip' }).addTo(lineLayer));
  }
}

function lineHtml(id) {
  const gs = lineGuesses(id); if (!gs.length) return '';
  return gs.map((g, i) => `<div class="label" style="margin-top:4px;color:${i ? 'var(--ash)' : 'var(--bone)'}">${i ? 'Oder' : 'Vermutlich'} ${esc(g.ref)} Richtung ${esc(g.to)} (${Math.round(g.kmh)} km/h): ${esc(g.next.slice(0, 4).map((s) => s.name + ' ' + hm(s.eta)).join(' · '))}</div>`).join('');
}

/* ===================== Claude-Antwort importieren ===================== */

/* Erwartet einen JSON-Block wie im Export beschrieben. Ziele werden als Notizen mit Ort
   angelegt (Quelle claude), alte Claude-Ziele auf Wunsch ersetzt. */
async function importClaude(text, replace) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!m) throw new Error('Kein JSON-Block gefunden');
  const j = JSON.parse(m[1]);
  const ziele = Array.isArray(j.ziele) ? j.ziele : [];
  if (replace) for (const n of notes().filter((n) => n.data.source === 'claude')) await store.deleteItem(n.id).catch(() => {});
  let k = 0;
  for (const z of ziele) {
    const lat = Number(z.lat), lng = Number(z.lng);
    if (!isFinite(lat) || !isFinite(lng) || !lat) continue;
    const pct = z.wahrscheinlichkeit != null ? Math.round(Number(z.wahrscheinlichkeit) * (Number(z.wahrscheinlichkeit) <= 1 ? 100 : 1)) : null;
    await store.addItem({ kind: 'note', lat, lng, author: 'CLAUDE', data: { source: 'claude', pct, text: `${z.name || 'Ziel'}${pct != null ? ' · ' + pct + '%' : ''}${z.grund ? '\n' + z.grund : ''}` } });
    k++;
  }
  if (j.notiz) { await store.addItem({ kind: 'note', author: 'CLAUDE', data: { source: 'claude', text: String(j.notiz) } }); }
  return k;
}

/* ===================== Aufgaben (nur lesen) ===================== */

const isDone = (id) => !!(state.completions[id] && state.completions[id].done);
const proofsOf = (id) => state.proofs.filter((p) => p.task_id === id);

function thumbHtml(p) {
  const isVideo = (p.kind || '').startsWith('video');
  const media = !p.url ? '<div class="label" style="padding:8px">VIDEO</div>'
    : isVideo ? `<video src="${esc(p.url)}#t=0.1" muted playsinline preload="metadata"></video>`
    : `<img src="${esc(p.url)}" alt="" loading="lazy">`;
  return `<button class="thumb" data-view="${p.id}">${media}<span class="label tag">${isVideo ? 'VIDEO' : 'FOTO'} ${timeHM(p.created_at)}</span></button>`;
}

function renderTasks() {
  const el = $('#tasks-wrap'); if (!el || state.tab !== 'tasks') return;
  const t = TASKS.filter((x) => isDone(x.id)).length;
  const a = APPOINTMENTS.filter((x) => isDone(x.id)).length;
  const row = (item, title, sub) => {
    const c = state.completions[item.id];
    const done = isDone(item.id);
    const proofs = proofsOf(item.id);
    return `<li class="task ${done ? 'done' : ''}">
      <div class="idx">${pad2(item.n)}</div>
      <div class="body">
        <div class="head"><div class="title">${esc(title)}</div><input type="checkbox" class="check" ${done ? 'checked' : ''} disabled aria-label="Erledigt"></div>
        <div class="meta">
          ${sub ? `<span class="label">${esc(sub)}</span>` : ''}
          ${done ? `<span class="label" style="color:var(--bone)">Erledigt ${timeHM(c.done_at)} · ${esc(playerName(state.players, c.done_by))}</span>` : '<span class="label">Offen</span>'}
          ${!done && proofs.length ? `<span class="label">${proofs.length} Beweis hochgeladen</span>` : ''}
        </div>
      </div>
      ${proofs.length ? `<div class="tools"><div class="thumbs">${proofs.map(thumbHtml).join('')}</div></div>` : ''}
    </li>`;
  };
  el.innerHTML = `
    <div style="display:flex;gap:32px;flex-wrap:wrap">
      <div><div class="label">Aufgaben</div><div class="tally"><span class="big">${pad2(t)}</span><span class="value muted">/24</span></div></div>
      <div><div class="label">Termine</div><div class="tally"><span class="big">${pad2(a)}</span><span class="value muted">/03</span></div></div>
      <div><div class="label">Offen</div><div class="tally"><span class="big">${pad2(24 - t)}</span></div></div>
    </div>
    <div class="section">
      <div class="section-head"><h2 class="display d-s">Pflichttermine</h2></div>
      <ul class="tasks">${APPOINTMENTS.map((x) => row(x, x.place, x.day + ' ' + x.window + ' · ' + x.note)).join('')}</ul>
    </div>
    <div class="section">
      <div class="section-head"><h2 class="display d-s">Aufgaben</h2></div>
      <ul class="tasks">${TASKS.map((x) => row(x, x.title, '')).join('')}</ul>
    </div>`;
  el.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => openProof(b.dataset.view));
}

function openProof(id) {
  const p = state.proofs.find((x) => String(x.id) === String(id));
  if (!p || !p.url) return;
  const isVideo = (p.kind || '').startsWith('video');
  const task = TASKS.find((t) => t.id === p.task_id) || APPOINTMENTS.find((t) => t.id === p.task_id);
  const lb = document.createElement('div');
  lb.className = 'lightbox ls-anim-settle';
  lb.innerHTML = `<div class="lb-bar"><span class="label">${task ? pad2(task.n) : ''} · ${esc(playerName(state.players, p.uploaded_by))} · ${timeHM(p.created_at)}</span><button class="btn small">Schliessen</button></div>
    <div class="lb-media">${isVideo ? `<video src="${esc(p.url)}" controls playsinline autoplay></video>` : `<img src="${esc(p.url)}" alt="">`}</div>
    <div class="btn-row" style="margin-top:16px;align-items:center">
      <a class="label" href="${esc(p.url)}" target="_blank" rel="noopener">Original öffnen</a>
      ${p.lat != null ? `<span class="label">${formatCoordinate(p.lat, p.lng)} · ${p.geo_source === 'exif' ? 'aus dem Foto' : 'Handy beim Upload'}</span><button class="btn small" data-lb-map>Auf Karte</button>` : ''}
    </div>`;
  lb.querySelector('button').onclick = () => lb.remove();
  const mb = lb.querySelector('[data-lb-map]');
  if (mb) mb.onclick = () => { lb.remove(); if (!state.desk) setTab('map'); setTimeout(() => map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17)), 60); };
  document.body.appendChild(lb);
}

/* ===================== Export ===================== */

function bearing(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  const deg = (Math.atan2(y, x) / rad + 360) % 360;
  return ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

function buildExport() {
  const now = new Date();
  const d = (x) => pad2(x.getDate()) + '.' + pad2(x.getMonth() + 1) + '.' + x.getFullYear();
  const ll = (p) => p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
  const out = [];
  out.push(`LAST SIGNAL - LAGEBERICHT ${d(now)} ${timeHM(now)}`);
  out.push('Kontext: City Hunt in Stuttgart, 29.10. bis 01.11.2026. 2 Gejagte (Bandits) erledigen 24 Pflichtaufgaben mit Fotobeweis und 3 Pflichttermine, 2 Jäger versuchen sie zu fangen (Berührung = Fang). Distanzen sind Luftlinie.');
  out.push('');
  out.push('AKTUELLE STANDORTE');
  for (const id of BANDIT_IDS()) {
    const l = latest(id);
    out.push(l ? `- ${playerName(state.players, id)}: ${ll(l)} (${formatCoordinate(l.lat, l.lng)}), +-${l.accuracy ?? '?'} m, ${timeHM(l.created_at)}, ${agoText(l.created_at).toLowerCase()}` : `- ${playerName(state.players, id)}: kein Signal`);
  }
  const car = carPos();
  if (car) out.push(`- Auto der Jäger: ${ll(car)}, abgestellt ${timeHM(car.created_at)}`);
  for (const id of BANDIT_IDS()) {
    const mo = motion(id); const l = latest(id); const st = l && nearestStation(l);
    if (mo || st) out.push(`- ${playerName(state.players, id)}: ${mo ? 'Richtung ' + mo.dir + ', ' + mo.kmh.toFixed(1) + ' km/h' : ''}${mo && st ? ', ' : ''}${st ? 'nächste Haltestelle ' + st.s[2] + ' (' + st.s[3] + ') ' + formatDistance(st.d).toLowerCase() : ''}`);
  }
  out.push('');
  out.push('STRECKE LETZTE 60 MIN (Zeit Lat, Lng)');
  for (const id of BANDIT_IDS()) {
    const pts = (state.locs[id] || []).filter((p) => now - new Date(p.created_at) <= 3600e3);
    if (!pts.length) { out.push(`- ${playerName(state.players, id)}: keine Punkte`); continue; }
    /* hoechstens ein Punkt pro 5 Minuten, letzter Punkt immer */
    const sampled = [];
    let lastT = -Infinity;
    pts.forEach((p, i) => { const t = new Date(p.created_at).getTime(); if (t - lastT >= 5 * 60e3 || i === pts.length - 1) { sampled.push(p); lastT = t; } });
    let dist = 0;
    for (let i = 1; i < pts.length; i++) dist += distanceM(pts[i - 1], pts[i]);
    const net = distanceM(pts[0], pts[pts.length - 1]);
    const mins = Math.max(1, (new Date(pts[pts.length - 1].created_at) - new Date(pts[0].created_at)) / 60000);
    out.push(`- ${playerName(state.players, id)}: ${sampled.map((p) => timeHM(p.created_at) + ' ' + ll(p)).join(' | ')}`);
    out.push(`  Weg ${(dist / 1000).toFixed(2)} km, Luftlinie Start-Ende ${(net / 1000).toFixed(2)} km Richtung ${net > 50 ? bearing(pts[0], pts[pts.length - 1]) : '-'}, Schnitt ${((dist / 1000) / (mins / 60)).toFixed(1)} km/h`);
  }
  out.push('');
  const done = TASKS.filter((t) => isDone(t.id));
  const open = TASKS.filter((t) => !isDone(t.id));
  out.push(`AUFGABEN ERLEDIGT ${done.length}/24`);
  done.sort((a, b) => (state.completions[a.id].done_at || '').localeCompare(state.completions[b.id].done_at || ''))
    .forEach((t) => out.push(`- ${pad2(t.n)} ${t.title} (${timeHM(state.completions[t.id].done_at)}, ${playerName(state.players, state.completions[t.id].done_by)})`));
  out.push('');
  out.push(`AUFGABEN OFFEN ${open.length}`);
  open.forEach((t) => out.push(`- ${pad2(t.n)} ${t.title}`));
  out.push('');
  out.push('PFLICHTTERMINE');
  APPOINTMENTS.forEach((a) => out.push(`- ${a.day} ${a.window}: ${a.place} (${a.lat}, ${a.lng}), ${a.note}, ${isDone(a.id) ? 'erledigt' : 'offen'}`));
  out.push('');
  out.push('POI-DISTANZEN (Luftlinie)');
  for (const id of BANDIT_IDS()) {
    const list = nearList(id, allPois());
    if (!list.length) continue;
    out.push(`- ${playerName(state.players, id)}: ` + list.map((n) => `${n.poi.name} ${formatDistance(n.d).toLowerCase()}`).join('; '));
  }
  out.push('');
  out.push('AKKU, HALTE, LINIEN');
  for (const id of BANDIT_IDS()) {
    const n = playerName(state.players, id);
    const bt = batteryText(id); if (bt) out.push(`- ${n}: ${bt.toLowerCase()}`);
    const st = stays(state.locs[id] || []).slice(-4);
    if (st.length) out.push(`- ${n} Halte: ` + st.map((x) => { const np = nearestPoiAny(x); return `${hm(x.from)}-${hm(x.to)} ${x.min} min bei ${x.lat.toFixed(4)}, ${x.lng.toFixed(4)}${np && np.d < 300 ? ' (' + np.p.name + ')' : ''}`; }).join('; '));
    const g = lineGuesses(id)[0];
    if (g) out.push(`- ${n}: vermutlich ${g.ref} Richtung ${g.to}, nächste Halte ${g.next.map((x) => x.name + ' ' + hm(x.eta)).join(', ')}`);
  }
  out.push('');
  out.push('ÖFFNUNGSZEITEN OFFENER AUFGABEN-ORTE (jetzt / Fenster bis Spielende ' + hm(new Date(GAME_END)) + ' ' + DAYS[new Date(GAME_END).getDay()] + ')');
  for (const p of openPois().filter((p) => p.hours)) {
    const w = windowsUntil(p.hours, now, new Date(GAME_END)) || [];
    out.push(`- ${p.name}: ${openText(openState(p.hours)).toLowerCase()}; ${w.length ? w.map((x) => x.text).join(', ') : 'bis Spielende zu'}`);
  }
  out.push('');
  out.push('PROGNOSE DER APP (Nähe, Richtung, Termine)');
  for (const id of BANDIT_IDS()) {
    const pr = prognosis(id);
    if (pr.length) out.push(`- ${playerName(state.players, id)}: ` + pr.map((x) => `${x.p.name} ${x.pct}% (${x.why.join(', ')})`).join('; '));
  }
  out.push('');
  out.push('PFLICHTTERMINE ANWESENHEIT');
  APPOINTMENTS.forEach((a) => { const c = apptCheck(a); out.push(`- T${a.n} ${a.place}: ${c.status}` + (c.status === 'kommt' ? '' : ', ' + c.per.map((x) => `${playerName(state.players, x.id)} ${x.min} von ${a.stay} min`).join(', '))); });
  const hs = hotspots().slice(0, 8);
  if (hs.length) {
    out.push('');
    out.push('HALTESTELLEN MIT DEN MEISTEN OFFENEN ORTEN IN 800 M');
    hs.forEach((h, i) => out.push(`${i + 1}. ${h.st[2]} (${h.st[3]}): ${h.near.map((n) => n.code + ' ' + formatDistance(n.d).toLowerCase()).join(', ')}`));
  }
  out.push('');
  out.push('FRAGE: Welchen Ort steuern die Gejagten als nächstes an, und wo können wir sie am besten abfangen? Berücksichtige offene Aufgaben, Öffnungszeiten, Bewegungsrichtung und die nächsten Pflichttermine.');
  out.push('');
  out.push('ANTWORTFORMAT: Antworte zuerst kurz in Worten. Gib am Ende genau einen JSON-Block in ```json ... ``` aus, damit wir ihn in unsere App importieren können:');
  out.push('{"ziele":[{"name":"Ort","lat":48.77,"lng":9.18,"wahrscheinlichkeit":0.4,"grund":"kurz"}],"notiz":"Empfehlung für die Jäger in 1-2 Sätzen"}');
  return out.join('\n');
}

function renderExport() {
  const el = $('#export-wrap'); if (!el || !isSub('export')) return;
  const text = buildExport();
  el.innerHTML = `
    <div class="section-head"><h2 class="display d-s">Lagebericht</h2><span class="label">${text.length} Zeichen</span></div>
    <div class="btn-row" style="margin:16px 0">
      <button class="btn solid" id="copy">Kopieren</button>
      ${navigator.share ? '<button class="btn" id="share">Teilen</button>' : ''}
      <button class="btn quiet" id="refresh">Neu</button>
    </div>
    <textarea class="export-text" id="export-text" readonly>${esc(text)}</textarea>
    <div class="section">
      <div class="section-head"><h2 class="display d-s">Antwort importieren</h2><span class="label">Von Claude</span></div>
      <div class="label" style="padding:8px 0">Die komplette Antwort von Claude hier einfügen. Die Ziele erscheinen als KI-Marken auf der Karte, die Empfehlung unter Notizen.</div>
      <textarea id="import-text" rows="6" placeholder="Antwort mit dem JSON-Block einfügen"></textarea>
      <label class="layer-row" style="padding:10px 0;border:0"><input type="checkbox" class="check" id="import-replace" checked><span class="name">Alte KI-Ziele ersetzen</span></label>
      <div class="btn-row"><button class="btn solid" id="import-go">Importieren</button></div>
    </div>
    <div class="section">
      <div class="section-head"><h2 class="display d-s">Push</h2><span class="label">Dieses Gerät</span></div>
      <div class="label" style="padding:8px 0">Kommen keine Mitteilungen an: hier neu verbinden. Danach in der Testzentrale den Test-Push wiederholen.</div>
      <button class="btn" id="push-reset">Push neu verbinden</button>
    </div>
    <div class="section">
      <div class="section-head"><h2 class="display d-s">Neustart</h2><span class="label">Vor Spielbeginn</span></div>
      <div class="label" style="padding:8px 0">Löscht alle Standorte (auch TEST), Haken, Foto-Einträge, Notizen, Zeichnungen und Alarme. Für alle Geräte. Nicht rückgängig zu machen.</div>
      <button class="btn" id="wipe-all">Alle Daten löschen</button>
    </div>
    <div class="section"><a class="label" href="/test.html" target="_blank">Testzentrale öffnen</a></div>`;
  $('#wipe-all').onclick = async () => {
    const v = prompt('Wirklich ALLE Spieldaten löschen? Zum Bestätigen LÖSCHEN eintippen.');
    if (!v || v.trim().toUpperCase() !== 'LÖSCHEN') return toast('Neustart', 'Abgebrochen');
    try {
      await store.resetData(true);
      toast('Neustart', 'Alle Daten gelöscht. Andere Geräte bitte neu laden.', 'detective');
      setTimeout(() => location.reload(), 1200);
    } catch (e) { toast('Neustart', 'Fehler: ' + (e.message || e)); }
  };
  $('#push-reset').onclick = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      await enablePush('detective');
      state.push = true; renderPush();
      toast('Push', 'Neu verbunden', 'detective');
    } catch (e) { toast('Push', String(e.message || e)); }
  };
  $('#import-go').onclick = async () => {
    try {
      const k = await importClaude($('#import-text').value, $('#import-replace').checked);
      toast('Import', k + ' Ziele übernommen', 'detective');
      $('#import-text').value = '';
    } catch (e) { toast('Import', String(e.message || e)); }
  };
  $('#copy').onclick = async () => {
    const ta = $('#export-text');
    try { await navigator.clipboard.writeText(ta.value); }
    catch { ta.focus(); ta.select(); document.execCommand('copy'); }
    toast('Export', 'In die Zwischenablage kopiert', 'detective');
  };
  if ($('#share')) $('#share').onclick = () => navigator.share({ text: $('#export-text').value }).catch(() => {});
  $('#refresh').onclick = renderExport;
}

/* ===================== Live-Daten ===================== */

/* ---- Fairness: Freigabe im Takt ----
   Fuer Gejagte wird zu jedem Taktpunkt (:00, :20, :40) der neueste Punkt davor sichtbar.
   Punkte aus 'task' (Aufgabe abgehakt), 'manual' (Jetzt senden) und 'test' sofort.
   Der TEST-Kanal und Jaeger/Auto sind nicht betroffen. */
const REVEAL_MS = (CONFIG.REVEAL_MIN || 0) * 60000;
const IMMEDIATE = new Set(['task', 'manual', 'test']);
const slotOf = (t) => Math.floor(t / REVEAL_MS) * REVEAL_MS;
const isGated = (id) => REVEAL_MS > 0 && CONFIG.BANDITS.some((b) => b.id === id);

function revealedPts(raw, now = Date.now()) {
  const out = [];
  let cand = null;
  for (const p of raw) {
    const t = new Date(p.created_at).getTime();
    if (cand && slotOf(t) > slotOf(cand.t)) { out.push(cand.p); cand = null; }
    if (IMMEDIATE.has(p.source)) out.push(p);
    else cand = { p, t };
  }
  if (cand && slotOf(cand.t) + REVEAL_MS <= now) out.push(cand.p);
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/* Sichtbare Punkte neu berechnen; true, wenn sich fuer einen Gejagten etwas geaendert hat. */
function rebuildVisible(ids = Object.keys(state.raw)) {
  let changed = false;
  for (const id of ids) {
    const raw = state.raw[id] || [];
    const vis = isGated(id) ? revealedPts(raw) : raw;
    const before = state.locs[id];
    if (!before || before.length !== vis.length || (vis.length && before[before.length - 1] !== vis[vis.length - 1])) changed = changed || isGated(id);
    state.locs[id] = vis;
  }
  return changed;
}

const nextReveal = () => slotOf(Date.now()) + REVEAL_MS;

function addLoc(row) {
  const arr = state.raw[row.player_id] ||= [];
  if (arr.some((x) => x.id === row.id)) return false;
  arr.push(row);
  arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return rebuildVisible([row.player_id]);
}

async function loadAll(initial) {
  try {
    const since = new Date(Date.now() - 5 * 24 * 3600e3).toISOString();
    const [players, locs, completions, proofs, items] = await Promise.all([store.getPlayers(), store.getLocations(since), store.getCompletions(), store.getProofs(), store.getItems().catch(() => [])]);
    state.items = items;
    state.players = players;
    state.locs = {}; state.raw = {};
    locs.forEach(addLoc);
    state.completions = Object.fromEntries(completions.map((c) => [c.task_id, c]));
    state.proofs = proofs;
    evaluateProximity(true);
    refreshPoiIcons(); buildLive();
    drawPlayers(); drawCar(); drawHunters(); drawItems(); drawProofs(); drawStays(); drawLineGuess(); renderCards(); renderTasks(); renderLage(); renderNotes();
    if (initial) fitAll();
  } catch (e) {
    console.error(e);
    state.conn = 'offline'; renderConn();
    toast('Verbindung', 'Daten konnten nicht geladen werden');
  }
}

function onEvent({ table, type, row }) {
  if (table === 'players') {
    state.players = state.players.filter((p) => p.id !== row.id).concat(type === 'DELETE' ? [] : [row]);
    drawPlayers(); renderCards();
  } else if (table === 'locations' && type === 'INSERT') {
    const changed = addLoc(row);
    if (row.player_id === 'car') { drawCar(); renderCards(); renderLage(); return; }
    if (row.player_id.startsWith('h:')) { drawHunters(); renderLage(); return; }
    if (isGated(row.player_id) && !changed) return;   /* noch nicht freigegeben */
    drawPlayers(); evaluateProximity(false); drawStays(); drawLineGuess(); renderCards(); renderLage(); if (compass) updateCompass();
  } else if (table === 'completions') {
    const before = state.completions[row.task_id];
    state.completions[row.task_id] = row;
    if (row.done && !(before && before.done)) {
      const t = TASKS.find((x) => x.id === row.task_id);
      const a = APPOINTMENTS.find((x) => x.id === row.task_id);
      const head = t ? 'Aufgabe ' + pad2(t.n) + ' erledigt' : 'Pflichttermin ' + pad2(a ? a.n : 0) + ' erledigt';
      const body = (t ? t.title : a ? a.place : '') + ' · ' + playerName(state.players, row.done_by);
      toast(head, body, 'bandit');
      systemNotify(head.toUpperCase(), body);
      if (state.soundOn) beep('task'); else if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
      if (state.tab !== 'tasks') { state.unseenTasks++; renderBadge(); }
    }
    renderTasks();
    refreshPoiIcons(); buildLive(); evaluateProximity(true); renderCards(); renderLage();
    if (isSub('export')) renderExport();
  } else if (table === 'hunter_items') {
    if (type === 'DELETE') state.items = state.items.filter((i) => i.id !== row.id);
    else {
      const i = state.items.findIndex((x) => x.id === row.id);
      if (i >= 0) state.items[i] = row; else {
        state.items.push(row);
        if (row.author && row.author !== hunterName) toast(row.kind === 'note' ? 'Notiz · ' + row.author : 'Zeichnung · ' + row.author, row.kind === 'note' ? (row.data.text || '').slice(0, 120) : 'Neue Zeichnung auf der Karte', 'detective');
      }
    }
    drawItems(); renderNotes();
  } else if (table === 'proofs') {
    if (type === 'DELETE') state.proofs = state.proofs.filter((p) => p.id !== row.id);
    else if (!state.proofs.some((p) => p.id === row.id)) {
      state.proofs.push(row);
      const t = TASKS.find((x) => x.id === row.task_id);
      toast('Neuer Beweis', (t ? pad2(t.n) + ' ' + t.title : row.task_id) + ' · ' + playerName(state.players, row.uploaded_by), 'bandit');
    }
    renderTasks(); drawProofs();
  }
}

function start() {
  renderShell();
  ensureName();
  loadAll(true);
  store.subscribe(onEvent, (s) => {
    if (DEMO) return;
    const was = state.conn; state.conn = s; renderConn();
    if (was !== 'live' && s === 'live' && was !== 'connecting') loadAll(false);
  });
  pushActive().then((on) => { state.push = on; renderPush(); });
  /* "vor X Min" und Ausgrauen alter Signale laufend aktualisieren */
  setInterval(() => {
    /* Taktpunkt erreicht: neue Positionen freigeben */
    if (rebuildVisible()) { evaluateProximity(false); drawStays(); drawLineGuess(); if (state.soundOn) beep('task'); }
    drawPlayers(); drawHunters(); renderCards(); renderLage(); checkSilence();
  }, 15000);
  setInterval(refreshPoiIcons, 5 * 60000);   /* Oeffnungszeiten aendern Sichtbarkeit */
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadAll(false); });
}

if (localStorage.getItem(AUTH_KEY) === '1') start(); else renderGate();
