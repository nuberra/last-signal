/* LAST SIGNAL — gemeinsamer Server-Teil der Vercel-Funktionen.
   Dateien mit _ am Anfang werden von Vercel nicht als eigene Route veroeffentlicht.
   Supabase-URL, anon-Schluessel und VAPID-Public-Key kommen aus js/config.js;
   geheim und nur in Vercel gesetzt: VAPID_PRIVATE_KEY, OWNTRACKS_PASSWORD. */
import webpush from 'web-push';
import crypto from 'node:crypto';
import { CONFIG } from '../js/config.js';
import { POI_CATEGORIES, LIVE_LAYERS, GAME_START, GAME_END, huntOpen, alarmRadius } from '../js/data.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || CONFIG.SUPABASE_URL).replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || CONFIG.SUPABASE_ANON_KEY;
/* trim: beim Kopieren in Vercel rutschen leicht Leerzeichen oder Zeilenumbrueche mit */
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '');
const VAPID_PUBLIC = clean(process.env.VAPID_PUBLIC_KEY || CONFIG.VAPID_PUBLIC_KEY);
const VAPID_PRIVATE = clean(process.env.VAPID_PRIVATE_KEY);

/* Passt der private Schluessel zum oeffentlichen in config.js? */
export function vapidPairOk() {
  try {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(VAPID_PRIVATE.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    const pub = ecdh.getPublicKey().toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return pub === VAPID_PUBLIC;
  } catch { return false; }
}

export async function supa(path, init = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error('Supabase ' + res.status + ' ' + (await res.text()));
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export const pushReady = () => !!(VAPID_PUBLIC && VAPID_PRIVATE && SUPABASE_URL);

/* Push an alle Geraete einer Rolle. Abgelaufene Abos werden entfernt. */
export async function sendPush(title, body, { role = 'detective', tag } = {}) {
  if (!pushReady()) return { sent: 0, reason: 'push not configured' };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:last-signal@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
  const subs = await supa('push_subscriptions?select=endpoint,subscription&role=eq.' + role);
  const payload = JSON.stringify({ title, body, url: role === 'detective' ? '/jaeger.html' : '/', tag: tag || title });
  let sent = 0;
  const errors = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      errors.push({ status: e.statusCode || null, service: String(s.endpoint).split('/')[2], body: String(e.body || e.message || '').slice(0, 200) });
      if (e.statusCode === 404 || e.statusCode === 410) {
        await supa('push_subscriptions?endpoint=eq.' + encodeURIComponent(s.endpoint), { method: 'DELETE' }).catch(() => {});
      }
    }
  }));
  return { sent, total: subs.length, errors };
}

export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const inGame = (t = Date.now()) => t >= new Date(GAME_START).getTime() && t <= new Date(GAME_END).getTime();

/* Standort speichern; fehlen die Akku-Spalten (Erweiterung 03 nicht ausgefuehrt), ohne sie. */
export async function insertLocation(row) {
  try {
    await supa('locations', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  } catch (e) {
    if (!/battery|charging|column/i.test(String(e.message))) throw e;
    const { battery, charging, ...rest } = row;
    await supa('locations', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rest) });
  }
}

function nearestPoi(p) {
  let best = null;
  for (const c of POI_CATEGORIES) for (const poi of c.items) {
    const d = distanceM(p, poi);
    if (!best || d < best.d) best = { name: poi.name, d };
  }
  return best;
}

export const banditName = (id) => ((CONFIG.BANDITS.find((b) => b.id === id) || (CONFIG.TEST_TRACKER && CONFIG.TEST_TRACKER.id === id && CONFIG.TEST_TRACKER) || {}).name || id).toUpperCase();

/* Fairness: Positionen der Gejagten werden im Takt freigegeben (siehe api/reveal.js).
   Sofort gepusht werden nur Signale beim Abhaken ('task'), "Jetzt senden" ('manual'),
   Testsignale ('test'), nur in der Jagdzeit 09-22 Uhr. Der TEST-Kanal laeuft wie die Gejagten. */
export const REVEAL_MIN = CONFIG.REVEAL_MIN || 0;
export const isImmediate = (playerId, source) =>
  !REVEAL_MIN || (['task', 'manual', 'test'].includes(source) && huntOpen(Date.now()));

