/* LAST SIGNAL — Empfang fuer die OwnTracks-App (HTTP-Modus).
   OwnTracks sendet auch bei gesperrtem Handy. Anmeldung per Benutzer (marvin / julien)
   und dem Passwort aus der Vercel-Variable OWNTRACKS_PASSWORD.
   Antwort muss ein JSON-Array sein, sonst meldet die App einen Fehler. */
import { readJson, insertLocation, onSignal, supa, distanceM } from './_lib.js';
import { CONFIG } from '../js/config.js';

function basicAuth(req) {
  const h = req.headers.authorization || '';
  /* ohne Anmeldung schickt OwnTracks den Benutzer im Header X-Limit-U */
  const hdrUser = String(req.headers['x-limit-u'] || '').trim().toLowerCase();
  if (!h.startsWith('Basic ')) return { user: hdrUser };
  const [user, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  return { user: (user || '').trim().toLowerCase() || hdrUser, pass: rest.join(':') };
}

/* Abgelehnte oder unbrauchbare Anfragen merken (hunter_items, kind 'ot-log'), damit die
   Testzentrale zeigen kann, ob ein Handy den Server ueberhaupt erreicht und warum es scheitert.
   Gleicher Benutzer mit gleichem Grund hoechstens alle 10 Minuten. */
async function logReject(user, reason, extra = {}) {
  try {
    const u = encodeURIComponent(user || '-');
    const last = await supa('hunter_items?select=created_at&kind=eq.ot-log&data->>user=eq.' + u + '&data->>reason=eq.' + encodeURIComponent(reason) + '&order=created_at.desc&limit=1');
    if (last.length && Date.now() - new Date(last[0].created_at).getTime() < 10 * 60000) return;
    await supa('hunter_items', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'ot-log', data: { user: user || '-', reason, ...extra } }) });
  } catch { /* nur Diagnose */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json([]);
  const secret = (process.env.OWNTRACKS_PASSWORD || '').trim();
  if (!secret) return res.status(501).json([]);
  const { user, pass } = basicAuth(req);
  if ((pass || '').trim() !== secret) {
    await logReject(user, pass == null ? 'keine Anmeldung (Authentication aus?)' : 'Passwort falsch');
    return res.status(401).setHeader('WWW-Authenticate', 'Basic realm="last-signal"').json([]);
  }
  const slots = CONFIG.TEST_TRACKER ? [...CONFIG.BANDITS, CONFIG.TEST_TRACKER] : CONFIG.BANDITS;
  const slot = slots.find((b) => b.name.toLowerCase() === user || b.id === user);
  if (!slot) { await logReject(user, 'UserID unbekannt'); return res.status(403).json([]); }

  try {
    const msg = await readJson(req);
    if (msg._type !== 'location' || typeof msg.lat !== 'number' || typeof msg.lon !== 'number') {
      /* status, lwt, transition usw. sind normal; nur Unerwartetes merken */
      if (!['status', 'lwt', 'transition', 'waypoint', 'waypoints', 'card', 'steps', 'encrypted'].includes(msg._type) || msg._type === 'encrypted') {
        await logReject(user, msg._type === 'encrypted' ? 'verschluesselt (Secret encryption key leeren)' : 'keine Position', { type: String(Array.isArray(msg) ? 'array' : msg._type || '?') });
      }
      return res.status(200).json([]);
    }
    const ts = typeof msg.tst === 'number' ? new Date(msg.tst * 1000) : new Date();
    /* Ausduennen: OwnTracks sendet im Modus Move teils alle paar Sekunden. Gespeichert wird
       ein Punkt nur, wenn seit dem letzten mindestens 60 s vergangen sind oder er 75 m weiter
       liegt (und mindestens 10 s spaeter); bei Stillstand alle 5 Minuten. So bleibt die Route genau, aber die Datenmenge klein. */
    const [last] = await supa('locations?select=lat,lng,created_at&player_id=eq.' + slot.id + '&order=created_at.desc&limit=1').catch(() => []);
    if (last) {
      const dt = (ts - new Date(last.created_at)) / 1000;
      const dist = distanceM(last, { lat: msg.lat, lng: msg.lon });
      /* aeltere Punkte (nachgesendet nach Funkloch) immer speichern */
      if (dt >= 0 && (dt < 10 || (dt < 60 && dist < 75))) return res.status(200).json([]);
      /* Stillstand (innerhalb der GPS-Ungenauigkeit): hoechstens alle 5 Minuten ein Punkt */
      const still = Math.max(50, Math.min(typeof msg.acc === 'number' ? msg.acc : 0, 150));
      if (dt >= 0 && dt < 300 && dist < still) return res.status(200).json([]);
    }
    await insertLocation({
      player_id: slot.id, lat: msg.lat, lng: msg.lon,
      accuracy: typeof msg.acc === 'number' ? Math.round(msg.acc) : null,
      source: 'owntracks', created_at: ts.toISOString(),
      battery: typeof msg.batt === 'number' ? Math.round(msg.batt) : null,
      charging: typeof msg.bs === 'number' ? msg.bs === 2 || msg.bs === 3 : null,
    });
    await onSignal(slot.id, 'owntracks').catch(() => {});
    return res.status(200).json([]);
  } catch (e) {
    console.error(e);
    await logReject(user, 'Serverfehler', { error: String(e.message || e).slice(0, 160) });
    return res.status(500).json([]);
  }
}
