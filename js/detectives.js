/* LAST SIGNAL — Ansicht der Jäger. Karte, Aufgaben, Export. */
import { CONFIG } from './config.js';
import { store, DEMO } from './store.js';
import { TASKS, APPOINTMENTS, POI_CATEGORIES, ALERT_RADIUS_M } from './data.js';
import {
  $, esc, pad2, formatCoordinate, distanceM, formatDistance, timeHM, agoText, toast, beep, unlockAudio,
  registerSW, statusText, playerName, playerColor, pushSupported, enablePush, pushActive,
} from './common.js';

const L = window.L;
const AUTH_KEY = 'ls-hunter-ok';
const PREF_KEY = 'ls-hunter-prefs';
const STALE_MIN = 30;
const root = $('#root');

let prefs = { layers: Object.fromEntries(POI_CATEGORIES.map((c) => [c.id, true])), rings: true, tiles: 'dark', route: 'all', sheet: true };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF_KEY)) }; prefs.layers = { ...Object.fromEntries(POI_CATEGORIES.map((c) => [c.id, true])), ...prefs.layers }; } catch { /* Standard */ }
const savePrefs = () => localStorage.setItem(PREF_KEY, JSON.stringify(prefs));

const state = {
  conn: DEMO ? 'demo' : 'connecting',
  tab: 'map',
  players: [],
  locs: {},            // player_id -> [{lat,lng,created_at,accuracy}]
  completions: {},
  proofs: [],
  inside: new Set(),   // "player|poi" innerhalb 500 m
  alarms: [],
  alarmLog: [],
  desk: false,
  unseenTasks: 0,
  soundOn: false,
  push: false,
};

const BANDIT_IDS = () => {
  const ids = CONFIG.BANDITS.map((b) => b.id);
  state.players.filter((p) => p.role === 'bandit' && !ids.includes(p.id)).forEach((p) => ids.push(p.id));
  return ids;
};
const latest = (id) => { const a = state.locs[id]; return a && a.length ? a[a.length - 1] : null; };
const allPois = () => POI_CATEGORIES.flatMap((c) => c.items.map((it) => ({ ...it, cat: c.id, catLabel: c.label, key: c.id + ':' + it.name })));
const visiblePois = () => allPois().filter((p) => prefs.layers[p.cat]);

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
    if (v !== CONFIG.HUNTER_PASSWORD.toLowerCase()) { $('#err').textContent = 'PASSWORT FALSCH'; return; }
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
          <button class="btn" id="b-tiles"></button>
        </div>
        <div class="layers" id="layers" hidden></div>
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
          <button data-tab="export">Export</button>
        </nav>
        <div class="view scroll" id="v-bandits" hidden><div class="wrap" id="bandits-wrap"></div></div>
        <div class="view scroll" id="v-tasks" hidden><div class="wrap" id="tasks-wrap"></div></div>
        <div class="view scroll" id="v-export" hidden><div class="wrap" id="export-wrap"></div></div>
      </aside>
      </div>
      <nav class="tabs mobile-tabs">
        <button data-tab="map">Karte</button>
        <button data-tab="tasks">Aufgaben<span class="badge" hidden></span></button>
        <button data-tab="export">Export</button>
      </nav>
    </div>`;
  root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
  $('#sheet-handle').onclick = () => { prefs.sheet = !prefs.sheet; savePrefs(); $('#sheet').classList.toggle('collapsed', !prefs.sheet); };
  $('#b-layers').onclick = () => { const el = $('#layers'); el.hidden = !el.hidden; $('#b-layers').classList.toggle('on', !el.hidden); };
  $('#b-fit').onclick = fitAll;
  $('#b-me').onclick = toggleMe;
  $('#b-tiles').onclick = () => { prefs.tiles = prefs.tiles === 'dark' ? 'light' : 'dark'; savePrefs(); applyTiles(); };
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
  $('#v-export').hidden = tab !== 'export';
  if (tab === 'map') setTimeout(() => map.invalidateSize(), 0);
  if (tab === 'bandits') renderCards();
  if (tab === 'tasks') { state.unseenTasks = 0; renderBadge(); renderTasks(); }
  if (tab === 'export') renderExport();
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

let map, tiles, poiGroups = {}, ringGroup, playerLayers = {}, meMarker = null, meWatch = null;
const TILES = {
  dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', opt: { subdomains: 'abcd', maxZoom: 20, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' } },
  light: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
};

function sqIcon(size, fill, border, cls = '') {
  return L.divIcon({
    className: 'ls-sq ' + cls,
    html: `<div style="width:${size}px;height:${size}px;background:${fill};border:2px solid ${border}"></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
}

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: false }).setView([48.7784, 9.1800], 13);
  applyTiles();
  ringGroup = L.layerGroup().addTo(map);
  for (const c of POI_CATEGORIES) {
    const g = L.layerGroup();
    for (const it of c.items) {
      const isAppt = c.id === 'termine';
      const m = L.marker([it.lat, it.lng], {
        icon: isAppt ? sqIcon(18, '#0C0C0E', '#F0EBE1') : sqIcon(12, '#F0EBE1', '#0C0C0E'),
        zIndexOffset: isAppt ? 200 : 0,
      });
      m.bindTooltip(it.name, { className: 'ls-tip', direction: 'top', offset: [0, -8] });
      m.bindPopup(() => poiPopup(it, c));
      g.addLayer(m);
    }
    poiGroups[c.id] = g;
  }
  applyLayers();
  map.on('click', () => { $('#layers').hidden = true; $('#b-layers').classList.remove('on'); });
}

