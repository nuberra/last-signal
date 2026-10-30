/* LAST SIGNAL — Freigabe im Takt. Von Supabase (pg_cron) jede Minute aufgerufen (Taktpunkte ab 09:00 alle REVEAL_MIN Minuten),
   wirksam nur in der Jagdzeit 09:00-22:00.
   Pro Gejagtem: neuester Punkt bis zum Taktpunkt gegen den Punkt beim vorigen Taktpunkt.
   Gibt es seitdem einen neuen Punkt, geht genau ein Push raus (ALARM oder NEUES SIGNAL). */
import { supa, onSignal, REVEAL_MIN } from './_lib.js';
import { huntOpen, slotStart } from '../js/data.js';
import { CONFIG } from '../js/config.js';

const latestUntil = async (id, t) => (await supa('locations?select=lat,lng,created_at,battery,source&player_id=eq.' + id
  + '&created_at=lte.' + encodeURIComponent(new Date(t).toISOString()) + '&order=created_at.desc&limit=1').catch(() => []))[0] || null;

export default async function handler(req, res) {
  if (!REVEAL_MIN) return res.status(200).json({ skipped: 'kein Takt' });
  const ms = REVEAL_MIN * 60000;
  /* Cron ruft jede Minute auf; gearbeitet wird nur in der Minute eines Taktpunkts
     (ab 09:00 alle REVEAL_MIN Minuten). Ein paar Sekunden zu frueh oder spaet sind egal. */
  const at = Date.now() + 30000;
  const slot = slotStart(at, ms);
  if (at - slot >= 60000) return res.status(200).json({ skipped: 'kein Taktpunkt', next: new Date(slot + ms).toISOString() });
  if (!huntOpen(slot)) return res.status(200).json({ skipped: 'ausserhalb der Jagdzeit' });
  /* voriger Taktpunkt in der Jagdzeit (um 09:00 also 22:00 am Vortag) */
  let before = slot - ms;
  while (!huntOpen(before)) before -= ms;
  const out = {};
  for (const b of [...CONFIG.BANDITS, ...(CONFIG.TEST_TRACKER ? [CONFIG.TEST_TRACKER] : [])]) {
    const now = await latestUntil(b.id, slot);
    if (!now) { out[b.id] = 'kein Punkt'; continue; }
    if (new Date(now.created_at).getTime() <= before) { out[b.id] = 'nichts Neues'; continue; }
    const prev = await latestUntil(b.id, before);
    out[b.id] = (await onSignal(b.id, 'reveal', prev ? [now, prev] : [now]).catch((e) => ({ error: String(e) }))).pushed;
  }
  return res.status(200).json({ slot: new Date(slot).toISOString(), out });
}
