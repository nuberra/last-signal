/* LAST SIGNAL — Empfang fuer die OwnTracks-App (HTTP-Modus).
   OwnTracks sendet auch bei gesperrtem Handy. Anmeldung per Benutzer (marvin / julien)
   und dem Passwort aus der Vercel-Variable OWNTRACKS_PASSWORD.
   Antwort muss ein JSON-Array sein, sonst meldet die App einen Fehler. */
import { readJson, insertLocation, onSignal } from './_lib.js';
import { CONFIG } from '../js/config.js';

function basicAuth(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return {};
  const [user, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  return { user: (user || '').trim().toLowerCase(), pass: rest.join(':') };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json([]);
  const secret = process.env.OWNTRACKS_PASSWORD;
  if (!secret) return res.status(501).json([]);
  const { user, pass } = basicAuth(req);
  if (pass !== secret) return res.status(401).setHeader('WWW-Authenticate', 'Basic realm="last-signal"').json([]);
  const slot = CONFIG.BANDITS.find((b) => b.name.toLowerCase() === user || b.id === user);
  if (!slot) return res.status(403).json([]);

  try {
    const msg = await readJson(req);
    if (msg._type !== 'location' || typeof msg.lat !== 'number' || typeof msg.lon !== 'number') return res.status(200).json([]);
    const ts = typeof msg.tst === 'number' ? new Date(msg.tst * 1000) : new Date();
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
    return res.status(500).json([]);
  }
}
