/* LAST SIGNAL — nach jedem Standort aus der Web-App: Naehe-Alarm als Push. */
import { readJson, onSignal } from './_lib.js';
import { CONFIG } from '../js/config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { player_id, source } = await readJson(req);
    if (!CONFIG.BANDITS.some((b) => b.id === player_id)) return res.status(400).json({ error: 'unknown player' });
    return res.status(200).json(await onSignal(player_id, source || 'web'));
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
