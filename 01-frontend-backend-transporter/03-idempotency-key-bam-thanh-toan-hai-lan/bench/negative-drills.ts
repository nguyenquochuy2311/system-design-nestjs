/**
 * Phép thử âm (quy-trinh-lab mục 4): gỡ từng điểm then chốt của pattern trong mã nguồn thật, chạy test, rồi khôi phục.
 * Mỗi chuỗi cần sửa phải xuất hiện đúng một lần (nhật ký 08/01 điểm 4); lượt nào có 0 test thì coi là lỗi của script
 * (nhật ký 03/01 điểm 5). Drill có `cut: true` chạy thêm bench cắt response (bản sau) trên mã nguồn đã gỡ.
 * Cuối cùng so lại nội dung mọi file đã chạm.
 * Chạy: RUN=main pnpm bench:drills   (cần `pnpm db:up`; DRILL_CUT_N=1000 số ý định cho bench cắt response)
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAB_DIR, RESULTS_DIR, RUN, writeResult } from './lib/env.js';

interface Drill {
  name: string;
  edits: { file: string; from: string; to: string }[];
  cut?: boolean;
}

const SCHEMA = 'db/schema.sql';
const REPO = 'src/sau/idempotency/idempotency.repository.ts';
const INTERCEPTOR = 'src/sau/idempotency/idempotency.interceptor.ts';
const CLIENT = 'src/shared/payment-client.ts';
const CUT_N = process.env.DRILL_CUT_N ?? '1000';

const drills: Drill[] = [
  {
    name: 'bỏ ràng buộc duy nhất (user_id, idempotency_key); INSERT ... ON CONFLICT DO NOTHING không còn gì để đụng',
    edits: [
      { file: SCHEMA, from: 'CONSTRAINT idempotency_keys_pkey PRIMARY KEY (user_id, idempotency_key)', to: 'CONSTRAINT idempotency_keys_pkey CHECK (true)' },
      { file: REPO, from: ".onConflict((oc) => oc.columns(['user_id', 'idempotency_key']).doNothing())", to: '.onConflict((oc) => oc.doNothing())' },
    ],
  },
  {
    name: 'bỏ so dấu vân tay payload',
    edits: [{ file: INTERCEPTOR, from: 'if (row.fingerprint !== fingerprint) {', to: 'if (row.fingerprint !== fingerprint && false) {' }],
  },
  {
    name: 'khóa không gắn người dùng: khóa chính (idempotency_key), tra khóa không lọc user_id',
    edits: [
      { file: SCHEMA, from: 'PRIMARY KEY (user_id, idempotency_key)', to: 'PRIMARY KEY (idempotency_key)' },
      { file: REPO, from: "oc.columns(['user_id', 'idempotency_key'])", to: "oc.column('idempotency_key')" },
      { file: REPO, from: "eb('user_id', '=', userId), ", to: '' },
    ],
  },
  {
    name: 'lưu response ngoài transaction nghiệp vụ (service tự commit, lưu khóa ở câu lệnh sau)',
    edits: [
      {
        file: INTERCEPTOR,
        from: `      const result = await this.db.transaction().execute(async (trx) => {
        const body = await this.tx.run(trx, () => lastValueFrom(next.handle()));
        await this.keys.complete(trx, userId, key, successCode, JSON.stringify(body));
        return body;
      });`,
        to: `      const result = await lastValueFrom(next.handle());
      await this.keys.complete(this.db, userId, key, successCode, JSON.stringify(result));`,
      },
    ],
    cut: true,
  },
  {
    name: 'bỏ 409 khi lần đầu còn processing (request trùng xử lý luôn)',
    edits: [{ file: INTERCEPTOR, from: 'if (!(await this.keys.takeOver(userId, key, this.options.lockTimeoutMs))) throw this.inFlight(res);', to: '' }],
  },
  {
    name: 'không tiếp quản khóa kẹt processing',
    edits: [{ file: REPO, from: 'return r.numUpdatedRows === 1n;', to: 'return false;' }],
  },
  {
    name: 'client sinh khóa mới cho mỗi lần gửi lại',
    edits: [
      {
        file: CLIENT,
        from: 'const key = randomUUID();\n    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {',
        to: 'for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {\n      const key = randomUUID();',
      },
    ],
    cut: true,
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

function runCut(tag: string) {
  const r = spawnSync(resolve(LAB_DIR, 'node_modules/.bin/tsx'), ['bench/run-response-cut.ts'], {
    cwd: LAB_DIR,
    encoding: 'utf8',
    env: { ...process.env, RUN, OUT: `drills/${tag}-cut`, VARIANTS: 'sau', N: CUT_N },
  });
  if (r.status !== 0) throw new Error(`bench cắt response lỗi: ${r.stderr}`);
  const data = JSON.parse(readFileSync(resolve(RESULTS_DIR, 'drills', `${tag}-cut.json`), 'utf8')) as { variants: Record<string, unknown>[]; sleepGaps: unknown[] };
  const { intents, payments, excessPayments, replayed, finalStatus } = data.variants[0]!;
  return { intents, payments, excessPayments, replayed, finalStatus, sleepGaps: data.sleepGaps.length };
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
          file: f.name.replace(`${LAB_DIR}/`, ''), test: a.fullName, message: (a.failureMessages[0] ?? '').split('\n')[0]!.slice(0, 200),
        })),
      );
      const cut = d.cut ? runCut(`drill-${i + 1}`) : undefined;
      results.push({ drill: d.name, total: r.numTotalTests, failed: r.numFailedTests, failedTests: failed, cut });
      console.log(`\n#${i + 1} ${d.name}: ${r.numFailedTests}/${r.numTotalTests} test đỏ`);
      for (const f of failed) console.log(`   ✗ ${f.file} › ${f.test}\n     ${f.message}`);
      if (cut) console.log(`   bench cắt response (bản sau): ${JSON.stringify(cut)}`);
    } finally {
      for (const f of files.keys()) writeFileSync(resolve(LAB_DIR, f), originals.get(f)!);
    }
  }
} finally {
  for (const [f, text] of originals) writeFileSync(resolve(LAB_DIR, f), text);
}
const dirty = [...originals].filter(([f, text]) => readFileSync(resolve(LAB_DIR, f), 'utf8') !== text).map(([f]) => f);
console.log(dirty.length ? `\n!! File chưa khôi phục: ${dirty.join(', ')}` : '\nĐã khôi phục mọi file (so nội dung: khớp).');
console.log(`→ ${writeResult('drills/summary.json', { baseline: { total: baseline.numTotalTests, failed: baseline.numFailedTests }, cutN: Number(CUT_N), results, dirty })}`);
if (dirty.length) process.exit(1);
