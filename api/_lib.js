/* LAST SIGNAL — gemeinsamer Server-Teil der Vercel-Funktionen.
   Dateien mit _ am Anfang werden von Vercel nicht als eigene Route veroeffentlicht.
   Supabase-URL, anon-Schluessel und VAPID-Public-Key kommen aus js/config.js;
   geheim und nur in Vercel gesetzt: VAPID_PRIVATE_KEY, OWNTRACKS_PASSWORD. */
import webpush from 'web-push';
import { CONFIG } from '../js/config.js';
import { POI_CATEGORIES, ALERT_RADIUS_M, GAME_START, GAME_END } from '../js/data.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || CONFIG.SUPABASE_URL).replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || CONFIG.SUPABASE_ANON_KEY;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || CONFIG.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

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
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await supa('push_subscriptions?endpoint=eq.' + encodeURIComponent(s.endpoint), { method: 'DELETE' }).catch(() => {});
      }
    }
  }));
  return { sent, total: subs.length };
}

function distanceM(a, b) {
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

/* Push "NEUES SIGNAL": bei Signalen aus der Web-App immer, bei OwnTracks (laufend)
   nur, wenn das vorige Signal mindestens 15 Minuten zurueckliegt. */
export async function notifySignal(playerId, source) {
  const rows = await supa('locations?select=lat,lng,created_at,battery&player_id=eq.' + encodeURIComponent(playerId) + '&order=created_at.desc&limit=2').catch(() =>
    supa('locations?select=lat,lng,created_at&player_id=eq.' + encodeURIComponent(playerId) + '&order=created_at.desc&limit=2'));
  if (!rows || !rows.length) return;
  const [now, prev] = rows;
  const gap = prev ? (new Date(now.created_at) - new Date(prev.created_at)) / 60000 : Infinity;
  if (source === 'owntracks' && gap < 15) return;
  const np = nearestPoi(now);
  const t = new Date(now.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  const body = `${t} · ${np ? Math.round(np.d) + ' M VON ' + np.name.toUpperCase() : ''}${now.battery != null ? ' · AKKU ' + now.battery + '%' : ''}`;
  await sendPush('NEUES SIGNAL ' + banditName(playerId), body, { tag: 'signal-' + playerId });
}

export const banditName = (id) => ((CONFIG.BANDITS.find((b) => b.id === id) || {}).name || id).toUpperCase();

/* Vergleicht die zwei neuesten Punkte eines Gejagten: kommt er neu in den
   500-m-Umkreis eines Orts (alle Ebenen), geht ein Push an die Jaeger. */
export async function checkProximity(playerId) {
  const rows = await supa('locations?select=lat,lng,created_at&player_id=eq.' + encodeURIComponent(playerId) + '&order=created_at.desc&limit=2');
  if (!rows || !rows.length) return [];
  const [now, prev] = rows;
  const hits = [];
  for (const c of POI_CATEGORIES) {
    for (const poi of c.items) {
      const d = distanceM(now, poi);
      if (d > ALERT_RADIUS_M) continue;
      if (prev && distanceM(prev, poi) <= ALERT_RADIUS_M + 50) continue;
      hits.push({ name: poi.name, d });
    }
  }
  if (!hits.length) return [];
  hits.sort((a, b) => a.d - b.d);
  const who = banditName(playerId);
  const body = hits.map((h) => `${who} ist ${Math.round(h.d)} M von ${h.name} entfernt`).join('\n');
  await sendPush('ALARM ' + ALERT_RADIUS_M + ' M', body, { tag: 'alarm-' + playerId + '-' + hits[0].name });
  return hits;
}
