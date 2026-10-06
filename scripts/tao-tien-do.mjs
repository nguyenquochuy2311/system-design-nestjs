#!/usr/bin/env node
/**
 * Quét README của từng bài toán và sinh TIEN-DO.md ở gốc repo.
 * Chạy: node scripts/tao-tien-do.mjs
 *
 * Nhận diện bài toán: thư mục `NN-<scope>/NN-<bai>/README.md` có bảng metadata
 * `| Scope | Mức độ | Trạng thái | Pattern gốc | Cập nhật |` với emoji ở cột 2 và 3.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR_RE = /^\d{2}-[a-z0-9-]+$/;
const LEVELS = ['🟢', '🟡', '🔴'];
const STATUSES = ['📋', '🔨', '✅'];

const listDirs = (p) =>
  readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory() && DIR_RE.test(d.name))
    .map((d) => join(p, d.name))
    .sort();

const h1Of = (md) => (md.match(/^#\s+(.+)$/m) || [, ''])[1].trim();

/** Trả về {level, status, updated} hoặc null nếu không có dòng metadata hợp lệ. */
function parseMeta(md) {
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((s) => s.trim());
    if (cells.length < 6) continue;
    const [, scope, level, status, pattern, updated] = cells;
    if (LEVELS.some((e) => level.startsWith(e)) && STATUSES.some((e) => status.startsWith(e))) {
      return { scope, level, status, pattern, updated };
    }
  }
  return null;
}

const scopes = [];
const warnings = [];

for (const scopeDir of listDirs(ROOT)) {
  const scopeReadme = join(scopeDir, 'README.md');
  const scopeTitle = existsSync(scopeReadme) ? h1Of(readFileSync(scopeReadme, 'utf8')) : basename(scopeDir);
  const problems = [];
  for (const probDir of listDirs(scopeDir)) {
    const file = join(probDir, 'README.md');
    if (!existsSync(file)) {
      warnings.push(`${basename(scopeDir)}/${basename(probDir)}: thiếu README.md`);
      continue;
    }
    const md = readFileSync(file, 'utf8');
    const meta = parseMeta(md);
    if (!meta) {
      warnings.push(`${basename(scopeDir)}/${basename(probDir)}: không tìm thấy bảng metadata hợp lệ`);
      continue;
    }
    problems.push({ dir: basename(probDir), title: h1Of(md), ...meta });
  }
  scopes.push({ dir: basename(scopeDir), title: scopeTitle, problems });
}

const count = (list, emoji) => list.filter((p) => p.status.startsWith(emoji)).length;
const all = scopes.flatMap((s) => s.problems);
const today = new Date().toISOString().slice(0, 10);

let out = `# Tiến độ thực hành\n\n`;
out += `> Sinh tự động bởi \`node scripts/tao-tien-do.mjs\` ngày ${today}. **Không sửa tay** — sửa README của bài rồi chạy lại script.\n\n`;
out += `## Tổng quan\n\n| Tổng số bài | 📋 Kế hoạch | 🔨 Đang làm | ✅ Hoàn thành |\n|---|---|---|---|\n`;
out += `| ${all.length} | ${count(all, '📋')} | ${count(all, '🔨')} | ${count(all, '✅')} |\n\n`;

out += `## Theo scope\n\n| Scope | Số bài | 🟢 | 🟡 | 🔴 | 📋 | 🔨 | ✅ |\n|---|---|---|---|---|---|---|---|\n`;
for (const s of scopes) {
  const lv = (e) => s.problems.filter((p) => p.level.startsWith(e)).length;
  out += `| [${s.title}](./${s.dir}/) | ${s.problems.length} | ${lv('🟢')} | ${lv('🟡')} | ${lv('🔴')} | ${count(s.problems, '📋')} | ${count(s.problems, '🔨')} | ${count(s.problems, '✅')} |\n`;
}

out += `\n## Chi tiết\n`;
for (const s of scopes) {
  out += `\n### ${s.title}\n\n`;
  if (s.problems.length === 0) {
    out += `_Chưa có bài toán._\n`;
    continue;
  }
  out += `| Bài | Mức | Trạng thái | Cập nhật |\n|---|---|---|---|\n`;
  for (const p of s.problems) {
    out += `| [${p.title}](./${s.dir}/${p.dir}/) | ${p.level} | ${p.status} | ${p.updated} |\n`;
  }
}

if (warnings.length) {
  out += `\n## Cảnh báo\n\n` + warnings.map((w) => `- ${w}`).join('\n') + '\n';
}

writeFileSync(join(ROOT, 'TIEN-DO.md'), out);
console.log(`TIEN-DO.md: ${all.length} bài · 📋 ${count(all, '📋')} · 🔨 ${count(all, '🔨')} · ✅ ${count(all, '✅')}` + (warnings.length ? ` · ${warnings.length} cảnh báo` : ''));
for (const w of warnings) console.warn('  ! ' + w);