function applyTiles() {
  if (tiles) map.removeLayer(tiles);
  const t = TILES[prefs.tiles] || TILES.dark;
  tiles = L.tileLayer(t.url, t.opt).addTo(map);
  $('#b-tiles').textContent = prefs.tiles === 'dark' ? 'Hell' : 'Dunkel';
}

function poiPopup(it, c) {
  const rows = BANDIT_IDS().map((id) => {
    const l = latest(id); if (!l) return '';
    const d = distanceM(l, it);
    return `<div>${esc(playerName(state.players, id))}: ${formatDistance(d)}</div>`;
  }).join('');
  return `<div class="label">${esc(c.label)}</div><div style="margin:4px 0 8px;font-family:var(--font-display);font-size:22px;line-height:1;text-transform:uppercase">${esc(it.name)}</div><div class="muted">${formatCoordinate(it.lat, it.lng)}</div>${rows ? '<hr class="rule" style="margin:8px 0">' + rows : ''}`;
}

function applyLayers() {
  ringGroup.clearLayers();
  for (const c of POI_CATEGORIES) {
    const on = !!prefs.layers[c.id];
    if (on && !map.hasLayer(poiGroups[c.id])) poiGroups[c.id].addTo(map);
    if (!on && map.hasLayer(poiGroups[c.id])) map.removeLayer(poiGroups[c.id]);
    if (on && prefs.rings) {
      for (const it of c.items) {
        L.circle([it.lat, it.lng], { radius: ALERT_RADIUS_M, color: '#7A7A74', weight: 1, opacity: 0.6, dashArray: '4 6', fill: true, fillColor: '#7A7A74', fillOpacity: 0.06, interactive: false }).addTo(ringGroup);
      }
    }
  }
}

