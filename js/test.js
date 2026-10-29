/* LAST SIGNAL — Testzentrale. Jede Funktion vor dem Spiel selbst ausloesen und pruefen:
   Systemcheck, Gejagte simulieren, Szenarien, Push und Server, Oeffnungszeiten, Testplan.
   Simulierte Standorte tragen source = 'test' und lassen sich gezielt wieder loeschen. */
import { CONFIG } from './config.js';
import { store, DEMO } from './store.js';
import { TASKS, POI_CATEGORIES, GAME_END } from './data.js';
import { $, esc, pad2, formatCoordinate, toast, timeHM } from './common.js';
import { loadOsm, loadRoutes } from './osm.js';
import { openState, openText } from './hunt.js';

const L = window.L;
const root = $('#root');
const PLAN_KEY = 'ls-testplan';
const state = { bandit: 'b1', battery: 60, minus: 0, point: null, marker: null };
let map;

const PLAN = [
  ['Vorbereitung', [
    'Supabase: schema.sql, migration-02.sql und migration-03.sql ausgeführt',
    'Vercel: VAPID_PRIVATE_KEY und OWNTRACKS_PASSWORD gesetzt, neu deployt',
    'Systemcheck oben ist überall OK',
  ]],
  ['Gejagte (Handy von Marvin und Julien)', [
    'iPhone: Einstellungen → Datenschutz → Ortungsdienste → Safari-Websites → "Genauer Standort" an',
    'Seite / öffnen, Namen wählen, Standort erlauben, zum Home-Bildschirm hinzufügen',
    '"Jetzt senden": Punkt erscheint bei den Jägern, Genauigkeit unter 30 M',
    'Testfoto bei einer Aufgabe hochladen und abhaken: Jäger bekommen Meldung und Push',
    'OwnTracks einrichten (README), in OwnTracks "Publish" tippen: Punkt erscheint (Quelle OT)',
    'Handy sperren, 10 Minuten gehen: OwnTracks-Punkte kommen weiter an',
  ]],
  ['Jäger (beide Handys, Laptop)', [
    'Name und Passwort eingeben, zum Home-Bildschirm, dort öffnen, "Push" erlauben, einmal "Ton" tippen',
    'Test-Push unten auslösen: kommt auf beiden Handys an, auch bei geschlossener App',
    '"Ich" einschalten: Genauigkeit unter 20 M, der andere Jäger sieht dein Namensschild',
    'Auto setzen (lange drücken): beide sehen AUTO, "Lage" zeigt Zeiten',
    'Notiz schreiben und auf der Karte zeichnen: erscheint beim anderen Jäger',
    'Haltestelle antippen → "Abfahrten": Liste erscheint',
    '"Lage": Haltestellen, Prognose, Letzte Chance sind gefüllt',
    'Kompass: Testpunkt 200 m entfernt setzen, Pfeil zeigt richtig, Vibration beim Annähern',
    'Verlauf: Zeitregler spielt die Testfahrt ab',
    'Export kopieren, bei Claude einfügen, Antwort unter "Antwort importieren" einfügen: KI-Ziele auf der Karte',
  ]],
  ['Am Ende', [
    'Unten "Alles zurücksetzen", damit das Spiel ohne Testdaten startet',
  ]],
];

/* ===================== Zugang ===================== */

function gate() {
  root.innerHTML = `<div class="gate"><div class="label">Last Signal</div><h1 class="display d-l" style="margin-top:8px">Testzentrale</h1>
    <label class="field"><span class="label">Jäger-Passwort</span><input id="pw" type="password"></label>
    <div class="label error" id="err"></div><button class="btn solid block" id="go" style="margin-top:16px">Öffnen</button></div>`;
  $('#go').onclick = () => {
    if ($('#pw').value.trim().replace(/\s+/g, ' ').toLowerCase() !== CONFIG.HUNTER_PASSWORD.toLowerCase()) { $('#err').textContent = 'PASSWORT FALSCH'; return; }
    localStorage.setItem('ls-hunter-ok', '1'); render();
  };
}

/* ===================== Seite ===================== */

