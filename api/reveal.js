/* LAST SIGNAL — Freigabe im Takt. Von Supabase (pg_cron) um :00, :20 und :40 aufgerufen,
   wirksam nur in der Jagdzeit 09:00-22:00.
   Pro Gejagtem: neuester Punkt bis zum Taktpunkt gegen den Punkt beim vorigen Taktpunkt.
   Gibt es seitdem einen neuen Punkt, geht genau ein Push raus (ALARM oder NEUES SIGNAL). */
import { supa, onSignal, REVEAL_MIN } from './_lib.js';
import { huntOpen } from '../js/data.js';
import { CONFIG } from '../js/config.js';

const latestUntil = async (id, t) => (await supa('locations?select=lat,lng,created_at,battery,source&player_id=eq.' + id
  + '&created_at=lte.' + encodeURIComponent(new Date(t).toISOString()) + '&order=created_at.desc&limit=1').catch(() => []))[0] || null;

export default async function handler(req, res) {
  if (!REVEAL_MIN) return res.status(200).json({ skipped: 'kein Takt' });
  const ms = REVEAL_MIN * 60000;
  const slot = Math.floor((Date.now() + 30000) / ms) * ms;   /* Cron darf ein paar Sekunden zu frueh oder spaet sein */
  if (!huntOpen(slot)) return res.status(200).json({ skipped: 'ausserhalb der Jagdzeit' });
  /* voriger Taktpunkt in der Jagdzeit (um 09:00 also 22:00 am Vortag) */
  let before = slot - ms;
  while (!huntOpen(before)) before -= ms;
  const out = {};
  for (const b of CONFIG.BANDITS) {
    const now = await latestUntil(b.id, slot);
    if (!now) { out[b.id] = 'kein Punkt'; continue; }
    if (new Date(now.created_at).getTime() <= before) { out[b.id] = 'nichts Neues'; continue; }
    const prev = await latestUntil(b.id, before);
    out[b.id] = (await onSignal(b.id, 'reveal', prev ? [now, prev] : [now]).catch((e) => ({ error: String(e) }))).pushed;
  }
  return res.status(200).json({ slot: new Date(slot).toISOString(), out });
}