function renderLayers() {
  const el = $('#layers'); if (!el) return;
  el.innerHTML = `
    <div class="lhead"><span class="label">Ebenen</span><button class="btn small quiet" id="l-close">Zu</button></div>
    ${POI_CATEGORIES.map((c) => `<div class="layer-row" data-layer="${c.id}"><input type="checkbox" class="check" ${prefs.layers[c.id] ? 'checked' : ''} tabindex="-1"><span class="name">${esc(c.label)}</span><span class="cnt">${pad2(c.items.length)}</span></div>`).join('')}
    <div class="layer-row" data-rings="1"><input type="checkbox" class="check" ${prefs.rings ? 'checked' : ''} tabindex="-1"><span class="name">Umkreis ${ALERT_RADIUS_M} M</span></div>
    <div style="padding:12px 16px">
      <div class="label" style="margin-bottom:8px">Route</div>
      <div class="seg">${[['1h', '1 H'], ['6h', '6 H'], ['all', 'Alles'], ['none', 'Aus']].map(([k, t]) => `<button class="btn ${prefs.route === k ? 'on' : ''}" data-route="${k}">${t}</button>`).join('')}</div>
      <div class="label" style="margin-top:12px">Alarm nur für eingeblendete Ebenen.</div>
    </div>
    <div style="padding:0 16px 12px" class="btn-row"><button class="btn small quiet" data-all="1">Alle an</button><button class="btn small quiet" data-all="0">Alle aus</button></div>`;
  $('#l-close').onclick = () => { el.hidden = true; $('#b-layers').classList.remove('on'); };
  el.querySelectorAll('[data-layer]').forEach((r) => r.onclick = () => {
    prefs.layers[r.dataset.layer] = !prefs.layers[r.dataset.layer]; savePrefs();
    applyLayers(); renderLayers(); evaluateProximity(true); renderCards();
  });
  el.querySelector('[data-rings]').onclick = () => { prefs.rings = !prefs.rings; savePrefs(); applyLayers(); renderLayers(); };
  el.querySelectorAll('[data-route]').forEach((b) => b.onclick = () => { prefs.route = b.dataset.route; savePrefs(); renderLayers(); drawPlayers(); });
  el.querySelectorAll('[data-all]').forEach((b) => b.onclick = () => {
    POI_CATEGORIES.forEach((c) => prefs.layers[c.id] = b.dataset.all === '1'); savePrefs();
    applyLayers(); renderLayers(); evaluateProximity(true); renderCards();
  });
}

function routeSince() {
  const now = Date.now();
  return { '1h': now - 3600e3, '6h': now - 6 * 3600e3, all: 0, none: Infinity }[prefs.route] ?? 0;
}

function drawPlayers() {
  if (!map) return;
  const since = routeSince();
  for (const id of BANDIT_IDS()) {
    const color = playerColor(id);
    const pts = state.locs[id] || [];
    let pl = playerLayers[id];
    if (!pl) {
      pl = playerLayers[id] = {
        route: L.polyline([], { color, weight: 3, opacity: 0.85, lineJoin: 'miter' }).addTo(map),
        dots: L.layerGroup().addTo(map),
        marker: null,
      };
    }
    const shown = pts.filter((p) => new Date(p.created_at).getTime() >= since);
    pl.route.setLatLngs(shown.map((p) => [p.lat, p.lng]));
    pl.dots.clearLayers();
    shown.slice(0, -1).forEach((p) => {
      L.circleMarker([p.lat, p.lng], { radius: 3, color: '#0C0C0E', weight: 1, fillColor: color, fillOpacity: 1 })
        .bindTooltip(timeHM(p.created_at), { className: 'ls-tip' }).addTo(pl.dots);
    });
    const l = latest(id);
    if (!l) { if (pl.marker) { map.removeLayer(pl.marker); pl.marker = null; } continue; }
    const stale = Date.now() - new Date(l.created_at).getTime() > STALE_MIN * 60e3;
    const icon = L.divIcon({
      className: 'ls-player' + (stale ? ' stale' : ''),
      html: `<div style="position:relative;width:22px;height:22px;color:${color}"><div class="pulse"></div><div class="core" style="background:${color}"></div></div>`,
      iconSize: [22, 22], iconAnchor: [11, 11],
    });
    const tip = `${esc(playerName(state.players, id))} <span style="font-family:var(--font-mono);font-size:11px;color:var(--ash)">${timeHM(l.created_at)}</span>`;
    if (!pl.marker) {
      pl.marker = L.marker([l.lat, l.lng], { icon, zIndexOffset: 1000 }).addTo(map);
      pl.marker.bindTooltip(tip, { permanent: true, direction: 'right', offset: [14, 0], className: 'ls-tip player' });
    } else {
      pl.marker.setLatLng([l.lat, l.lng]); pl.marker.setIcon(icon); pl.marker.setTooltipContent(tip);
    }
  }
}