/* Alle Orte mit Alarm (Umkreis siehe alarmRadius in data.js, Innenstadt kleiner): feste Orte und die OSM-Aufgaben-Orte, die die Jaeger-Seite in
   hunter_items (kind 'osm-pois') ablegt, mit dem Umkreis ihrer Ebene. */
export async function alarmPlaces() {
  const fixed = POI_CATEGORIES.flatMap((c) => c.items.map((p) => ({ ...p, radius: alarmRadius(p) })));
  const [row] = await supa('hunter_items?select=data&kind=eq.osm-pois&order=created_at.desc&limit=1').catch(() => []);
  const layers = Object.fromEntries(LIVE_LAYERS.filter((l) => l.alarm).map((l) => [l.id, l]));
  const live = ((row && row.data && row.data.list) || []).flatMap(([lat, lng, name, cat]) => {
    const l = layers[cat]; return l ? [{ name, lat, lng, tasks: l.tasks, radius: alarmRadius({ lat, lng }, l) }] : [];
  });
  return [...fixed, ...live];
}

/* Ein Push pro Signal, nie zwei:
   - ALARM, wenn der Gejagte neu in den Umkreis eines Orts mit OFFENER Aufgabe kommt (feste Orte
     500 m, OSM-Orte 50 bis 300 m; erledigte Orte zaehlen nicht). Bei OwnTracks hoechstens ein Alarm alle 10 Minuten.
   - sonst NEUES SIGNAL: aus der Web-App immer, aus OwnTracks nur nach 15 Minuten Pause. */
export async function onSignal(playerId, source = 'web', pair = null) {
  if (!pair && !isImmediate(playerId, source)) return { pushed: null, waiting: 'naechster Takt' };
  const rows = pair || await supa('locations?select=lat,lng,created_at,battery&player_id=eq.' + encodeURIComponent(playerId) + '&order=created_at.desc&limit=2').catch(() =>
    supa('locations?select=lat,lng,created_at&player_id=eq.' + encodeURIComponent(playerId) + '&order=created_at.desc&limit=2'));
  if (!rows || !rows.length) return { pushed: null };
  const [now, prev] = rows;
  const done = new Set((await supa('completions?select=task_id&done=eq.true').catch(() => [])).map((r) => r.task_id));
  const hits = [];
  for (const poi of await alarmPlaces()) {
    if (poi.tasks && poi.tasks.length && poi.tasks.every((t) => done.has(t))) continue;
    const d = distanceM(now, poi);
    if (d > poi.radius) continue;
    if (prev && distanceM(prev, poi) <= poi.radius + 50) continue;
    hits.push({ name: poi.name, d });
  }
  hits.sort((a, b) => a.d - b.d);
  const who = banditName(playerId);
  const t = new Date(now.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  const akku = now.battery != null ? ' · AKKU ' + now.battery + '%' : '';

  if (hits.length) {
    let throttled = false;
    if (source === 'owntracks') {
      const last = await supa('hunter_items?select=created_at&kind=eq.alarm&data->>player=eq.' + playerId + '&order=created_at.desc&limit=1').catch(() => []);
      throttled = !!(last.length && Date.now() - new Date(last[0].created_at).getTime() < 10 * 60000);
    }
    if (!throttled) {
      await supa('hunter_items', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'alarm', data: { player: playerId } }) }).catch(() => {});
      const list = hits.slice(0, 2).map((h) => Math.round(h.d) + ' M VON ' + h.name.toUpperCase()).join(' · ') + (hits.length > 2 ? ` (+${hits.length - 2})` : '');
      await sendPush('ALARM ' + who, `${t} · ${list}${akku}`, { tag: 'signal-' + playerId });
      return { pushed: 'alarm', hits };
    }
  }
  const gap = prev ? (new Date(now.created_at) - new Date(prev.created_at)) / 60000 : Infinity;
  if (source === 'owntracks' && !pair && gap < 15) return { pushed: null, hits };
  const np = nearestPoi(now);
  await sendPush('NEUES SIGNAL ' + who, `${t}${np ? ' · ' + Math.round(np.d) + ' M VON ' + np.name.toUpperCase() : ''}${akku}`, { tag: 'signal-' + playerId });
  return { pushed: 'signal', hits };
}