function section(title, sub, body) {
  return `<div class="section"><div class="section-head"><h2 class="display d-s">${title}</h2><span class="label">${sub}</span></div>${body}</div>`;
}
const result = (id) => `<div class="test-out label" id="${id}"></div>`;
const say = (id, text, ok = true) => { const el = $('#' + id); if (el) { el.textContent = text; el.classList.toggle('bad', !ok); } };

function render() {
  root.innerHTML = `
    ${DEMO ? '<div class="demo-bar">Demo-Modus · nur dieses Gerät</div>' : ''}
    <div class="wrap">
      <div class="topbar"><div><div class="label">Last Signal</div><div class="brand" style="margin-top:8px">Testzentrale</div></div>
        <a class="label" href="/jaeger.html" target="_blank">Jäger-Seite öffnen</a></div>
      <div class="label" style="margin-top:16px">Am besten die Jäger-Seite auf einem zweiten Gerät oder in einem zweiten Fenster offen haben und dort zusehen. Simulierte Signale sind als Test markiert und lassen sich unten wieder löschen.</div>

      ${section('Systemcheck', 'Server und Gerät', `<div id="health" class="test-grid"></div><button class="btn small" id="h-run" style="margin-top:12px">Neu prüfen</button>`)}

      ${section('Gejagte simulieren', 'Auf die Karte tippen', `
        <div class="btn-row" style="margin-top:12px">${CONFIG.BANDITS.map((b) => `<button class="btn small ${b.id === state.bandit ? 'on' : ''}" data-b="${b.id}">${esc(b.name)}</button>`).join('')}</div>
        <div id="tmap" class="test-map"></div>
        <div class="kv" style="margin-top:12px">
          <span class="label">Punkt</span><span class="value" id="t-point">Auf die Karte tippen</span>
          <span class="label">Akku</span><span><input type="range" id="t-bat" min="1" max="100" value="${state.battery}"> <span class="value" id="t-bat-v">${state.battery}%</span></span>
          <span class="label">Zeitpunkt</span><span class="seg">${[0, 10, 20, 30, 60].map((m) => `<button class="btn ${m === state.minus ? 'on' : ''}" data-m="${m}">${m ? '-' + m + "'" : 'Jetzt'}</button>`).join('')}</span>
        </div>
        <label class="layer-row" style="border:0;padding:10px 0"><input type="checkbox" class="check" id="t-push" checked><span class="name">Push und Nähe-Alarm auslösen</span></label>
        <div class="btn-row"><button class="btn solid" id="t-send">Signal senden</button><button class="btn" id="t-me">Mein Standort als Punkt</button></div>
        ${result('t-out')}`)}

      ${section('Szenarien', 'Ein Tipp, fertiger Ablauf', `
        <div class="test-list">
          ${scenarioRow('sc-stay', 'Halt und S-Bahn-Fahrt', 'Marvin 20 min im Milaneo, dann von Bad Cannstatt zum Hauptbahnhof. Erwartet: "HALT 20" auf der Karte, "Vermutlich S…" mit nächsten Halten, Push "Neues Signal".')}
          ${scenarioRow('sc-near', 'Annäherung an den Lego Store', 'Julien kommt von 700 m auf 250 m heran. Erwartet: Alarm-Kasten, Ton, Push "Alarm 500 M".')}
          ${scenarioRow('sc-silent', 'Funkstille', 'Julien sendet zuletzt vor 30 min, danach Prüfung wie der 5-Minuten-Takt. Erwartet: Push "Funkstille", auf der Jäger-Seite Hinweis bei Julien (nur in der Spielzeit).')}
          ${scenarioRow('sc-task', 'Aufgabe mit Foto erledigen', 'Aufgabe 05 Stadion bekommt ein Testfoto am Stadion und wird abgehakt. Erwartet: Meldung und Push, Foto-Schild auf der Karte, Haken im Reiter Aufgaben.')}
        </div>`)}

      ${section('Push und Server', 'Einzeln prüfen', `
        <div class="test-list">
          <div class="test-row"><div><div class="value">Test-Push an alle Jäger</div><div class="label">Kommt auf jedem Gerät an, auf dem "Push" erlaubt wurde.</div></div><button class="btn small" id="p-push">Senden</button></div>
          ${result('p-push-out')}
          <div class="test-row"><div><div class="value">OwnTracks-Empfang</div><div class="label">Schickt einen Punkt wie die App. Passwort = OWNTRACKS_PASSWORD.</div>
            <input id="ot-pw" type="password" placeholder="OwnTracks-Passwort" class="test-input"></div><button class="btn small" id="p-ot">Senden</button></div>
          ${result('p-ot-out')}
          <div class="test-row"><div><div class="value">Abfahrten VVS</div><input id="dep-name" value="Stadtmitte" class="test-input"></div><button class="btn small" id="p-dep">Abrufen</button></div>
          ${result('p-dep-out')}
          <div class="test-row"><div><div class="value">Haltestellen und Linien (OpenStreetMap)</div><div class="label">Lädt frisch und zählt.</div></div><button class="btn small" id="p-osm">Laden</button></div>
          ${result('p-osm-out')}
        </div>`)}

      ${section('OwnTracks-Einrichtung', 'Link für Marvin und Julien', `
        <div class="label" style="padding:8px 0">OWNTRACKS_PASSWORD eingeben (wie in Vercel). Daraus entsteht pro Gejagtem ein Link. Den Link per Nachricht schicken: Er erklärt die Installation, und ein Tipp überträgt alle Einstellungen in OwnTracks. Das Passwort steht nur im Link und geht nicht an den Server.</div>
        <input id="otl-pw" type="password" placeholder="OwnTracks-Passwort" class="test-input">
        <button class="btn small" id="otl-go" style="margin-top:8px">Links erzeugen</button>
        <div id="otl-out" style="margin-top:8px"></div>`)}

      ${section('Dauertest', 'Kommen die Signale regelmässig?', `
        <div class="label" style="padding:8px 0">Wertet alle Signale der Gejagten aus: wie viele pro Stunde, aus welcher Quelle, wo es Lücken gab und wie der Akku lief. Für den Probetag: morgens starten, abends hier auswerten.</div>
        <div class="seg" style="margin-top:8px">${[[6, '6 H'], [24, '24 H'], [48, '48 H'], [96, '4 TAGE']].map(([h, t], i) => `<button class="btn ${i === 1 ? 'on' : ''}" data-dt="${h}">${t}</button>`).join('')}</div>
        <button class="btn small solid" id="dt-run" style="margin-top:8px">Auswerten</button>
        <div id="dt-out" style="margin-top:8px"></div>`)}

      ${section('Öffnungszeiten', 'Zu einem Zeitpunkt', `
        <input type="datetime-local" id="oh-at" class="test-input" value="2026-10-31T19:30">
        <button class="btn small" id="oh-run" style="margin-top:8px">Prüfen</button>
        <div id="oh-out" style="margin-top:8px"></div>`)}

      ${section('Testplan', 'Abhaken auf diesem Gerät', PLAN.map(([g, items], gi) => `<div class="label" style="margin:16px 0 4px;color:var(--bone)">${esc(g)}</div>` + items.map((t, i) => `<label class="layer-row plan-row"><input type="checkbox" class="check" data-plan="${gi}-${i}"><span class="name">${esc(t)}</span></label>`).join('')).join(''))}

      ${section('Aufräumen', 'Vor dem Spiel', `
        <div class="btn-row" style="margin-top:12px"><button class="btn" id="r-test">Nur Testsignale löschen</button><button class="btn quiet" id="r-all">Alles zurücksetzen</button></div>
        <div class="label" style="margin-top:8px">"Alles zurücksetzen" löscht alle Standorte, Haken, Fotos-Einträge, Notizen und Zeichnungen.</div>
        ${result('r-out')}`)}
    </div>`;
  bind();
  initMap();
  runHealth();
  loadPlan();
}

