#!/usr/bin/env node
/**
 * Lint cấu trúc README của từng bài toán theo template trong skill thuc-hanh-pattern.
 * Chạy: node scripts/kiem-tra-readme.mjs [đường-dẫn-bài ...]
 * Thoát mã 1 nếu có lỗi. Cảnh báo không làm thoát lỗi.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR_RE = /^\d{2}-[a-z0-9-]+$/;
const LEVELS = ['🟢', '🟡', '🔴'];
const STATUSES = ['📋', '🔨', '✅'];
const SECTIONS = [
  '## 1. Bài toán thực tế (What)',
  '## 2. Vì sao dùng pattern này (Why)',
  '## 3. Thiết kế hệ thống (How)',
  '## 4. Tech stack và tác động (Impact techstack)',
  '## 5. Kết quả đầu ra và cách đo (Output impact)',
  '## 6. Đánh đổi và khi KHÔNG nên dùng',
  '## 7. Cơ sở tham khảo',
  '## 8. Kế hoạch thực hành',
];

const listDirs = (p) =>
  readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory() && DIR_RE.test(d.name))
    .map((d) => join(p, d.name))
    .sort();

function problemDirs() {
  const args = process.argv.slice(2);
  if (args.length) return args.map((a) => resolve(a));
  return listDirs(ROOT).flatMap((scope) => listDirs(scope));
}

function section(md, index) {
  const start = md.indexOf(SECTIONS[index]);
  if (start < 0) return '';
  const next = index + 1 < SECTIONS.length ? md.indexOf(SECTIONS[index + 1]) : -1;
  return next > start ? md.slice(start, next) : md.slice(start);
}

function check(dir) {
  const errors = [];
  const warns = [];
  const name = basename(dir);
  if (!DIR_RE.test(name)) errors.push(`tên thư mục không đúng quy ước: ${name}`);

  const file = join(dir, 'README.md');
  if (!existsSync(file)) return { errors: ['thiếu README.md'], warns };
  const md = readFileSync(file, 'utf8');

  const h1 = (md.match(/^#\s+(.+)$/m) || [, ''])[1];
  if (!h1) errors.push('thiếu tiêu đề H1');
  else if (!h1.includes(' — ')) errors.push('H1 phải có dạng "<Pattern> — <Triệu chứng>" (gạch dài U+2014)');

  const metaLine = md.split('\n').find((l) => {
    const c = l.split('|').map((s) => s.trim());
    return c.length >= 6 && LEVELS.some((e) => c[2].startsWith(e)) && STATUSES.some((e) => c[3].startsWith(e));
  });
  if (!metaLine) errors.push('thiếu bảng metadata (Scope | Mức độ | Trạng thái | Pattern gốc | Cập nhật) với emoji ở cột 2 và 3');
  else {
    const c = metaLine.split('|').map((s) => s.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c[5])) errors.push(`cột "Cập nhật" phải là YYYY-MM-DD, nhận: "${c[5]}"`);
    if (!c[4]) warns.push('cột "Pattern gốc" trống');
  }

  let lastPos = -1;
  for (const s of SECTIONS) {
    const pos = md.indexOf(s);
    if (pos < 0) errors.push(`thiếu mục "${s}"`);
    else if (pos < lastPos) errors.push(`mục "${s}" sai thứ tự`);
    else lastPos = pos;
  }

  const mermaidBlocks = [...md.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (!mermaidBlocks.some((b) => /^\s*flowchart\b/m.test(b))) errors.push('cần ít nhất một sơ đồ `flowchart`');
  if (!mermaidBlocks.some((b) => /^\s*sequenceDiagram\b/m.test(b))) errors.push('cần ít nhất một `sequenceDiagram`');

  const why = section(md, 1);
  if (why && !/^\|.*\|\s*$/m.test(why)) warns.push('mục 2 nên có bảng "Lựa chọn khác đã cân nhắc"');

  const impact = section(md, 4);
  if (impact && !/Cách đo/.test(impact)) errors.push('mục 5 phải có bảng với cột "Cách đo"');

  const tradeoff = section(md, 5);
  if (tradeoff && !/[Kk]hông nên dùng/.test(tradeoff)) errors.push('mục 6 phải có phần "Không nên dùng khi"');

  const refs = section(md, 6);
  const refLines = refs.split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l));
  if (refLines.length < 2) errors.push(`mục 7 cần ít nhất 2 nguồn (hiện ${refLines.length})`);

  if (!/minh họa/.test(md)) warns.push('không thấy nhãn "minh họa" cho số liệu — kiểm tra lại mục 1 và 5');
  if (/\b(đã giảm|giảm được|đã tăng)\b.*\d+\s*%/.test(md) && !/đã đo/.test(md)) warns.push('có câu kết quả dạng "đã giảm X%" nhưng không có nhãn "đã đo"');

  const lines = md.split('\n').length;
  if (lines > 320) warns.push(`README dài ${lines} dòng (> 320) — cân nhắc rút gọn`);

  return { errors, warns };
}

let totalErrors = 0;
let totalWarns = 0;
let checked = 0;
for (const dir of problemDirs()) {
  const rel = relative(ROOT, dir);
  const { errors, warns } = check(dir);
  checked++;
  totalErrors += errors.length;
  totalWarns += warns.length;
  if (errors.length || warns.length) {
    console.log(`\n${rel}`);
    errors.forEach((e) => console.log(`  ✖ ${e}`));
    warns.forEach((w) => console.log(`  ⚠ ${w}`));
  }
}
console.log(`\nĐã kiểm ${checked} bài · ${totalErrors} lỗi · ${totalWarns} cảnh báo`);
process.exit(totalErrors ? 1 : 0);
