/**
 * Sinh ảnh sản phẩm giả định cho media-service: mỗi sản phẩm 2 cỡ (thumb 480 px, large 1200 px) × 2 định dạng (WebP, JPEG).
 * Ảnh có nền chuyển màu, một "sản phẩm" bo góc và lớp nhiễu để dung lượng gần ảnh chụp thật (vài chục KB mỗi thumb).
 * Tất định: chạy lại cho ra đúng từng byte (cùng phiên bản sharp/libvips), nên mọi instance có cùng nội dung và cùng ETag.
 *   pnpm media:seed            → .data/media/ (bỏ qua nếu đã đủ file; FORCE=1 để sinh lại)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { IMAGE_SIZES, productHue, productIds } from '../src/shared/catalog-data';

const OUT = process.env.MEDIA_DIR ?? '.data/media';
const expected = productIds().length * Object.keys(IMAGE_SIZES).length * 2;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function render(id: number, size: number): Buffer {
  const rand = rng(id * 1000 + size);
  const hue = productHue(id);
  const [br, bg, bb] = hsl(hue, 0.35, 0.82);
  const [pr, pg, pb] = hsl((hue + 180) % 360, 0.55, 0.45);
  const raw = Buffer.alloc(size * size * 3);
  const box = { x0: size * 0.22, y0: size * 0.16, x1: size * 0.78, y1: size * 0.84, r: size * 0.08 };
  // Nhiễu theo khối 2×2 px: dung lượng WebP/JPEG gần ảnh chụp sản phẩm (thumb khoảng 24 / 31 KB) thay vì nhiễu từng
  // điểm ảnh (WebP to hơn JPEG, không giống ảnh thật) hay ảnh phẳng (vài KB).
  const half = Math.ceil(size / 2);
  const noiseBlocks = Float64Array.from({ length: half * half }, () => (rand() - 0.5) * 30);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      // khoảng cách tới hình chữ nhật bo góc (âm = bên trong)
      const dx = Math.max(box.x0 + box.r - x, x - (box.x1 - box.r), 0);
      const dy = Math.max(box.y0 + box.r - y, y - (box.y1 - box.r), 0);
      const inside = Math.hypot(dx, dy) <= box.r && x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
      const shade = inside ? 0.75 + 0.35 * (1 - (y - box.y0) / (box.y1 - box.y0)) : 1.05 - 0.25 * t;
      const noise = noiseBlocks[(y >> 1) * half + (x >> 1)]!;
      const i = (y * size + x) * 3;
      const base = inside ? [pr, pg, pb] : [br, bg, bb];
      raw[i] = Math.max(0, Math.min(255, base[0]! * shade + noise));
      raw[i + 1] = Math.max(0, Math.min(255, base[1]! * shade + noise));
      raw[i + 2] = Math.max(0, Math.min(255, base[2]! * shade + noise));
    }
  }
  return raw;
}

mkdirSync(OUT, { recursive: true });
const have = readdirSync(OUT).filter((f) => /^\d+-(thumb|large)\.(webp|jpg)$/.test(f)).length;
if (have === expected && !process.env.FORCE) {
  console.log(`đã có đủ ${have} ảnh trong ${OUT}, bỏ qua (FORCE=1 để sinh lại)`);
  process.exit(0);
}

const started = Date.now();
const bytes = { webp: 0, jpg: 0 };
const digest = createHash('sha256');
for (const id of productIds()) {
  for (const [name, size] of Object.entries(IMAGE_SIZES)) {
    const img = sharp(render(id, size), { raw: { width: size, height: size, channels: 3 } });
    const webp = await img.clone().webp({ quality: 75 }).toBuffer();
    const jpg = await img.clone().jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    writeFileSync(join(OUT, `${id}-${name}.webp`), webp);
    writeFileSync(join(OUT, `${id}-${name}.jpg`), jpg);
    bytes.webp += webp.length;
    bytes.jpg += jpg.length;
    digest.update(webp).update(jpg);
  }
}
if (!existsSync(OUT)) throw new Error('không ghi được thư mục ảnh');
console.log(
  `sinh ${expected} ảnh trong ${((Date.now() - started) / 1000).toFixed(1)} s: WebP ${(bytes.webp / 1024 / 1024).toFixed(1)} MiB, JPEG ${(bytes.jpg / 1024 / 1024).toFixed(1)} MiB, sha256 tổng ${digest.digest('hex').slice(0, 16)}`,
);