function fitAll() {
  const pts = BANDIT_IDS().map(latest).filter(Boolean).map((l) => [l.lat, l.lng]);
  if (meMarker) pts.push(meMarker.getLatLng());
  if (!pts.length) { map.setView([48.7784, 9.1800], 13); return; }
  if (pts.length === 1) map.setView(pts[0], 16);
  else map.fitBounds(pts, { padding: [64, 64], maxZoom: 16 });
}

function toggleMe() {
  const b = $('#b-me');
  if (meWatch !== null) {
    navigator.geolocation.clearWatch(meWatch); meWatch = null;
    if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
    b.classList.remove('on'); return;
  }
  if (!('geolocation' in navigator)) return toast('Ich', 'Standort nicht verfügbar');
  b.classList.add('on');
  let first = true;
  meWatch = navigator.geolocation.watchPosition((p) => {
    const ll = [p.coords.latitude, p.coords.longitude];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: sqIcon(16, '#6E8CA8', '#0C0C0E'), zIndexOffset: 900 }).addTo(map);
      meMarker.bindTooltip('Ich', { className: 'ls-tip', direction: 'left', offset: [-10, 0] });
    } else meMarker.setLatLng(ll);
    if (first) { first = false; map.setView(ll, Math.max(map.getZoom(), 15)); }
  }, () => { toast('Ich', 'Standort nicht erlaubt'); b.classList.remove('on'); meWatch = null; }, { enableHighAccuracy: true, maximumAge: 10000 });
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
  state.inside = nowInside;
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
  $('#sheet-sum').textContent = seen.length ? 'Letztes Signal ' + timeHM(seen.map((l) => l.created_at).sort().pop()) : 'Noch kein Signal';
  el.innerHTML = cardsHtml(ids, 2);
  bindCards(el);
  const side = $('#bandits-wrap');
  if (side && state.desk && state.tab === 'bandits') {
    side.innerHTML = `
      <div class="section-head"><h2 class="display d-s">Bandits</h2><span class="label">${seen.length ? 'Letztes Signal ' + timeHM(seen.map((l) => l.created_at).sort().pop()) : 'Noch kein Signal'}</span></div>
      ${cardsHtml(ids, 5)}
      <div class="section">
        <div class="section-head"><h2 class="display d-s">Alarme</h2><span class="label">Umkreis ${ALERT_RADIUS_M} M</span></div>
        ${state.alarmLog.length ? state.alarmLog.map((a) => `<div class="log-row" data-poi="${esc(a.poi.key)}"><span class="label">${timeHM(a.at)}</span><span class="value" style="font-size:13px">${esc(a.text.toUpperCase())}</span></div>`).join('') : '<div class="label" style="padding:16px 0">Noch kein Alarm</div>'}
      </div>
      <div class="section">
        <div class="section-head"><h2 class="display d-s">Verlauf</h2><span class="label">Letzte Signale</span></div>
        ${historyHtml()}
      </div>`;
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

function bindCards(el) {
  el.querySelectorAll('[data-player]').forEach((c) => c.onclick = () => {
    const l = latest(c.dataset.player); if (l) map.setView([l.lat, l.lng], Math.max(map.getZoom(), 16));
  });
}

function cardsHtml(ids, nearCount) {
  return ids.map((id) => {
    const l = latest(id);
    const near = nearList(id).slice(0, nearCount);
    return `<div class="pcard" data-player="${id}" style="--pc:${playerColor(id)}">
      <div class="row"><span class="display d-s">${esc(playerName(state.players, id))}</span><span class="label">${l ? 'Zuletzt gesehen ' + agoText(l.created_at) : 'Kein Signal'}</span></div>
      ${l ? `<div class="row" style="margin-top:4px"><span class="value" style="font-size:13px">${formatCoordinate(l.lat, l.lng)}</span><span class="label">${timeHM(l.created_at)}${l.accuracy ? ' · ±' + l.accuracy + ' M' : ''}</span></div>
      <div class="near">${near.map((n) => `<div class="value"><span class="${n.d <= ALERT_RADIUS_M ? 'hot' : ''}">${formatDistance(n.d)}</span> <span class="muted">${esc(n.poi.name.toUpperCase())}</span></div>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
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
    <a class="label" href="${esc(p.url)}" target="_blank" rel="noopener" style="align-self:flex-start;margin-top:16px">Original öffnen</a>`;
  lb.querySelector('button').onclick = () => lb.remove();
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
  out.push('FRAGE: Welchen Ort steuern die Gejagten als nächstes an, und wo können wir sie am besten abfangen? Berücksichtige offene Aufgaben, Bewegungsrichtung und die nächsten Pflichttermine.');
  return out.join('\n');
}

function renderExport() {
  const el = $('#export-wrap'); if (!el) return;
  const text = buildExport();
  el.innerHTML = `
    <div class="section-head"><h2 class="display d-s">Lagebericht</h2><span class="label">${text.length} Zeichen</span></div>
    <div class="btn-row" style="margin:16px 0">
      <button class="btn solid" id="copy">Kopieren</button>
      ${navigator.share ? '<button class="btn" id="share">Teilen</button>' : ''}
      <button class="btn quiet" id="refresh">Neu</button>
    </div>
    <textarea class="export-text" id="export-text" readonly>${esc(text)}</textarea>`;
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

function addLoc(row) {
  const arr = state.locs[row.player_id] ||= [];
  if (arr.some((x) => x.id === row.id)) return;
  arr.push(row);
  arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function loadAll(initial) {
  try {
    const since = new Date(Date.now() - 5 * 24 * 3600e3).toISOString();
    const [players, locs, completions, proofs] = await Promise.all([store.getPlayers(), store.getLocations(since), store.getCompletions(), store.getProofs()]);
    state.players = players;
    state.locs = {};
    locs.forEach(addLoc);
    state.completions = Object.fromEntries(completions.map((c) => [c.task_id, c]));
    state.proofs = proofs;
    evaluateProximity(true);
    drawPlayers(); renderCards(); renderTasks();
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
    addLoc(row);
    drawPlayers(); evaluateProximity(false); renderCards();
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
    if (state.tab === 'export') renderExport();
  } else if (table === 'proofs') {
    if (type === 'DELETE') state.proofs = state.proofs.filter((p) => p.id !== row.id);
    else if (!state.proofs.some((p) => p.id === row.id)) {
      state.proofs.push(row);
      const t = TASKS.find((x) => x.id === row.task_id);
      toast('Neuer Beweis', (t ? pad2(t.n) + ' ' + t.title : row.task_id) + ' · ' + playerName(state.players, row.uploaded_by), 'bandit');
    }
    renderTasks();
  }
}

function start() {
  renderShell();
  loadAll(true);
  store.subscribe(onEvent, (s) => {
    if (DEMO) return;
    const was = state.conn; state.conn = s; renderConn();
    if (was !== 'live' && s === 'live' && was !== 'connecting') loadAll(false);
  });
  pushActive().then((on) => { state.push = on; renderPush(); });
  /* "vor X Min" und Ausgrauen alter Signale laufend aktualisieren */
  setInterval(() => { drawPlayers(); renderCards(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadAll(false); });
}

if (localStorage.getItem(AUTH_KEY) === '1') start(); else renderGate();
