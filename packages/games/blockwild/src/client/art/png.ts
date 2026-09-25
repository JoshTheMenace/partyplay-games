/** Minimal PNG encoder (RGBA, stored deflate). Pure, so icons work in the browser, workers and Node tests alike. */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

class Bytes {
  private parts: number[] = [];
  u8(...values: number[]) { this.parts.push(...values.map(v => v & 255)); return this; }
  u32(v: number) { return this.u8(v >>> 24, v >>> 16, v >>> 8, v); }
  raw(bytes: Uint8Array) { for (const b of bytes) this.parts.push(b); return this; }
  done() { return Uint8Array.from(this.parts); }
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const rows = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const z = new Bytes().u8(0x78, 0x01);
  let a = 1, b = 0;
  for (const byte of rows) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  for (let at = 0; at < rows.length || at === 0; at += 65535) {
    const block = rows.subarray(at, at + 65535), last = at + 65535 >= rows.length;
    z.u8(last ? 1 : 0, block.length, block.length >> 8, ~block.length, ~block.length >> 8).raw(block);
  }
  const zlib = z.u32(((b << 16) | a) >>> 0).done();
  const out = new Bytes().u8(137, 80, 78, 71, 13, 10, 26, 10);
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Bytes().u8(...[...type].map(ch => ch.charCodeAt(0))).raw(data).done();
    out.u32(data.length).raw(body).u32(crc32(body));
  };
  chunk('IHDR', new Bytes().u32(width).u32(height).u8(8, 6, 0, 0, 0).done());
  chunk('IDAT', zlib);
  chunk('IEND', new Uint8Array(0));
  return out.done();
}

export function pngDataUrl(width: number, height: number, rgba: Uint8Array): string {
  const png = encodePng(width, height, rgba);
  let binary = '';
  for (let i = 0; i < png.length; i += 8192) binary += String.fromCharCode(...png.subarray(i, i + 8192));
  return `data:image/png;base64,${btoa(binary)}`;
}
