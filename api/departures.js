/* LAST SIGNAL — naechste Abfahrten an einer Haltestelle ueber die VVS-Fahrplanauskunft (EFA).
   Laeuft auf dem Server, weil die VVS-Schnittstelle Browser-Anfragen anderer Seiten nicht erlaubt.
   GET /api/departures?name=Stadtmitte */
const EFA = 'https://www3.vvs.de/mngvvs/XML_DM_REQUEST';

function params(name) {
  return new URLSearchParams({
    SpEncId: '0', coordOutputFormat: 'EPSG:4326', deleteAssignedStops: '1', limit: '14',
    mode: 'direct', name_dm: name, outputFormat: 'rapidJSON', serverInfo: '0',
    type_dm: 'any', useRealtime: '1', version: '10.2.10.139',
  });
}

function pick(json) {
  const evs = json.stopEvents || [];
  return evs.map((e) => {
    const t = e.transportation || {};
    return {
      line: t.disassembledName || t.number || (t.product && t.product.name) || '',
      product: (t.product && t.product.name) || '',
      dest: (t.destination && t.destination.name) || '',
      planned: e.departureTimePlanned || null,
      est: e.departureTimeEstimated || null,
      platform: (e.location && e.location.properties && (e.location.properties.platformName || e.location.properties.platform)) || '',
    };
  }).filter((d) => d.planned);
}

export default async function handler(req, res) {
  const name = String((req.query && req.query.name) || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'name fehlt' });
  const tries = /stuttgart/i.test(name) ? [name] : ['Stuttgart, ' + name, name];
  for (const n of tries) {
    try {
      const r = await fetch(EFA + '?' + params(n), { headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const json = await r.json();
      const deps = pick(json);
      if (!deps.length) continue;
      const loc = (json.locations && json.locations[0]) || {};
      res.setHeader('Cache-Control', 's-maxage=30');
      return res.status(200).json({ stop: loc.disassembledName || loc.name || n, departures: deps });
    } catch { /* naechster Versuch */ }
  }
  return res.status(502).json({ error: 'Keine Abfahrten gefunden' });
}
