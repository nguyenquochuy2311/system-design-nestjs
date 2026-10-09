#!/usr/bin/env node
/**
 * Kiểm chứng độc lập một bài lab trước khi commit (quy-trinh-lab.md mục 8), gom các bước lặp lại:
 *   máy thức? → down -v → xóa node_modules, .data, bản build → install --frozen-lockfile → up --wait
 *   → [db:seed] → typecheck → test → down -v → kiểm cổng + file cấm sắp commit.
 * Chạy: node scripts/kiem-chung-lab.mjs <thư-mục-bài> [--seed] [--keep-up] [--skip-install]
 *   --seed       chạy `pnpm db:seed` (hoặc db:migrate nếu có) trước test, cho bài mà test cần dữ liệu seed
 *   --keep-up    giữ container sau khi test (để tự kiểm đầu cuối / phép thử âm), nhớ `docker compose down -v` sau
 * Không thay "Cách chạy" của README: bài có bước riêng thì vẫn làm theo README.
 */
import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('Cần đường dẫn thư mục bài.'); process.exit(2); }
const LAB = resolve(dir);
const flag = (f) => args.includes(f);
const pkg = JSON.parse(readFileSync(join(LAB, 'package.json'), 'utf8'));
const scripts = pkg.scripts ?? {};
const hasCompose = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'].some((f) => existsSync(join(LAB, f)));
const results = [];
let envCreated = false; // đặt ở bước 2, finish() dọn lại
const t0 = Date.now();

// Không dùng login shell (`zsh -l`): ~/.zprofile chạy `brew shellenv` đưa node của Homebrew (khác bản Node 20 của repo) lên
// đầu PATH. Đặt thư mục của node đang chạy script lên đầu PATH để pnpm, tsx, vitest đều chạy đúng phiên bản này.
const ENV = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}` };
const sh = (cmd, opts = {}) => spawnSync('/bin/zsh', ['-c', cmd], { cwd: LAB, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
function step(name, cmd, { allowFail = false, show = 6 } = {}) {
  const s = Date.now();
  const r = sh(cmd);
  const ok = r.status === 0;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n');
  results.push({ name, ok, seconds: ((Date.now() - s) / 1000).toFixed(1) });
  console.log(`${ok ? '✔' : allowFail ? '•' : '✖'} ${name} (${((Date.now() - s) / 1000).toFixed(1)} s)`);
  const tail = out.filter((l) => /Tests? |Test Files|✗|×|error|Error|FAIL|Healthy|sạch/.test(l)).slice(-show);
  for (const l of (tail.length ? tail : out.slice(-Math.min(show, 3)))) console.log(`    ${l.slice(0, 200)}`);
  if (!ok && !allowFail) { finish(1); }
  return r;
}
function finish(code) {
  if (envCreated && !flag('--keep-up')) rmSync(join(LAB, '.env'), { force: true });
  console.log(`\nTổng ${((Date.now() - t0) / 1000).toFixed(0)} s · ${results.filter((r) => r.ok).length}/${results.length} bước đạt`);
  process.exit(code);
}

// 1. Máy phải thức (quy-trinh-lab mục 1 điểm 5): chỉ cảnh báo, không chặn.
const batt = sh('pmset -g batt | head -1').stdout.trim();
const lid = sh("ioreg -r -k AppleClamshellState -d 4 | grep -m1 AppleClamshellState").stdout.trim();
console.log(`Nguồn: ${batt.replace("Now drawing from ", '')} · nắp gập: ${/Yes/.test(lid) ? 'CÓ (máy sẽ ngủ!)' : 'không'}`);
const nodeV = sh('node -v').stdout.trim();
const pnpmV = sh('pnpm -v').stdout.trim();
console.log(`Node ${nodeV} · pnpm ${pnpmV}${pkg.engines?.node ? ` · engines.node của bài: ${pkg.engines.node}` : ''}`);
if (!nodeV.startsWith('v20.')) console.log('• Repo dùng Node 20 (CLAUDE.md); chạy script bằng node 20, vd `nvm use 20`.');

// 2. Dọn trạng thái cũ, cài lại từ lockfile, dựng dịch vụ.
// Bài có `.env.example` mà chưa có `.env` (bản clone sạch): chép như bước đầu của "Cách chạy", xóa lại khi kết thúc
// (giữ lại nếu --keep-up, vì container còn chạy cần nó).
envCreated = existsSync(join(LAB, '.env.example')) && !existsSync(join(LAB, '.env'));
if (envCreated) { copyFileSync(join(LAB, '.env.example'), join(LAB, '.env')); console.log('• Chép .env.example → .env (xóa khi xong, trừ --keep-up)'); }
if (hasCompose) step('docker compose down -v', 'docker compose down -v', { allowFail: true, show: 1 });
rmSync(join(LAB, 'node_modules'), { recursive: true, force: true });
if (existsSync(join(LAB, '.data'))) rmSync(join(LAB, '.data'), { recursive: true, force: true }); // chỉ xóa SAU down -v
// Bản build cũ (bỏ qua bởi .gitignore): xóa để test dựng lại từ mã nguồn, không dùng lại bản build của agent.
for (const base of ['.', 'web']) {
  if (!existsSync(join(LAB, base))) continue;
  for (const d of readdirSync(join(LAB, base))) if (d === 'dist' || d.startsWith('.next')) rmSync(join(LAB, base, d), { recursive: true, force: true });
}
if (!flag('--skip-install')) step('pnpm install --frozen-lockfile', 'pnpm install --frozen-lockfile', { show: 1 });
if (hasCompose) step('docker compose up -d --wait', 'docker compose up -d --wait', { show: 4 });
if (flag('--seed')) {
  if (scripts['db:seed']) step('pnpm db:seed', 'pnpm -s db:seed', { show: 2 });
  if (scripts['db:migrate']) step('pnpm db:migrate', 'pnpm -s db:migrate', { show: 2 });
}
if (scripts.typecheck) step('pnpm typecheck', 'pnpm -s typecheck && echo sạch', { show: 2 });
if (scripts.lint) step('pnpm lint', 'pnpm -s lint && echo sạch', { show: 2, allowFail: false });
step('pnpm test', 'pnpm -s test', { show: 4 });

// 3. Dọn dẹp (trừ khi --keep-up) và kiểm cổng của bảng cổng lab.
if (hasCompose && !flag('--keep-up')) step('docker compose down -v', 'docker compose down -v', { allowFail: true, show: 1 });
const ports = '3100|3101|3102|3103|3200|5173|53000|53100|54317|54318|55432|55433|56379|56432|56433|58088|58401|58474|58500|59000|59090|59187';
const busy = sh(`lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk '$9 ~ /:(${ports})$/ {print $1" "$9}' | sort -u`).stdout.trim();
console.log(busy ? `• Cổng lab còn bận:\n    ${busy.split('\n').join('\n    ')}` : '✔ Cổng lab trống');

// 4. File không được commit (node_modules, kết quả thô, build, .env) trong thư mục bài.
const rel = relative(ROOT, LAB);
const untracked = execSync(`git -C "${ROOT}" status --short -uall -- "${rel}"`, { encoding: 'utf8' });
const bad = untracked.split('\n').filter((l) => /node_modules|bench\/results|\/\.data\/|\/\.next\/|\/dist\/|coverage\/|\.env$/.test(l));
console.log(bad.length ? `✖ File cấm sẽ lọt vào commit:\n    ${bad.slice(0, 5).join('\n    ')}` : '✔ Không có file cấm (node_modules, bench/results, .data, .next, dist, coverage, .env)');
finish(bad.length ? 1 : 0);
