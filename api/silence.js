/* LAST SIGNAL — Funkstille-Alarm. Wird alle 5 Minuten von Supabase (pg_cron) aufgerufen.
   Liegt das letzte Signal eines Gejagten laenger als 25 Minuten zurueck, geht einmal pro
   Funkstille ein Push an die Jaeger. Gemerkt wird das in hunter_items (kind = 'silence'). */
import { supa, sendPush, banditName, inGame } from './_lib.js';
import { CONFIG } from '../js/config.js';
import { huntOpen, localMin, HUNT_FROM_MIN } from '../js/data.js';

const LIMIT_MIN = 25;

export default async function handler(req, res) {
  /* ?test=1 aus der Testzentrale: auch ausserhalb der Spielzeit pruefen */
  const test = req.query && req.query.test === '1';
  if (!test && !inGame()) return res.status(200).json({ skipped: 'ausserhalb der Spielzeit' });
  if (!test && !huntOpen(Date.now())) return res.status(200).json({ skipped: 'ausserhalb der Jagdzeit' });
  const out = [];
  for (const b of CONFIG.BANDITS) {
    const [last] = await supa('locations?select=created_at&player_id=eq.' + b.id + '&order=created_at.desc&limit=1');
    if (!last) continue;
    /* Funkstille zaehlt fruehestens ab 09:00 */
    let age = (Date.now() - new Date(last.created_at).getTime()) / 60000;
    if (!test) age = Math.min(age, localMin(Date.now()) - HUNT_FROM_MIN);
    if (age < LIMIT_MIN) continue;
    const seen = await supa('hunter_items?select=id&kind=eq.silence&data->>player=eq.' + b.id + '&data->>since=eq.' + encodeURIComponent(last.created_at));
    if (seen.length) continue;
    await supa('hunter_items', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'silence', data: { player: b.id, since: last.created_at } }) });
    await sendPush('FUNKSTILLE ' + banditName(b.id), `Seit ${Math.round(age)} Minuten kein Signal`, { tag: 'silence-' + b.id });
    out.push(b.id);
  }
  return res.status(200).json({ alerted: out });
}
