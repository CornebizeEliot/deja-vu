// Génère les icônes sans dépendance : le chapelet (juzu) de Gyomei autour du tampon 済.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const S = 4; // suréchantillonnage pour des bords lisses
  const beads = 14, R = 0.30, br = 0.062;
  const bg1 = [33, 30, 24], bg2 = [18, 16, 13];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S) / size - 0.5, v = (y + (sy + 0.5) / S) / size - 0.5;
        let col = mix(bg1, bg2, Math.min(1, Math.hypot(u, v) * 1.6));
        // fil du chapelet
        if (Math.abs(Math.hypot(u, v) - R) < 0.008) col = [120, 104, 82];
        // perles
        for (let i = 0; i < beads; i++) {
          const a = (i / beads) * Math.PI * 2 - Math.PI / 2;
          const cx = Math.cos(a) * R, cy = Math.sin(a) * R;
          const d = Math.hypot(u - cx, v - cy);
          const big = i === 0 ? 1.35 : 1;
          if (d < br * big) {
            const l = Math.max(0, 1 - Math.hypot(u - cx + 0.02, v - cy + 0.02) / (br * big * 1.2));
            col = mix(i === 0 ? [176, 140, 90] : [112, 100, 86], [235, 225, 205], l * 0.55);
          }
        }
        // tampon rouge au centre
        const m = 0.13, bw = 0.022;
        const inSq = Math.abs(u) < m && Math.abs(v) < m, inInner = Math.abs(u) < m - bw && Math.abs(v) < m - bw;
        if (inSq && !inInner) col = [208, 49, 45];
        if (inInner) {
          // trois barres stylisées : « tampon » sans police
          const bar = (Math.abs(v + 0.05) < 0.014 || Math.abs(v) < 0.014 || Math.abs(v - 0.05) < 0.014) && Math.abs(u) < 0.07;
          const stem = Math.abs(u) < 0.014 && Math.abs(v) < 0.085;
          if (bar || stem) col = [208, 49, 45];
        }
        acc = acc.map((s, k) => s + col[k]);
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = acc[0] / (S * S); raw[o + 1] = acc[1] / (S * S); raw[o + 2] = acc[2] / (S * S); raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
writeFileSync('public/icon-192.png', png(192));
writeFileSync('public/icon-512.png', png(512));
const beadsSvg = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 - Math.PI / 2;
  return `<circle cx="${(50 + Math.cos(a) * 30).toFixed(1)}" cy="${(50 + Math.sin(a) * 30).toFixed(1)}" r="${i === 0 ? 8.4 : 6.2}" fill="${i === 0 ? '#b08c5a' : '#706456'}"/>`;
}).join('');
writeFileSync('public/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#1d1a15"/><circle cx="50" cy="50" r="30" fill="none" stroke="#786852" stroke-width="1.6"/>${beadsSvg}<rect x="37" y="37" width="26" height="26" rx="3" fill="none" stroke="#d0312d" stroke-width="4"/><text x="50" y="57.5" font-size="19" font-weight="900" text-anchor="middle" fill="#d0312d" font-family="serif">済</text></svg>`);
console.log('icons ok');
