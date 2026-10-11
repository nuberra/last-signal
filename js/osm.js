/* Live-Ebenen aus OpenStreetMap ueber die Overpass-API: Haltestellen, Gyms,
   Spielplaetze, Cafes, Apotheken. Einmal laden, 7 Tage im Browser zwischenspeichern. */
import { BBOX } from './data.js';

const CACHE_KEY = 'ls-osm-v1';
const TTL = 7 * 24 * 3600e3;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

function query() {
  const b = BBOX.join(',');
  return `[out:json][timeout:90];
(
  node["railway"~"^(station|halt|tram_stop)$"]["name"](${b});
  node["public_transport"="station"]["name"](${b});
  nwr["leisure"="fitness_centre"](${b});
  nwr["leisure"="playground"](${b});
  nwr["amenity"="cafe"](${b});
  nwr["amenity"="pharmacy"](${b});
);
out center tags;`;
}

function stationKind(t) {
  const train = t.train === 'yes' || t.station === 'train' || /S-Bahn/i.test(t.network || '') || ((t.railway === 'station' || t.railway === 'halt') && !t.light_rail && !t.subway && t.station !== 'light_rail' && t.station !== 'subway');
  const light = t.light_rail === 'yes' || t.subway === 'yes' || t.tram === 'yes' || t.railway === 'tram_stop' || t.station === 'light_rail' || t.station === 'subway';
  return train && light ? 'S+U' : train ? 'S' : light ? 'U' : null;
}

function near(a, b) {
  const dLat = (a[0] - b[0]) * 111320, dLng = (a[1] - b[1]) * 73300;
  return Math.hypot(dLat, dLng);
}

function parse(json) {
  const out = { oepnv: [], gym: [], spielplatz: [], cafe: [], apotheke: [] };
  for (const el of json.elements || []) {
    const lat = el.lat ?? (el.center && el.center.lat);
    const lng = el.lon ?? (el.center && el.center.lon);
    if (typeof lat !== 'number') continue;
    const t = el.tags || {};
    const name = t.name || '';
    if (t.leisure === 'fitness_centre') out.gym.push([lat, lng, name || 'Gym']);
    else if (t.leisure === 'playground') out.spielplatz.push([lat, lng, name || 'Spielplatz']);
    else if (t.amenity === 'cafe') out.cafe.push([lat, lng, name || 'Café']);
    else if (t.amenity === 'pharmacy') out.apotheke.push([lat, lng, name || 'Apotheke']);
    else {
      const kind = stationKind(t);
      if (!kind || !name) continue;
      /* gleiche Station mehrfach erfasst (Gleise, Bahnsteige): zusammenlegen */
      const same = out.oepnv.find((s) => s[2] === name && near(s, [lat, lng]) < 400);
      if (same) { if (same[3] !== kind) same[3] = 'S+U'; continue; }
      out.oepnv.push([lat, lng, name, kind]);
    }
  }
  return out;
}

export function cachedOsm() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c && Date.now() - c.at < TTL) return c.data;
  } catch { /* leer */ }
  return null;
}

export async function loadOsm(force = false) {
  if (!force) { const c = cachedOsm(); if (c) return c; }
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query()), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error('Overpass ' + res.status);
      const data = parse(await res.json());
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* Speicher voll */ }
      return data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
