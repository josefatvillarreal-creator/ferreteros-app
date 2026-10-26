// Genera los iconos PNG de la PWA sin dependencias externas (encoder propio con
// zlib). Icono: fondo oscuro de marca con una flecha de navegación en acento.
//   node scripts/gen-icons.mjs
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filtro None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function icon(size) {
  const bg = [0x0f, 0x16, 0x20];
  const fg = [0xff, 0x6b, 0x35];
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = bg[0];
    buf[i * 4 + 1] = bg[1];
    buf[i * 4 + 2] = bg[2];
    buf[i * 4 + 3] = 255;
  }
  // Flecha de navegación (arrowhead cóncavo): dos triángulos.
  const cx = size / 2;
  const s = size * 0.3;
  const apex = [cx, cx - s * 1.1];
  const bl = [cx - s * 0.85, cx + s * 0.9];
  const notch = [cx, cx + s * 0.35];
  const br = [cx + s * 0.85, cx + s * 0.9];
  const tris = [
    [apex, bl, notch],
    [apex, notch, br],
  ];
  const sign = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
  const inTri = (p, a, b, c) => {
    const d1 = sign(p, a, b),
      d2 = sign(p, b, c),
      d3 = sign(p, c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = [x + 0.5, y + 0.5];
      if (tris.some((t) => inTri(p, t[0], t[1], t[2]))) {
        const i = (y * size + x) * 4;
        buf[i] = fg[0];
        buf[i + 1] = fg[1];
        buf[i + 2] = fg[2];
        buf[i + 3] = 255;
      }
    }
  }
  return png(size, size, buf);
}

const outDir = fileURLToPath(new URL("../public/", import.meta.url));
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + "icon-192.png", icon(192));
writeFileSync(outDir + "icon-512.png", icon(512));
writeFileSync(outDir + "apple-touch-icon.png", icon(180));
console.log("Iconos generados en public/: icon-192.png, icon-512.png, apple-touch-icon.png");