function scenarioRow(id, title, text) {
  return `<div class="test-row"><div><div class="value">${esc(title)}</div><div class="label">${esc(text)}</div></div><button class="btn small" id="${id}">Starten</button></div>${result(id + '-out')}`;
}

/* ===================== Systemcheck ===================== */

async function runHealth() {
  const el = $('#health');
  const rows = [];
  const add = (k, ok, info) => rows.push(`<div class="hc ${ok === true ? 'ok' : ok === false ? 'bad' : ''}"><span class="label">${esc(k)}</span><span class="value">${ok === true ? 'OK' : ok === false ? 'FEHLT' : '–'}</span><span class="label">${esc(info || '')}</span></div>`);
  el.innerHTML = '<div class="label">Prüft …</div>';
  if (DEMO) add('Supabase', false, 'Demo-Modus: config.js ohne Supabase');
  else {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const h = await r.json();
      add('Supabase', h.supabase.ok, h.supabase.info);
      add('Erweiterung 02', h.erweiterung02.ok, h.erweiterung02.ok ? 'Notizen, Zeichnungen, Foto-Orte' : 'migration-02.sql ausführen');
      add('Erweiterung 03', h.erweiterung03.ok, h.erweiterung03.ok ? 'Akkustand' : 'migration-03.sql ausführen');
      add('Push-Schlüssel', h.push && h.vapidPair, !h.push ? 'VAPID_PRIVATE_KEY in Vercel setzen' : h.vapidPair ? 'Schlüsselpaar passt' : 'Privater Schlüssel passt nicht zum öffentlichen. Wert in Vercel genau prüfen, dann Redeploy');
      add('OwnTracks', h.owntracks, h.owntracks ? '' : 'OWNTRACKS_PASSWORD in Vercel setzen');
      add('Push-Geräte', h.pushAbos.ok && !/^0 /.test(h.pushAbos.info), h.pushAbos.info);
      add('Funkstille-Takt', h.funkstilleCron.ok ? null : false, h.funkstilleCron.info);
    } catch {
      add('Server (/api)', false, 'Nicht erreichbar. Läuft die Seite auf Vercel?');
    }
  }
  add('Standort', await permState('geolocation'), 'Berechtigung dieses Browsers');
  add('Mitteilungen', 'Notification' in window ? Notification.permission === 'granted' : false, 'Notification' in window ? Notification.permission : 'nicht verfügbar');
  add('Als App installiert', matchMedia('(display-mode: standalone)').matches || navigator.standalone === true, 'iPhone-Push nur so');
  el.innerHTML = rows.join('');
}

