/**
 * Phép thử âm (quy-trinh-lab mục 4): gỡ từng điểm then chốt của pattern trong mã nguồn thật, chạy test, rồi khôi phục.
 * Mỗi chuỗi cần sửa phải xuất hiện đúng một lần (nhật ký 08/01 điểm 4); lượt nào có 0 test thì coi là lỗi của script
 * (nhật ký 03/01 điểm 5). Cuối cùng so lại nội dung mọi file đã chạm.
 * Chạy: RUN=main pnpm bench:drills   (cần PostgreSQL đang chạy; test tự dựng schema lab_test)
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAB_DIR, RESULTS_DIR, writeResult } from './lib/env.js';

interface Drill {
  name: string;
  edits: { file: string; from: string; to: string }[];
  tests: string[];
}

const KEYSET = 'src/sau/transactions-keyset.repository.ts';
const CODEC = 'src/sau/cursor-codec.ts';
const INDEX = 'db/add-keyset-index.sql';
const ALL = ['test/keyset-no-duplicates-under-inserts.test.ts', 'test/keyset-ties-on-created-at.test.ts', 'test/cursor-tampering.test.ts', 'test/keyset-query-plan.test.ts', 'test/web-infinite-list.test.tsx'];

const drills: Drill[] = [
  {
    name: 'bỏ khóa phụ id trong điều kiện seek: created_at < t',
    edits: [{ file: KEYSET, from: "eb(refTuple('created_at', 'id'), '<', tuple(after.createdAt, after.id))", to: "eb('created_at', '<', after.createdAt)" }],
    tests: ALL,
  },
  {
    name: 'cursor mang created_at đã qua Date (mili giây, đệm 000)',
    edits: [{ file: KEYSET, from: '{ createdAt: last.created_at_iso, id: last.id }', to: "{ createdAt: new Date(last.created_at_iso).toISOString().replace('Z', '000Z'), id: last.id }" }],
    tests: ALL,
  },
  {
    name: 'bỏ limit + 1: lấy đúng limit, còn trang sau khi trang đầy',
    edits: [
      { file: KEYSET, from: '.limit(limit + 1)', to: '.limit(limit)' },
      { file: KEYSET, from: 'rows.length > limit && last', to: 'rows.length === limit && last' },
    ],
    tests: ALL,
  },
  {
    name: 'bỏ kiểm chữ ký cursor',
    edits: [{ file: CODEC, from: "if (!sameMac(sign(body), mac)) throw new InvalidCursorError('chữ ký cursor không khớp');", to: '' }],
    tests: ['test/cursor-tampering.test.ts'],
  },
  {
    name: 'bỏ kiểm phiên bản và định dạng cursor',
    edits: [{ file: CODEC, from: "if (!isCurrentFormat(payload)) throw new InvalidCursorError('cursor sai phiên bản hoặc định dạng');", to: '' }],
    tests: ['test/cursor-tampering.test.ts'],
  },
  {
    name: 'không tạo index phức hợp',
    edits: [{ file: INDEX, from: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_merchant_created_id_idx\n  ON transactions (merchant_id, created_at DESC, id DESC)', to: 'SELECT 1' }],
    tests: ['test/keyset-query-plan.test.ts'],
  },
  {
    name: 'index thiếu id: (merchant_id, created_at DESC)',
    edits: [{ file: INDEX, from: '(merchant_id, created_at DESC, id DESC)', to: '(merchant_id, created_at DESC)' }],
    tests: ['test/keyset-query-plan.test.ts'],
  },
  {
    name: 'index lệch chiều: (merchant_id, created_at DESC, id ASC)',
    edits: [{ file: INDEX, from: '(merchant_id, created_at DESC, id DESC)', to: '(merchant_id, created_at DESC, id ASC)' }],
    tests: ['test/keyset-query-plan.test.ts'],
  },
];

interface VitestJson {
  numTotalTests: number;
  numFailedTests: number;
  testResults: { name: string; assertionResults: { fullName: string; status: string; failureMessages: string[] }[] }[];
}

function runTests(files: string[], tag: string): VitestJson {
  const out = resolve(RESULTS_DIR, 'drills', `${tag}.vitest.json`);
  spawnSync(resolve(LAB_DIR, 'node_modules/.bin/vitest'), ['run', ...files, '--reporter=json', `--outputFile=${out}`], { cwd: LAB_DIR, encoding: 'utf8' });
  return JSON.parse(readFileSync(out, 'utf8')) as VitestJson;
}

const originals = new Map<string, string>();
for (const d of drills) for (const e of d.edits) if (!originals.has(e.file)) originals.set(e.file, readFileSync(resolve(LAB_DIR, e.file), 'utf8'));

mkdirSync(resolve(RESULTS_DIR, 'drills'), { recursive: true });
const baseline = runTests(ALL, 'baseline');
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
      const r = runTests(d.tests, `drill-${i + 1}`);
      if (r.numTotalTests === 0) throw new Error(`"${d.name}": 0 test (mã nguồn sau khi sửa không chạy được?)`);
      const failed = r.testResults.flatMap((f) =>
        f.assertionResults.filter((a) => a.status === 'failed').map((a) => ({
          file: f.name.replace(`${LAB_DIR}/`, ''), test: a.fullName, message: (a.failureMessages[0] ?? '').split('\n')[0]!.slice(0, 200),
        })),
      );
      results.push({ drill: d.name, total: r.numTotalTests, failed: r.numFailedTests, failedTests: failed });
      console.log(`\n#${i + 1} ${d.name}: ${r.numFailedTests}/${r.numTotalTests} test đỏ`);
      for (const f of failed) console.log(`   ✗ ${f.file} › ${f.test}\n     ${f.message}`);
    } finally {
      for (const f of files.keys()) writeFileSync(resolve(LAB_DIR, f), originals.get(f)!);
    }
  }
} finally {
  for (const [f, text] of originals) writeFileSync(resolve(LAB_DIR, f), text);
}
const dirty = [...originals].filter(([f, text]) => readFileSync(resolve(LAB_DIR, f), 'utf8') !== text).map(([f]) => f);
console.log(dirty.length ? `\n!! File chưa khôi phục: ${dirty.join(', ')}` : '\nĐã khôi phục mọi file (so nội dung: khớp).');
console.log(`→ ${writeResult('drills/summary.json', { baseline: { total: baseline.numTotalTests, failed: baseline.numFailedTests }, results, dirty })}`);
if (dirty.length) process.exit(1);
