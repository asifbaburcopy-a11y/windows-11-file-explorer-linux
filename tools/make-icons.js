#!/usr/bin/env node
/*
 * make-icons.js — generates app/assets/icon-{64,128,256}.png (a Windows-11
 * style folder glyph) using only Node built-ins (zlib + manual PNG chunks).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function drawIcon(size) {
  const img = Buffer.alloc(size * size * 4);
  const px = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const al = a / 255;
    img[i] = Math.round(img[i] * (1 - al) + r * al);
    img[i + 1] = Math.round(img[i + 1] * (1 - al) + g * al);
    img[i + 2] = Math.round(img[i + 2] * (1 - al) + b * al);
    img[i + 3] = Math.max(img[i + 3], Math.round(255 * al));
  };
  const roundRect = (x0, y0, x1, y1, rad, r, g, b) => {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        const dx = Math.max(x0 + rad - x, x - (x1 - rad), 0);
        const dy = Math.max(y0 + rad - y, y - (y1 - rad), 0);
        if (dx * dx + dy * dy <= rad * rad) px(x, y, r, g, b, 255);
      }
    }
  };
  const s = size;
  const back = [0xE8, 0xB2, 0x3C];
  const front = [0xFF, 0xD3, 0x5C];
  const edge = [0xC8, 0x94, 0x2A];
  /* back tab */
  roundRect(0.08 * s, 0.16 * s, 0.55 * s, 0.36 * s, 0.05 * s, ...back);
  /* back body */
  roundRect(0.08 * s, 0.26 * s, 0.92 * s, 0.86 * s, 0.06 * s, ...back);
  /* front body */
  roundRect(0.08 * s, 0.40 * s, 0.92 * s, 0.86 * s, 0.06 * s, ...front);
  /* front top edge line */
  for (let x = Math.round(0.08 * s); x <= Math.round(0.92 * s); x++) px(x, Math.round(0.40 * s), ...edge.concat([255]));
  /* subtle highlight */
  for (let x = Math.round(0.14 * s); x <= Math.round(0.86 * s); x++) {
    px(x, Math.round(0.46 * s), 0xFF, 0xE4, 0x92, 180);
  }
  return img;
}

const outDir = path.join(__dirname, '..', 'app', 'assets');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 64, 128, 256]) {
  const file = path.join(outDir, 'icon-' + size + '.png');
  fs.writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log('wrote', file);
}
