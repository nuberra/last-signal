/* Datenschicht. Supabase im Spiel, localStorage + BroadcastChannel im Demo-Modus.
   Beide liefern dieselbe Schnittstelle, die Ansichten kennen nur `store`. */
import { CONFIG } from './config.js';

export const DEMO = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;

function supabaseStore() {
  let client = null;
  const ready = import('../vendor/supabase.js').then(({ createClient }) => {
    client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  });
  const q = async (fn) => {
    await ready;
    const { data, error } = await fn(client);
    if (error) throw error;
    return data;
  };
  return {
    ready,
    getPlayers: () => q((c) => c.from('players').select('*')),
    upsertPlayer: (p) => q((c) => c.from('players').upsert({ ...p, updated_at: new Date().toISOString() }).select()),
    /* Ohne Erweiterung 03 fehlen battery/charging: dann ohne Akku speichern. */
    async addLocation(l) {
      try { return await q((c) => c.from('locations').insert(l).select()); }
      catch (e) {
        if (!('battery' in l || 'charging' in l) || !/battery|charging|column/i.test(String(e.message || e))) throw e;
        const { battery, charging, ...rest } = l;
        return q((c) => c.from('locations').insert(rest).select());
      }
    },
    getLocations: (sinceIso) => q((c) => c.from('locations').select('*').gte('created_at', sinceIso).order('created_at', { ascending: true }).limit(5000)),
    getCompletions: () => q((c) => c.from('completions').select('*')),
    setCompletion: (task_id, done, by) => q((c) => c.from('completions').upsert({
      task_id, done, done_by: done ? by : null, done_at: done ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }).select()),
    getProofs: () => q((c) => c.from('proofs').select('*').order('created_at', { ascending: true })),
    /* Ohne Erweiterung 02 fehlen lat/lng in proofs: dann ohne Ortsangabe speichern. */
    async addProof(p) {
      try { return await q((c) => c.from('proofs').insert(p).select()); }
      catch (e) {
        if (!/lat|lng|geo_source|column/i.test(String(e.message || e))) throw e;
        const { lat, lng, geo_source, ...rest } = p;
        return q((c) => c.from('proofs').insert(rest).select());
      }
    },
    getItems: () => q((c) => c.from('hunter_items').select('*').order('created_at', { ascending: true })),
    addItem: (it) => q((c) => c.from('hunter_items').insert(it).select()),
    updateItem: (id, patch) => q((c) => c.from('hunter_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select()),
    deleteItem: (id) => q((c) => c.from('hunter_items').delete().eq('id', id)),
    deleteProof: (id) => q((c) => c.from('proofs').delete().eq('id', id)),
    async uploadProof(file, taskId) {
      await ready;
      const ext = (file.name && file.name.includes('.') ? file.name.split('.').pop() : (file.type.split('/')[1] || 'bin')).toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = taskId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const { error } = await client.storage.from('proofs').upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (error) throw error;
      const { data } = client.storage.from('proofs').getPublicUrl(path);
      return { url: data.publicUrl, path };
    },
    savePushSubscription: (sub, role) => q((c) => c.from('push_subscriptions').upsert({ endpoint: sub.endpoint, subscription: sub, role })),
    subscribe(handler, onStatus) {
      ready.then(() => {
        const ch = client.channel('last-signal');
        for (const table of ['players', 'locations', 'completions', 'proofs', 'hunter_items']) {
          ch.on('postgres_changes', { event: '*', schema: 'public', table }, (msg) => {
            handler({ table, type: msg.eventType, row: msg.eventType === 'DELETE' ? msg.old : msg.new });
          });
        }
        ch.subscribe((status) => onStatus && onStatus(status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'offline' : 'connecting'));
      });
    },
  };
}

function demoStore() {
  const KEY = 'ls-demo-v1';
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('ls-demo') : null;
  const listeners = [];
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  const db = () => {
    const d = load();
    d.players ||= []; d.locations ||= []; d.completions ||= []; d.proofs ||= []; d.hunter_items ||= []; d.seq ||= 1;
    return d;
  };
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const emit = (ev) => {
    listeners.forEach((h) => h(ev));
    bc && bc.postMessage(ev);
  };
  bc && (bc.onmessage = (e) => listeners.forEach((h) => h(e.data)));
  const put = (table, row, keyField) => {
    const d = db();
    const i = d[table].findIndex((r) => r[keyField] === row[keyField]);
    const type = i >= 0 ? 'UPDATE' : 'INSERT';
    if (i >= 0) d[table][i] = { ...d[table][i], ...row }; else d[table].push(row);
    save(d);
    emit({ table, type, row });
    return [row];
  };
  const fileToDataUrl = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });
  return {
    ready: Promise.resolve(),
    getPlayers: async () => db().players,
    upsertPlayer: async (p) => put('players', { ...p, updated_at: new Date().toISOString() }, 'id'),
    async addLocation(l) {
      const d = db();
      const row = { id: d.seq++, created_at: new Date().toISOString(), ...l };
      d.locations.push(row); save(d); emit({ table: 'locations', type: 'INSERT', row });
      return [row];
    },
    getLocations: async (sinceIso) => db().locations.filter((l) => l.created_at >= sinceIso),
    getCompletions: async () => db().completions,
    setCompletion: async (task_id, done, by) => put('completions', {
      task_id, done, done_by: done ? by : null, done_at: done ? new Date().toISOString() : null,
    }, 'task_id'),
    getProofs: async () => db().proofs,
    async addProof(p) {
      const d = db();
      const row = { id: d.seq++, created_at: new Date().toISOString(), ...p };
      d.proofs.push(row); save(d); emit({ table: 'proofs', type: 'INSERT', row });
      return [row];
    },
    async deleteProof(id) {
      const d = db();
      const row = d.proofs.find((p) => p.id === id);
      d.proofs = d.proofs.filter((p) => p.id !== id); save(d);
      row && emit({ table: 'proofs', type: 'DELETE', row });
    },
    getItems: async () => db().hunter_items,
    async addItem(it) {
      const d = db();
      const row = { id: d.seq++, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...it };
      d.hunter_items.push(row); save(d); emit({ table: 'hunter_items', type: 'INSERT', row });
      return [row];
    },
    async updateItem(id, patch) {
      const d = db();
      const i = d.hunter_items.findIndex((r) => r.id === id); if (i < 0) return [];
      d.hunter_items[i] = { ...d.hunter_items[i], ...patch, updated_at: new Date().toISOString() };
      save(d); emit({ table: 'hunter_items', type: 'UPDATE', row: d.hunter_items[i] });
      return [d.hunter_items[i]];
    },
    async deleteItem(id) {
      const d = db();
      const row = d.hunter_items.find((r) => r.id === id);
      d.hunter_items = d.hunter_items.filter((r) => r.id !== id); save(d);
      row && emit({ table: 'hunter_items', type: 'DELETE', row });
    },
    async uploadProof(file) {
      /* Demo: Videos nicht speichern, localStorage ist zu klein. */
      if (file.type.startsWith('video/')) return { url: '', path: 'demo-video' };
      return { url: await fileToDataUrl(file), path: 'demo' };
    },
    savePushSubscription: async () => {},
    subscribe(handler, onStatus) {
      listeners.push(handler);
      onStatus && onStatus('demo');
    },
  };
}

export const store = DEMO ? demoStore() : supabaseStore();
