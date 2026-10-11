/* LAST SIGNAL — Push an alle Jaeger-Geraete, ausgeloest von der Gejagten-Seite. */
import { readJson, sendPush, pushReady } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!pushReady()) return res.status(501).json({ error: 'Push nicht konfiguriert' });
  try {
    const body = await readJson(req);
    const title = String(body.title || 'LAST SIGNAL').slice(0, 120);
    const text = String(body.body || '').slice(0, 300);
    const role = body.role === 'bandit' ? 'bandit' : 'detective';
    return res.status(200).json(await sendPush(title, text, { role }));
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