async function permState(name) {
  try { const p = await navigator.permissions.query({ name }); return p.state === 'granted' ? true : p.state === 'denied' ? false : null; } catch { return null; }
}

/* ===================== Karte und Simulation ===================== */

function initMap() {
  map = L.map('tmap', { zoomControl: true }).setView([48.7784, 9.1800], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  for (const c of POI_CATEGORIES) for (const it of c.items) L.circleMarker([it.lat, it.lng], { radius: 4, color: '#0C0C0E', weight: 1, fillColor: '#F0EBE1', fillOpacity: 1 }).bindTooltip(it.name).addTo(map);
  map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng));
}

function setPoint(lat, lng) {
  state.point = { lat, lng };
  if (state.marker) state.marker.setLatLng([lat, lng]);
  else state.marker = L.circleMarker([lat, lng], { radius: 9, color: '#0C0C0E', weight: 2, fillColor: '#FF4D0F', fillOpacity: 1 }).addTo(map);
  $('#t-point').textContent = formatCoordinate(lat, lng);
}

async function sendSignal(player, lat, lng, minus = 0, extra = {}, push = true) {
  const row = { player_id: player, lat, lng, accuracy: 8, source: 'test', created_at: new Date(Date.now() - minus * 60000).toISOString(), ...extra };
  await store.addLocation(row);
  if (push && !DEMO) {
    await fetch('/api/proximity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: player, source: 'test' }) }).catch(() => {});
  }
  return row;
}

const name = (id) => (CONFIG.BANDITS.find((b) => b.id === id) || {}).name || id;

/* ===================== Szenarien ===================== */

const SC = {
  async 'sc-stay'() {
    const b = 'b1';
    for (const [m, lat, lng] of [[60, 48.79118, 9.18315], [50, 48.79125, 9.18325], [40, 48.79120, 9.18318]]) await sendSignal(b, lat, lng, m, { battery: 45 }, false);
    await sendSignal(b, 48.80300, 9.21500, 12, { battery: 30 }, false);
    await sendSignal(b, 48.78400, 9.18150, 6, { battery: 28 }, true);
    return `${name(b)}: 5 Testsignale gesendet. Auf der Jäger-Seite Karte und Lage prüfen.`;
  },
  async 'sc-near'() {
    const b = 'b2';
    await sendSignal(b, 48.78060, 9.17500, 5, { battery: 70 }, false);
    await sendSignal(b, 48.77660, 9.17500, 0, { battery: 69 }, true);
    return `${name(b)}: 700 m → 250 m vom Lego Store. Alarm sollte jetzt kommen.`;
  },
  async 'sc-silent'() {
    const b = 'b2';
    await sendSignal(b, 48.77660, 9.17550, 30, {}, false);
    if (DEMO) return 'Demo-Modus: Push-Prüfung braucht den Server.';
    const r = await fetch('/api/silence?test=1').then((x) => x.json()).catch(() => null);
    return r && r.alerted ? (r.alerted.length ? 'Funkstille-Push gesendet für ' + r.alerted.map(name).join(', ') : 'Kein neuer Alarm (für dieses Signal schon gemeldet oder neueres Signal vorhanden)') : 'Server nicht erreichbar';
  },
  async 'sc-task'() {
    const b = 'b1';
    const t = TASKS.find((x) => x.n === 5);
    const pos = { lat: 48.79226, lng: 9.23208 };
    const blob = await testImage('TEST ' + pad2(t.n));
    const file = new File([blob], 'test.jpg', { type: 'image/jpeg' });
    const { url, path } = await store.uploadProof(file, t.id);
    await store.addProof({ task_id: t.id, url, path, kind: 'image/jpeg', uploaded_by: b, lat: pos.lat, lng: pos.lng, geo_source: 'device' });
    await sendSignal(b, pos.lat, pos.lng, 0, { battery: 40 }, true);
    await store.setCompletion(t.id, true, b);
    if (!DEMO) await fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'AUFGABE 05 ERLEDIGT', body: t.title + ' · ' + name(b).toUpperCase() + ' (TEST)' }) }).catch(() => {});
    return 'Aufgabe 05 mit Testfoto abgehakt. Zum Zurücksetzen unten "Alles zurücksetzen" oder auf der Gejagten-Seite den Haken entfernen.';
  },
};

