// Phép thử âm: gỡ từng mảnh của pattern bằng công tắc LAB_DRILL (packages/logging/drill.ts, không sửa mã nguồn), dựng lại
// 4 service, chạy ĐÚNG file test kiểm mảnh đó và ghi số test đỏ; rồi khôi phục và chạy lại file đó (phải xanh).
//   no-nested-redact   bỏ đường redact `req.body.payment.card.number`            → (c) no-pii-in-logs đỏ
//   no-err-scrub       serializer của err không quét message/stack (chỉ còn redact) → (c) đỏ: redact không với tới chuỗi tự do
//   no-queue-context   producer không ghi traceparent vào job                    → (b) trace-id-across-queue đỏ
//   console-log-ledger ledger ghi một dòng bằng console.log thay logger          → (a) log-schema đỏ
// Chạy: pnpm bench:negative [--out main] [--only <drill>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { appMode } from './lib/compose.js';
import { machineState, run } from './lib/proc.js';

const { values: args } = parseArgs({ options: { out: { type: 'string', default: 'main' }, only: { type: 'string' } } });
const OUT = `bench/results/${args.out}/negative`;
mkdirSync(OUT, { recursive: true });

const DRILLS = [
  { drill: 'no-nested-redact', file: 'test/no-pii-in-logs.test.ts' },
  { drill: 'no-err-scrub', file: 'test/no-pii-in-logs.test.ts' },
  { drill: 'no-queue-context', file: 'test/trace-id-across-queue.test.ts' },
  { drill: 'console-log-ledger', file: 'test/log-schema.test.ts' },
] as const;

interface VitestJson {
  numPassedTests: number;
  numFailedTests: number;
  testResults: { assertionResults: { title: string; status: string; failureMessages: string[] }[] }[];
}

async function vitest(file: string, tag: string) {
  const out = `${OUT}/${tag}.json`;
  const r = await run('npx', ['vitest', 'run', file, '--reporter=json', `--outputFile=${out}`], { env: { TEST_WAIT_MS: '15000' } });
  const j = JSON.parse(readFileSync(out, 'utf8')) as VitestJson;
  const failed = j.testResults.flatMap((t) => t.assertionResults.filter((a) => a.status === 'failed'));
  return {
    exit: r.code,
    passed: j.numPassedTests,
    failed: j.numFailedTests,
    failedTests: failed.map((a) => ({ title: a.title, why: (a.failureMessages[0] ?? '').split('\n').slice(0, 3).join(' | ').slice(0, 300) })),
  };
}

const results = [];
for (const d of DRILLS.filter((x) => !args.only || x.drill === args.only)) {
  await appMode('sau', d.drill);
  const broken = await vitest(d.file, `${d.drill}-broken`);
  await appMode('sau', '');
  const restored = await vitest(d.file, `${d.drill}-restored`);
  const row = { ...d, broken, restored, red: broken.failed > 0, greenAgain: restored.failed === 0 && restored.exit === 0 };
  results.push(row);
  console.log(JSON.stringify({ drill: d.drill, brokenFailed: broken.failed, brokenTests: broken.failedTests.map((t) => t.title), restoredFailed: restored.failed }));
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify({ machine: await machineState(), results }, null, 2));
