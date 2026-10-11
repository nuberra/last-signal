/* LAST SIGNAL — Push an alle Jaeger-Geraete. Vercel Serverless Function.
   Umgebungsvariablen: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. */
import webpush from 'web-push';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(501).json({ error: 'Push nicht konfiguriert' });
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const title = String(body.title || 'LAST SIGNAL').slice(0, 120);
  const text = String(body.body || '').slice(0, 300);
  const role = body.role === 'bandit' ? 'bandit' : 'detective';

  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:last-signal@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
  const base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/push_subscriptions';
  const r = await fetch(base + '?select=endpoint,subscription&role=eq.' + role, { headers });
  if (!r.ok) return res.status(502).json({ error: 'Supabase ' + r.status });
  const subs = await r.json();

  const payload = JSON.stringify({ title, body: text, url: role === 'detective' ? '/jaeger.html' : '/', tag: title });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await fetch(base + '?endpoint=eq.' + encodeURIComponent(s.endpoint), { method: 'DELETE', headers }).catch(() => {});
      }
    }
  }));
  return res.status(200).json({ sent, total: subs.length });
}
