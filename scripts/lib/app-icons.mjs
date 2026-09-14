import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type); const length = Buffer.alloc(4); const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function icon(size) {
  const bytes = Buffer.alloc((size * 4 + 1) * size);
  const ellipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size * 256; const py = y / size * 256;
    let color = [255, 253, 245];
    if (ellipse(px, py, 128, 139, 75, 83)) color = [126, 181, 162];
    if (ellipse(px, py, 62, 155, 19, 38) || ellipse(px, py, 194, 155, 19, 38)) color = [94, 150, 132];
    if (ellipse(px, py, 99, 118, 29, 35) || ellipse(px, py, 157, 118, 29, 35)) color = [255, 245, 222];
    if (ellipse(px, py, 103, 120, 11, 13) || ellipse(px, py, 153, 120, 11, 13)) color = [51, 82, 68];
    if (ellipse(px, py, 106, 116, 3.5, 4) || ellipse(px, py, 156, 116, 3.5, 4)) color = [255, 255, 255];
    if (py > 141 && py < 159 && Math.abs(px - 128) < (159 - py) * 0.65) color = [233, 174, 81];
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    bytes[offset] = color[0]; bytes[offset + 1] = color[1]; bytes[offset + 2] = color[2]; bytes[offset + 3] = 255;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
}
export async function writeAppIcons(directory) {
  await mkdir(directory, { recursive: true });
  await Promise.all([192, 512].map((size) => writeFile(join(directory, `app-${size}.png`), icon(size))));
}
