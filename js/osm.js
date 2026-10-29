/* Live-Ebenen aus OpenStreetMap ueber die Overpass-API: Haltestellen, Gyms,
   Spielplaetze, Cafes, Apotheken und alle weiteren Orte fuer Aufgaben (Casinos und
   Spielhallen, McDonald's, Einkaufszentren, Stadien, LEGO). Einmal laden, 7 Tage im Browser zwischenspeichern. */
import { BBOX } from './data.js';

const CACHE_KEY = 'ls-osm-v2';
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
  nwr["amenity"~"^(casino|gambling)$"](${b});
  nwr["leisure"="adult_gaming_centre"](${b});
  nwr["amenity"="fast_food"]["brand"~"McDonald",i](${b});
  nwr["amenity"="fast_food"]["name"~"McDonald",i](${b});
  nwr["shop"="mall"](${b});
  nwr["leisure"="stadium"](${b});
  nwr["shop"]["brand"~"^LEGO",i](${b});
  nwr["shop"]["name"~"^LEGO",i](${b});
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
  const out = { oepnv: [], gym: [], spielplatz: [], cafe: [], apotheke: [], 'x-casino': [], 'x-mcd': [], 'x-mall': [], 'x-stadion': [], 'x-lego': [] };
  const seen = new Set();
  for (const el of json.elements || []) {
    const lat = el.lat ?? (el.center && el.center.lat);
    const lng = el.lon ?? (el.center && el.center.lon);
    if (typeof lat !== 'number') continue;
    const t = el.tags || {};
    const name = t.name || '';
    /* nwr kann dasselbe Objekt ueber zwei Abfragen liefern */
    const uid = el.type + el.id; if (seen.has(uid)) continue; seen.add(uid);
    if (t.amenity === 'casino' || t.amenity === 'gambling' || t.leisure === 'adult_gaming_centre') out['x-casino'].push([lat, lng, name || (t.amenity === 'casino' ? 'Casino' : 'Spielhalle')]);
    else if (t.amenity === 'fast_food' && /mcdonald/i.test((t.brand || '') + ' ' + name)) out['x-mcd'].push([lat, lng, name || "McDonald's"]);
    else if (t.shop === 'mall') out['x-mall'].push([lat, lng, name || 'Einkaufszentrum']);
    else if (t.leisure === 'stadium') out['x-stadion'].push([lat, lng, name || 'Stadion']);
    else if (t.shop && /^lego/i.test(t.brand || name)) out['x-lego'].push([lat, lng, name || 'LEGO']);
    else if (t.leisure === 'fitness_centre') out.gym.push([lat, lng, name || 'Gym']);
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

/* ---------- S-Bahn- und Stadtbahn-Linien mit Haltefolge ---------- */

const ROUTES_KEY = 'ls-osm-routes-v1';

function routesQuery() {
  const b = BBOX.join(',');
  return `[out:json][timeout:120];
rel["route"~"^(train|light_rail|subway)$"]["ref"~"^(S|U) ?[0-9]+"](${b})->.r;
.r out body;
node(r.r)->.n;
.n out skel;`;
}

/* Liefert [{ ref, to, stops: [[lat, lng, name], ...] }] in Fahrtrichtung. Haltenamen werden
   ueber die naechste bekannte Station (stations aus loadOsm) zugeordnet. */
function parseRoutes(json, stations) {
  const nodes = new Map();
  for (const el of json.elements || []) if (el.type === 'node') nodes.set(el.id, [el.lat, el.lon]);
  const out = [];
  for (const el of json.elements || []) {
    if (el.type !== 'relation') continue;
    const t = el.tags || {};
    const stops = [];
    for (const m of el.members || []) {
      if (m.type !== 'node' || !/^stop/.test(m.role || '')) continue;
      const ll = nodes.get(m.ref); if (!ll) continue;
      let name = '';
      let bd = 300;
      for (const s of stations || []) { const d = near(s, ll); if (d < bd) { bd = d; name = s[2]; } }
      if (stops.length && stops[stops.length - 1][2] === name && name) continue;
      stops.push([ll[0], ll[1], name || 'Halt']);
    }
    if (stops.length >= 3) out.push({ ref: String(t.ref).replace(/\s+/g, ''), to: t.to || (stops[stops.length - 1][2]), stops });
  }
  return out;
}

export async function loadRoutes(stations, force = false) {
  if (!force) {
    try { const c = JSON.parse(localStorage.getItem(ROUTES_KEY)); if (c && Date.now() - c.at < TTL) return c.data; } catch { /* leer */ }
  }
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(routesQuery()), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error('Overpass ' + res.status);
      const data = parseRoutes(await res.json(), stations);
      try { localStorage.setItem(ROUTES_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* voll */ }
      return data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
