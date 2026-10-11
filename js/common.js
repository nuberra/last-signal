/* Gemeinsame Helfer beider Ansichten. */
import { CONFIG } from './config.js';
import { store } from './store.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pad2 = (n) => String(n).padStart(2, '0');

/* Koordinaten immer exakt so: N48.7758 E09.1829 */
export function formatCoordinate(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  const la = Math.abs(lat).toFixed(4).padStart(7, '0');
  const lo = Math.abs(lon).toFixed(4).padStart(7, '0');
  return ns + la + ' ' + ew + lo;
}

/* Grosskreisdistanz in Metern. */
export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const formatDistance = (m) => (m < 1000 ? Math.round(m / 10) * 10 + ' M' : (m / 1000).toFixed(1) + ' KM');

export function timeHM(iso) {
  const d = new Date(iso);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function agoText(iso, now = Date.now()) {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'GERADE EBEN';
  if (min < 60) return 'VOR ' + min + ' MIN';
  const h = Math.floor(min / 60);
  return 'VOR ' + h + ' H ' + pad2(min % 60) + ' MIN';
}

export function playerName(players, id) {
  const p = players.find((x) => x.id === id);
  const slot = CONFIG.BANDITS.find((b) => b.id === id);
  return ((slot && slot.name) || (p && p.name) || (slot && slot.label) || id || '').toUpperCase();
}

export const playerColor = (id) => (CONFIG.BANDITS.find((b) => b.id === id) || {}).color || '#7A7A74';

/* ---- Ton und Vibration ---- */
let audio = null;
export function unlockAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* kein Ton verfügbar */ }
}
export function beep(kind = 'task') {
  try {
    unlockAudio();
    if (!audio) return;
    const seq = kind === 'alarm' ? [880, 660, 880, 660] : [660, 990];
    const step = kind === 'alarm' ? 0.18 : 0.14;
    seq.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'square'; o.frequency.value = f;
      const t0 = audio.currentTime + i * step;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + step * 0.9);
      o.connect(g).connect(audio.destination);
      o.start(t0); o.stop(t0 + step);
    });
  } catch { /* ignorieren */ }
  if (navigator.vibrate) navigator.vibrate(kind === 'alarm' ? [300, 120, 300, 120, 300] : [200, 80, 200]);
}

/* ---- Meldungen ---- */
export function toast(label, text, tone = '') {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast ls-anim-slide ' + tone;
  el.innerHTML = '<div class="label">' + esc(label) + '</div><div class="toast-text">' + esc(text) + '</div>';
  el.onclick = () => el.remove();
  host.prepend(el);
  while (host.children.length > 3) host.lastElementChild.remove();
  setTimeout(() => el.remove(), 7000);
}

/* ---- Bilder vor dem Upload verkleinern (lange Kante 1920 px, JPEG) ---- */
export async function shrinkImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 1920, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/* ---- Service Worker und Push ---- */
export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

export const pushSupported = () => !!(CONFIG.VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);

function b64ToUint8(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function enablePush(role) {
  if (!pushSupported()) throw new Error('PUSH AUF DIESEM GERÄT NICHT VERFÜGBAR');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('MITTEILUNGEN NICHT ERLAUBT');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(CONFIG.VAPID_PUBLIC_KEY) });
  await store.savePushSubscription(sub.toJSON(), role);
  return true;
}

export async function pushActive() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(reg && (await reg.pushManager.getSubscription()));
}

/* Server-Funktion schickt Push an alle Jäger. Schlaegt still fehl ohne Server. */
export function notifyHunters(title, body) {
  if (!CONFIG.VAPID_PUBLIC_KEY) return;
  fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, role: 'detective' }),
    keepalive: true,
  }).catch(() => {});
}

export function statusText(s) {
  return { live: 'LIVE', connecting: 'VERBINDET', offline: 'OFFLINE', demo: 'DEMO-MODUS' }[s] || s.toUpperCase();
}
