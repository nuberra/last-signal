/* LAST SIGNAL — Systemcheck fuer die Testzentrale: was ist eingerichtet, was fehlt.
   Gibt keine geheimen Werte aus, nur ja/nein. */
import { supa, pushReady, vapidPairOk } from './_lib.js';

async function check(fn) { try { return { ok: true, info: await fn() }; } catch (e) { return { ok: false, info: String(e.message || e).slice(0, 160) }; } }

export default async function handler(req, res) {
  const out = {
    vapid: !!process.env.VAPID_PRIVATE_KEY,
    push: pushReady(),
    vapidPair: pushReady() && vapidPairOk(),
    owntracks: !!process.env.OWNTRACKS_PASSWORD,
    supabase: await check(async () => (await supa('players?select=id&limit=1')).length + ' Spieler'),
    erweiterung02: await check(async () => { await supa('hunter_items?select=id&limit=1'); return 'hunter_items vorhanden'; }),
    erweiterung03: await check(async () => { await supa('locations?select=battery&limit=1'); return 'Akku-Spalte vorhanden'; }),
    pushAbos: await check(async () => (await supa('push_subscriptions?select=endpoint&role=eq.detective')).length + ' Jäger-Geräte'),
    funkstilleCron: await check(async () => { const r = await supa('hunter_items?select=created_at&kind=eq.silence&order=created_at.desc&limit=1'); return r.length ? 'letzter Alarm ' + r[0].created_at : 'noch kein Alarm ausgelöst'; }),
  };
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(out);
}
