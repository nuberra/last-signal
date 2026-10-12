/* LAST SIGNAL — Auswertung fuer die Jaeger: Oeffnungszeiten, Halte, Linien, Ankunftszeiten.
   Reine Rechenfunktionen ohne Karte und ohne DOM. */
import { distanceM, pad2 } from './common.js';

const DAYS = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];
const hm = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes());

/* ---------- Oeffnungszeiten ---------- */

function at(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day); d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + (h * 60 + m) * 60000);
}

/* Alle Oeffnungsintervalle, die das Fenster [from, to] beruehren. */
export function intervals(hours, from, to) {
  const out = [];
  const d = new Date(from); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 1);
  for (; d <= to; d.setDate(d.getDate() + 1)) {
    for (const [a, b] of hours[d.getDay()] || []) {
      const s = at(d, a), e = at(d, b);
      if (e > from && s < to) out.push([s, e]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/* { open, until, next, today } — ohne hours: immer offen. */
export function openState(hours, now = new Date()) {
  if (!hours) return { open: true, always: true };
  const week = new Date(now.getTime() + 8 * 86400e3);
  const iv = intervals(hours, now, week);
  const cur = iv.find(([s, e]) => s <= now && now < e);
  const next = iv.find(([s]) => s > now);
  const todays = (hours[now.getDay()] || []).map(([a, b]) => a + '–' + (b > '24:00' ? pad2(+b.slice(0, 2) - 24) + b.slice(2) : b)).join(', ') || 'zu';
  return { open: !!cur, until: cur ? cur[1] : null, next: next ? next[0] : null, today: todays };
}

export function openText(st) {
  if (st.always) return '';
  if (st.open) return 'OFFEN BIS ' + hm(st.until);
  if (st.next) return 'ZU · ÖFFNET ' + DAYS[st.next.getDay()] + ' ' + hm(st.next);
  return 'ZU';
}

/* Verbleibende Oeffnungsfenster bis Spielende, kompakt: "FR 09:00–18:00 · SA 09:00–18:00" */
export function windowsUntil(hours, now, end) {
  if (!hours) return null;
  return intervals(hours, now, end).map(([s, e]) => {
    const a = s < now ? now : s, b = e > end ? end : e;
    return { a, b, min: (b - a) / 60000, text: DAYS[a.getDay()] + ' ' + hm(a) + '–' + hm(b) };
  }).filter((w) => w.min > 0);
}

/* ---------- Halte: wo blieben sie laenger stehen ---------- */

export function stays(pts, { radius = 150, minMin = 10 } = {}) {
  const out = [];
  let i = 0;
  while (i < pts.length) {
    let j = i + 1;
    while (j < pts.length && distanceM(pts[i], pts[j]) <= radius) j++;
    const t0 = new Date(pts[i].created_at), t1 = new Date(pts[j - 1].created_at);
    const min = (t1 - t0) / 60000;
    if (min >= minMin) {
      const grp = pts.slice(i, j);
      out.push({
        lat: grp.reduce((s, p) => s + p.lat, 0) / grp.length,
        lng: grp.reduce((s, p) => s + p.lng, 0) / grp.length,
        from: t0, to: t1, min: Math.round(min), ongoing: j === pts.length, n: grp.length,
      });
      i = j;
    } else i++;
  }
  return out;
}

/* ---------- Ankunftszeiten (grobe Schaetzung aus Luftlinie) ---------- */

export const walkMin = (d) => Math.max(1, Math.round((d * 1.3) / 80));                // 4.8 km/h
export const driveMin = (d) => Math.max(2, Math.round(3 + (d * 1.4) / 370));          // ~22 km/h + Parken
/* Gejagte: kurze Wege zu Fuss, sonst OEPNV mit Zugang und Warten (~6 min) und ~25 km/h. */
export const transitMin = (d) => (d < 900 ? walkMin(d) : Math.round(6 + (d * 1.35) / 420));

/* ---------- Linie erraten ---------- */

function nearestIdx(stops, p, maxD) {
  let best = -1, bd = Infinity;
  stops.forEach((s, i) => { const d = distanceM(p, { lat: s[0], lng: s[1] }); if (d < bd) { bd = d; best = i; } });
  return bd <= maxD ? { i: best, d: bd } : null;
}

/* Zwei Signale schnell und weit auseinander: welche S-/U-Bahn-Linie passt
   (beide Punkte nahe an Halten derselben Linie, in Fahrtrichtung)?
   Liefert bis zu 2 Kandidaten mit den naechsten Halten und geschaetzter Ankunft. */
export function guessLines(pts, routes) {
  if (!routes || !routes.length || pts.length < 2) return [];
  const B = pts[pts.length - 1];
  const tB = new Date(B.created_at);
  let A = null;
  for (let k = pts.length - 2; k >= 0; k--) {
    const dt = (tB - new Date(pts[k].created_at)) / 60000;
    if (dt > 45) break;
    if (dt >= 2 && distanceM(pts[k], B) >= 800) { A = pts[k]; break; }
  }
  if (!A) return [];
  const dt = (tB - new Date(A.created_at)) / 60000;
  const dAB = distanceM(A, B);
  const kmh = (dAB / 1000) / (dt / 60);
  if (kmh < 7) return [];
  const cands = [];
  for (const r of routes) {
    const a = nearestIdx(r.stops, A, 700), b = nearestIdx(r.stops, B, 700);
    if (!a || !b || b.i <= a.i) continue;
    const speed = dAB / dt; // m/min entlang der Strecke (vereinfacht)
    let acc = 0;
    const next = r.stops.slice(b.i + 1, b.i + 6).map((s, k) => {
      const prev = r.stops[b.i + k];
      acc += distanceM({ lat: prev[0], lng: prev[1] }, { lat: s[0], lng: s[1] });
      return { lat: s[0], lng: s[1], name: s[2], eta: new Date(tB.getTime() + (acc / Math.max(speed, 150)) * 60000) };
    });
    cands.push({ ref: r.ref, to: r.to, score: a.d + b.d, at: r.stops[b.i][2], next, kmh });
  }
  const seen = new Set();
  return cands.sort((x, y) => x.score - y.score).filter((c) => { const k = c.ref + c.to; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 2);
}

export { hm, DAYS };
