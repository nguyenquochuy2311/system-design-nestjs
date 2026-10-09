import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAB, machine, parseEnvFile, sh, sha256, type ShResult } from './lib/run';

// Phép thử âm: gỡ từng phần của pattern và xác nhận test/script đổi kết quả; sau mỗi phép thử khôi phục file và so
// sha256 với bản gốc. Ghi bench/results/<tên lượt>/negative.json. Dùng compose chính của lab (down -v / up giữa các phép).
const outDir = join(LAB, 'bench/results', process.argv[2] ?? 'main');
mkdirSync(outDir, { recursive: true });
const env = parseEnvFile(join(LAB, '.env'));

const failedTests = (r: ShResult) => [...new Set([...r.out.matchAll(/FAIL\s+(test\/\S+ > .+?)\s*$/gm)].map((m) => m[1]!.trim()))];
const summaryLine = (r: ShResult) => r.out.split('\n').filter((l) => /Tests\s+\d/.test(l)).map((l) => l.trim());
const freshDb = () => {
  const r = sh('docker compose down -v && docker compose up -d --wait');
  if (r.code !== 0) throw new Error(r.out);
};

/** Sửa một file, chạy fn, khôi phục khớp byte. */
function withEdit<T>(file: string, edit: (s: string) => string, fn: () => T): T {
  const path = join(LAB, file);
  const original = readFileSync(path, 'utf8');
  const hash = sha256(path);
  const changed = edit(original);
  if (changed === original) throw new Error(`Sửa ${file} không có tác dụng`);
  writeFileSync(path, changed);
  try {
    return fn();
  } finally {
    writeFileSync(path, original);
    const ok = sha256(path) === hash;
    if (!ok) throw new Error(`Khôi phục ${file} không khớp byte`);
  }
}

const drills: Record<string, unknown>[] = [];
const record = (d: Record<string, unknown>) => {
  drills.push(d);
  console.log(`${d.expectedRed === d.red ? '✔' : '✖'} ${d.name}: ${d.red ? 'ĐỎ' : 'xanh'} · ${JSON.stringify(d.evidence).slice(0, 220)}`);
};

// 1. Init script cấp CREATE trên public cho role app → (a) phải đỏ.
{
  const r = withEdit('infra/postgres-init/app-privileges.psql', (s) => `${s}\n-- PHÉP THỬ ÂM\nGRANT CREATE ON SCHEMA public TO app_user;\n`, () => {
    freshDb();
    const t = sh('pnpm -s exec vitest run test/app-role-permissions.test.ts');
    return { code: t.code, failed: failedTests(t), summary: summaryLine(t) };
  });
  record({ name: '1. GRANT CREATE ON SCHEMA public TO app_user trong init → (a)', expectedRed: true, red: r.code !== 0, evidence: r });
}

// 2. Migration chạy bằng role app (cấu hình kiểu cũ: một chuỗi kết nối cho mọi thứ) → (b) phải đỏ.
{
  freshDb();
  const t = sh('pnpm -s exec vitest run test/migration-owner.test.ts', { env: { TEST_MIGRATION_DATABASE_URL: env.TEST_DATABASE_URL } });
  const msg = /permission denied for schema public/.test(t.out);
  record({ name: '2. TEST_MIGRATION_DATABASE_URL trỏ role app → (b)', expectedRed: true, red: t.code !== 0, evidence: { code: t.code, permissionDeniedInOutput: msg, failed: failedTests(t), summary: summaryLine(t) } });
}

// 3. Đổi tag postgres trong compose.yaml (16.15 → 16.14, giữ digest) → (c) phải đỏ; script thoát 1 nêu dịch vụ và tag.
{
  const r = withEdit('compose.yaml', (s) => s.replace('image: postgres:16.15@', 'image: postgres:16.14@'), () => {
    const script = sh('pnpm -s check:versions');
    const t = sh('pnpm -s exec vitest run test/version-drift.test.ts');
    return { scriptCode: script.code, scriptOut: script.out.trim().split('\n'), code: t.code, failed: failedTests(t), summary: summaryLine(t) };
  });
  record({ name: '3. compose.yaml đổi tag postgres:16.15 → 16.14 → (c)', expectedRed: true, red: r.code !== 0 && r.scriptCode === 1, evidence: r });
}

// 4. Bỏ ghim: postgres:16 (tag trôi, không digest) → script phải bắt được.
{
  const r = withEdit('compose.yaml', (s) => s.replace(/image: postgres:\S+/, 'image: postgres:16'), () => {
    const script = sh('pnpm -s check:versions');
    const t = sh('pnpm -s exec vitest run test/version-drift.test.ts');
    return { scriptCode: script.code, scriptOut: script.out.trim().split('\n'), code: t.code, failed: failedTests(t), summary: summaryLine(t) };
  });
  record({ name: '4. compose.yaml dùng postgres:16 (trôi) → script kiểm lệch', expectedRed: true, red: r.scriptCode === 1, evidence: r });
}

// Đối chứng: file đã khôi phục, DB sạch, cả bộ test xanh.
freshDb();
const control = sh('pnpm -s test');
record({ name: 'đối chứng: khôi phục, DB sạch, pnpm test', expectedRed: false, red: control.code !== 0, evidence: { code: control.code, summary: summaryLine(control) } });

writeFileSync(join(outDir, 'negative.json'), JSON.stringify({ machine: machine(), drills }, null, 2));
const bad = drills.filter((d) => d.expectedRed !== d.red).length;
console.log(bad ? `✖ ${bad} phép thử không như kỳ vọng` : `✔ ${drills.length}/${drills.length} đúng kỳ vọng`);
process.exit(bad ? 1 : 0);
