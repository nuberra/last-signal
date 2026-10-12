/* LAST SIGNAL — nach jedem Standort aus der Web-App: Naehe-Alarm als Push. */
import { readJson, checkProximity, notifySignal } from './_lib.js';
import { CONFIG } from '../js/config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { player_id, source } = await readJson(req);
    if (!CONFIG.BANDITS.some((b) => b.id === player_id)) return res.status(400).json({ error: 'unknown player' });
    const [hits] = await Promise.all([checkProximity(player_id), notifySignal(player_id, source || 'web').catch(() => {})]);
    return res.status(200).json({ hits });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