function testImage(text) {
  const c = document.createElement('canvas'); c.width = 800; c.height = 600;
  const g = c.getContext('2d');
  g.fillStyle = '#0C0C0E'; g.fillRect(0, 0, 800, 600);
  g.fillStyle = '#FF4D0F'; g.fillRect(0, 0, 24, 600);
  g.fillStyle = '#F0EBE1'; g.font = '64px monospace'; g.fillText(text, 80, 300);
  g.font = '28px monospace'; g.fillText(new Date().toLocaleString('de-DE'), 80, 360);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
}

/* ===================== Bedienung ===================== */

function bind() {
  root.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => { state.bandit = b.dataset.b; root.querySelectorAll('[data-b]').forEach((x) => x.classList.toggle('on', x === b)); });
  root.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { state.minus = Number(b.dataset.m); root.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#t-bat').oninput = (e) => { state.battery = Number(e.target.value); $('#t-bat-v').textContent = state.battery + '%'; };
  $('#h-run').onclick = runHealth;
  $('#t-me').onclick = () => navigator.geolocation.getCurrentPosition((p) => { setPoint(p.coords.latitude, p.coords.longitude); map.setView([p.coords.latitude, p.coords.longitude], 16); }, () => say('t-out', 'Kein Standort', false), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  $('#t-send').onclick = async () => {
    if (!state.point) return say('t-out', 'Zuerst auf die Karte tippen', false);
    try {
      const r = await sendSignal(state.bandit, state.point.lat, state.point.lng, state.minus, { battery: state.battery }, $('#t-push').checked);
      say('t-out', `${name(state.bandit)} · ${timeHM(r.created_at)} · ${formatCoordinate(r.lat, r.lng)} gesendet`);
    } catch (e) { say('t-out', 'Fehler: ' + (e.message || e), false); }
  };
  for (const id of Object.keys(SC)) {
    $('#' + id).onclick = async () => {
      say(id + '-out', 'Läuft …');
      try { say(id + '-out', await SC[id]()); } catch (e) { say(id + '-out', 'Fehler: ' + (e.message || e), false); }
    };
  }
  $('#p-push').onclick = async () => {
    if (DEMO) return say('p-push-out', 'Demo-Modus: kein Server', false);
    const r = await fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'LAST SIGNAL TEST', body: 'Push funktioniert ' + timeHM(new Date().toISOString()) }) }).then((x) => x.json()).catch(() => null);
    const errs = r && r.errors && r.errors.length ? ' · Fehler: ' + r.errors.map((e) => `${e.service} ${e.status || ''} ${e.body}`).join(' | ') : '';
    say('p-push-out', r ? (r.error ? r.error : `Gesendet an ${r.sent} von ${r.total} Geräten${errs}`) : 'Server nicht erreichbar', !!(r && r.sent));
  };
  $('#p-ot').onclick = async () => {
    const pt = state.point || { lat: 48.7766, lng: 9.1755 };
    const b = CONFIG.BANDITS.find((x) => x.id === state.bandit);
    const r = await fetch('/api/owntracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(b.name.toLowerCase() + ':' + $('#ot-pw').value) },
      body: JSON.stringify({ _type: 'location', lat: pt.lat, lon: pt.lng, acc: 12, batt: state.battery, bs: 1, tst: Math.floor(Date.now() / 1000), tid: b.name.slice(0, 2) }),
    }).catch(() => null);
    say('p-ot-out', !r ? 'Server nicht erreichbar' : r.status === 200 ? `OK: Punkt für ${b.name} gespeichert (Quelle OT). Hinweis: dieser Punkt ist kein Testsignal und bleibt beim Löschen der Testsignale stehen.` : r.status === 401 ? 'Passwort falsch' : r.status === 501 ? 'OWNTRACKS_PASSWORD fehlt in Vercel' : 'Fehler ' + r.status, r && r.status === 200);
  };
  $('#p-dep').onclick = async () => {
    say('p-dep-out', 'Lädt …');
    const r = await fetch('/api/departures?name=' + encodeURIComponent($('#dep-name').value)).catch(() => null);
    if (!r || !r.ok) return say('p-dep-out', 'Keine Abfahrten (Server oder VVS nicht erreichbar)', false);
    const j = await r.json();
    say('p-dep-out', j.stop + ': ' + j.departures.slice(0, 5).map((d) => d.line + ' ' + d.dest + ' ' + timeHM(d.est || d.planned)).join(' · '));
  };
  $('#p-osm').onclick = async () => {
    say('p-osm-out', 'Lädt …');
    try {
      const o = await loadOsm(true);
      say('p-osm-out', `${o.oepnv.length} Haltestellen, ${o.gym.length} Gyms, ${o.spielplatz.length} Spielplätze, ${o.cafe.length} Cafés, ${o.apotheke.length} Apotheken. Linien laden …`);
      const r = await loadRoutes(o.oepnv, true);
      say('p-osm-out', `${o.oepnv.length} Haltestellen, ${o.gym.length} Gyms, ${o.spielplatz.length} Spielplätze, ${o.cafe.length} Cafés, ${o.apotheke.length} Apotheken, ${r.length} Linienverläufe (${[...new Set(r.map((x) => x.ref))].sort().join(' ')})`);
    } catch (e) { say('p-osm-out', 'OpenStreetMap nicht erreichbar: ' + (e.message || e), false); }
  };
  $('#otl-go').onclick = () => {
    const pw = $('#otl-pw').value.trim();
    if (!pw) return ($('#otl-out').innerHTML = '<div class="test-out label bad">Passwort fehlt</div>');
    $('#otl-out').innerHTML = [...CONFIG.BANDITS, ...(CONFIG.TEST_TRACKER ? [CONFIG.TEST_TRACKER] : [])].map((b) => {
      const cfg = {
        _type: 'configuration', mode: 3, url: location.origin + '/api/owntracks', auth: true,
        username: b.name.toLowerCase(), password: pw, deviceId: 'handy', tid: b.name.slice(0, 2).toUpperCase(),
        monitoring: 2, locatorDisplacement: 50, locatorInterval: 300, downgrade: 0,
      };
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const link = location.origin + '/ot.html#' + b64;
      return `<div class="test-row"><div><div class="value">${esc(b.name)}</div><div class="label" style="word-break:break-all">${esc(link)}</div></div>
        <div style="display:grid;gap:6px"><button class="btn small" data-copy="${esc(link)}">Kopieren</button>${navigator.share ? `<button class="btn small" data-share="${esc(link)}" data-name="${esc(b.name)}">Teilen</button>` : ''}</div></div>`;
    }).join('');
    $('#otl-out').querySelectorAll('[data-copy]').forEach((x) => x.onclick = async () => { try { await navigator.clipboard.writeText(x.dataset.copy); toast('Link', 'Kopiert'); } catch { prompt('Link kopieren', x.dataset.copy); } });
    $('#otl-out').querySelectorAll('[data-share]').forEach((x) => x.onclick = () => navigator.share({ title: 'OwnTracks für ' + x.dataset.name, text: 'Last Signal: OwnTracks einrichten', url: x.dataset.share }).catch(() => {}));
  };
  let dtHours = 24;
  root.querySelectorAll('[data-dt]').forEach((b) => b.onclick = () => { dtHours = Number(b.dataset.dt); root.querySelectorAll('[data-dt]').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#dt-run').onclick = () => runDauertest(dtHours);
  $('#oh-run').onclick = () => {
    const t = new Date($('#oh-at').value);
    const rows = POI_CATEGORIES.flatMap((c) => c.items).filter((p) => p.hours).map((p) => { const st = openState(p.hours, t); return `<div class="lage-row" style="grid-template-columns:1fr auto"><span class="value">${esc(p.name.toUpperCase())}</span><span class="label" style="color:${st.open ? 'var(--bone)' : 'var(--ash)'}">${esc(openText(st))}</span></div>`; });
    $('#oh-out').innerHTML = rows.join('') + `<div class="label" style="margin-top:8px">Spielende: ${new Date(GAME_END).toLocaleString('de-DE')}. Alle übrigen Orte gelten als immer zugänglich.</div>`;
  };
  $('#r-test').onclick = async () => {
    try { await store.resetData(false); say('r-out', 'Testsignale gelöscht. Jäger-Seite neu laden.'); } catch (e) { say('r-out', 'Fehler: ' + (e.message || e), false); }
  };
  $('#r-all').onclick = async () => {
    if (!confirm('Wirklich ALLES löschen? Standorte, Haken, Fotos-Einträge, Notizen, Zeichnungen.')) return;
    if (!confirm('Sicher? Das lässt sich nicht rückgängig machen.')) return;
    try { await store.resetData(true); say('r-out', 'Alles zurückgesetzt. Alle Seiten neu laden.'); } catch (e) { say('r-out', 'Fehler: ' + (e.message || e), false); }
  };
}

/* ===================== Dauertest ===================== */

const GAP_MIN = 25;
async function runDauertest(hours) {
  const out = $('#dt-out');
  out.innerHTML = '<div class="label">Lädt …</div>';
  const since = Date.now() - hours * 3600e3;
  let rows;
  try { rows = await store.getLocations(new Date(since).toISOString()); } catch (e) { out.innerHTML = `<div class="test-out label bad">Fehler: ${esc(e.message || e)}</div>`; return; }
  const fmt = (t) => new Date(t).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase();
  const who = [...CONFIG.BANDITS, ...(CONFIG.TEST_TRACKER && rows.some((r) => r.player_id === CONFIG.TEST_TRACKER.id) ? [CONFIG.TEST_TRACKER] : [])];
  out.innerHTML = who.map((b) => {
    const pts = rows.filter((r) => r.player_id === b.id && r.source !== 'test').sort((a, c) => a.created_at.localeCompare(c.created_at));
    if (!pts.length) return `<div class="dt-card"><div class="display d-s">${esc(b.name)}</div><div class="test-out label bad">Keine Signale in den letzten ${hours} H</div></div>`;
    const bySrc = {};
    pts.forEach((p) => { const k = p.source === 'owntracks' ? 'OwnTracks' : 'Web-App'; bySrc[k] = (bySrc[k] || 0) + 1; });
    const ot = pts.filter((p) => p.source === 'owntracks');
    /* Luecken: zwischen zwei Signalen und vom letzten Signal bis jetzt */
    const times = pts.map((p) => new Date(p.created_at).getTime());
    const gaps = [];
    for (let i = 1; i < times.length; i++) { const g = (times[i] - times[i - 1]) / 60000; if (g >= GAP_MIN) gaps.push({ from: times[i - 1], to: times[i], min: Math.round(g) }); }
    const sinceLast = Math.round((Date.now() - times[times.length - 1]) / 60000);
    if (sinceLast >= GAP_MIN) gaps.push({ from: times[times.length - 1], to: null, min: sinceLast });
    const maxGap = gaps.reduce((m, g) => Math.max(m, g.min), 0);
    /* Signale pro Stunde als Balken */
    const buckets = Array.from({ length: hours }, () => 0);
    times.forEach((t) => { const i = Math.floor((t - since) / 3600e3); if (i >= 0 && i < hours) buckets[i]++; });
    const peak = Math.max(1, ...buckets);
    const bat = pts.filter((p) => p.battery != null);
    const verdict = !gaps.length ? ['ok', 'Durchgehend Signale, keine Lücke über ' + GAP_MIN + ' Min.'] : maxGap < 60 ? ['warn', gaps.length + ' kurze Lücke(n), längste ' + maxGap + ' Min.'] : ['bad', gaps.length + ' Lücke(n), längste ' + maxGap + ' Min.'];
    return `<div class="dt-card">
      <div class="row" style="display:flex;justify-content:space-between;align-items:baseline"><span class="display d-s">${esc(b.name)}</span><span class="dt-verdict dt-${verdict[0]}">${esc(verdict[1])}</span></div>
      <div class="kv" style="margin-top:8px">
        <span class="label">Signale</span><span class="value">${pts.length} · ${Object.entries(bySrc).map(([k, v]) => k + ' ' + v).join(' · ')}</span>
        <span class="label">Erstes / letztes</span><span class="value">${fmt(times[0])} / ${fmt(times[times.length - 1])}</span>
        <span class="label">OwnTracks</span><span class="value">${ot.length ? 'letztes ' + fmt(ot[ot.length - 1].created_at) : 'KEINE — OwnTracks prüfen'}</span>
        <span class="label">Akku</span><span class="value">${bat.length ? bat[0].battery + '% → ' + bat[bat.length - 1].battery + '% (' + fmt(bat[bat.length - 1].created_at) + ')' : 'keine Angabe'}</span>
      </div>
      <div class="label" style="margin-top:12px">Signale pro Stunde (links ${fmt(since)}, rechts jetzt)</div>
      <div class="dt-bars">${buckets.map((n) => `<i style="height:${Math.round((n / peak) * 100)}%" class="${n ? '' : 'zero'}" title="${n}"></i>`).join('')}</div>
      ${gaps.length ? `<div class="label" style="margin-top:12px">Lücken ab ${GAP_MIN} Min.</div>` + gaps.slice(-8).map((g) => `<div class="lage-row" style="grid-template-columns:1fr auto"><span class="value">${fmt(g.from)} → ${g.to ? fmt(g.to) : 'JETZT'}</span><span class="label" style="color:var(--bone)">${g.min} MIN</span></div>`).join('') : ''}
    </div>`;
  }).join('') + `<div class="label" style="margin-top:8px">Testsignale aus der Testzentrale zählen nicht mit.</div>`;
}

function loadPlan() {
  let done = {};
  try { done = JSON.parse(localStorage.getItem(PLAN_KEY)) || {}; } catch { /* leer */ }
  root.querySelectorAll('[data-plan]').forEach((cb) => {
    cb.checked = !!done[cb.dataset.plan];
    cb.onchange = () => { done[cb.dataset.plan] = cb.checked; localStorage.setItem(PLAN_KEY, JSON.stringify(done)); };
  });
}

if (localStorage.getItem('ls-hunter-ok') === '1') render(); else gate();
