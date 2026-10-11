/* Liest die GPS-Position aus den EXIF-Daten eines JPEG-Fotos.
   Gibt { lat, lng } oder null zurueck. Kein externes Paket. */
export async function exifGps(file) {
  try {
    if (!file || !/jpe?g/i.test(file.type || file.name || '')) return null;
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      if ((marker & 0xFF00) !== 0xFF00) return null;
      off += 2 + size;
    }
  } catch { /* defekte Datei */ }
  return null;
}

function parseTiff(v, start) {
  const little = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, little);
  const u32 = (o) => v.getUint32(start + o, little);
  const ifd0 = u32(4);
  let gpsOff = 0;
  for (let i = 0, n = u16(ifd0); i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === 0x8825) gpsOff = u32(e + 8);
  }
  if (!gpsOff) return null;
  const tags = {};
  for (let i = 0, n = u16(gpsOff); i < n; i++) {
    const e = gpsOff + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    if (type === 2) tags[tag] = String.fromCharCode(v.getUint8(start + e + 8));
    else if (type === 5 && count === 3) {
      const p = u32(e + 8);
      const r = (k) => u32(p + k * 8) / (u32(p + k * 8 + 4) || 1);
      tags[tag] = r(0) + r(1) / 60 + r(2) / 3600;
    }
  }
  if (typeof tags[2] !== 'number' || typeof tags[4] !== 'number') return null;
  const lat = tags[2] * (tags[1] === 'S' ? -1 : 1);
  const lng = tags[4] * (tags[3] === 'W' ? -1 : 1);
  if (!lat && !lng) return null;
  return { lat, lng };
}
