/**
 * Phép thử âm (quy-trinh-lab mục 4): gỡ từng điểm then chốt của pattern trong mã nguồn thật, chạy test,
 * rồi khôi phục. Mỗi chuỗi cần sửa phải xuất hiện đúng một lần (nhật ký 08/01 điểm 4); lượt nào có 0 test
 * thì coi là lỗi của script (nhật ký 03/01 điểm 5). Cuối cùng so lại nội dung mọi file đã chạm.
 * Chạy: RUN=main pnpm bench:drills   (cần db:up)
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAB_DIR, RESULTS_DIR, writeResult } from './lib/env.js';

const HASHER = 'src/sau/password-hasher.ts';
const LOGIN = 'src/sau/login.service.ts';
const MIGRATION = 'src/sau/wrap-legacy-migration.ts';

interface Drill {
  name: string;
  expect: string; // test nào kỳ vọng đỏ (để đọc báo cáo)
  edits: { file: string; from: string; to: string }[];
}

const drills: Drill[] = [
  {
    name: 'salt cố định (dùng chung một salt cho mọi lần băm)',
    expect: 'cùng mật khẩu băm hai lần cho hai chuỗi khác nhau',
    edits: [{ file: HASHER, from: 'parallelism: this.opts.parallelism,', to: 'parallelism: this.opts.parallelism,\n      salt: Buffer.alloc(16, 1),' }],
  },
  {
    name: 'bỏ bước nâng cấp cơ hội (hash cũ không bao giờ lên version 2)',
    expect: 'hash cũ đã bọc (version 1) đăng nhập đúng → hash_version thành 2',
    edits: [{ file: LOGIN, from: '    if (user.hash_version < 2) {', to: '    if (false) {' }],
  },
  {
    name: 'bỏ bộ đếm Redis (không chặn thử online)',
    expect: 'sai 10 lần vẫn trả 401; lần thứ 11 bị chặn 429',
    edits: [{ file: LOGIN, from: "    if (await this.anyBlocked(subjects)) return { kind: 'blocked' };\n", to: '' }],
  },
  {
    name: 'cắt mật khẩu ở 72 byte kiểu bcrypt (băm và verify đều cắt)',
    expect: 'mật khẩu 100 ký tự KHÔNG bị cắt',
    edits: [
      { file: HASHER, from: 'return hash(password, this.argonOptions());', to: 'return hash(password.slice(0, 72), this.argonOptions());' },
      {
        file: HASHER,
        from: 'return await verify(phc, password, this.opts.pepper ? { secret: this.opts.pepper } : {});',
        to: 'return await verify(phc, password.slice(0, 72), this.opts.pepper ? { secret: this.opts.pepper } : {});',
      },
    ],
  },
  {
    name: 'migration KHÔNG xóa MD5 (chỉ thêm password_hash, giữ nguyên password_md5)',
    expect: 'sau wrapLegacyHashes',
    edits: [{ file: MIGRATION, from: 'UPDATE users SET password_hash = v.hash, hash_version = 1, password_md5 = NULL', to: 'UPDATE users SET password_hash = v.hash, hash_version = 1' }],
  },
  {
    name: 'nâng cấp khi đăng nhập KHÔNG xóa MD5 (giữ password_md5 bên cạnh hash mới)',
    expect: 'lên version 2 và xóa MD5',
    edits: [{ file: LOGIN, from: 'set({ password_hash: phc, hash_version: 2, password_md5: null })', to: 'set({ password_hash: phc, hash_version: 2 })' }],
  },
];

interface VitestJson {
  numTotalTests: number;
  numFailedTests: number;
  testResults: { name: string; assertionResults: { fullName: string; status: string; failureMessages: string[] }[] }[];
}

function runTests(tag: string): VitestJson {
  const out = resolve(RESULTS_DIR, 'drills', `${tag}.vitest.json`);
  spawnSync(resolve(LAB_DIR, 'node_modules/.bin/vitest'), ['run', '--reporter=json', `--outputFile=${out}`], { cwd: LAB_DIR, encoding: 'utf8' });
  return JSON.parse(readFileSync(out, 'utf8')) as VitestJson;
}

const originals = new Map<string, string>();
for (const d of drills) for (const e of d.edits) if (!originals.has(e.file)) originals.set(e.file, readFileSync(resolve(LAB_DIR, e.file), 'utf8'));

mkdirSync(resolve(RESULTS_DIR, 'drills'), { recursive: true });
const baseline = runTests('baseline');
console.log(`Không gỡ gì: ${baseline.numFailedTests}/${baseline.numTotalTests} test đỏ`);
if (baseline.numTotalTests === 0 || baseline.numFailedTests > 0) throw new Error('Lượt gốc phải xanh và có test');

const results = [];
try {
  for (const [i, d] of drills.entries()) {
    const files = new Map<string, string>();
    for (const e of d.edits) {
      const text = files.get(e.file) ?? originals.get(e.file)!;
      const n = text.split(e.from).length - 1;
      if (n !== 1) throw new Error(`"${d.name}": chuỗi cần sửa xuất hiện ${n} lần trong ${e.file}`);
      files.set(e.file, text.replace(e.from, e.to));
    }
    for (const [f, text] of files) writeFileSync(resolve(LAB_DIR, f), text);
    try {
      const r = runTests(`drill-${i + 1}`);
      if (r.numTotalTests === 0) throw new Error(`"${d.name}": 0 test (mã nguồn sau khi sửa không chạy được?)`);
      const failed = r.testResults.flatMap((f) =>
        f.assertionResults.filter((a) => a.status === 'failed').map((a) => ({
          file: f.name.replace(`${LAB_DIR}/`, ''), test: a.fullName, message: (a.failureMessages[0] ?? '').split('\n')[0]!.slice(0, 160),
        })),
      );
      const hitExpected = failed.some((f) => f.test.includes(d.expect));
      results.push({ drill: d.name, expect: d.expect, total: r.numTotalTests, failed: r.numFailedTests, hitExpected, failedTests: failed });
      console.log(`\n#${i + 1} ${d.name}: ${r.numFailedTests}/${r.numTotalTests} test đỏ · kỳ vọng "${d.expect}" đỏ: ${hitExpected ? 'CÓ' : 'KHÔNG'}`);
      for (const f of failed) console.log(`   ✗ ${f.test}`);
    } finally {
      for (const f of files.keys()) writeFileSync(resolve(LAB_DIR, f), originals.get(f)!);
    }
  }
} finally {
  for (const [f, text] of originals) writeFileSync(resolve(LAB_DIR, f), text);
}
const dirty = [...originals].filter(([f, text]) => readFileSync(resolve(LAB_DIR, f), 'utf8') !== text).map(([f]) => f);
console.log(dirty.length ? `\n!! File chưa khôi phục: ${dirty.join(', ')}` : '\nĐã khôi phục mọi file (so nội dung: khớp).');
const allHit = results.every((r) => r.hitExpected && r.failed > 0);
console.log(`→ ${writeResult('drills/summary.json', { baseline: { total: baseline.numTotalTests, failed: baseline.numFailedTests }, results, dirty, allHit })}`);
if (dirty.length || !allHit) process.exit(1);
