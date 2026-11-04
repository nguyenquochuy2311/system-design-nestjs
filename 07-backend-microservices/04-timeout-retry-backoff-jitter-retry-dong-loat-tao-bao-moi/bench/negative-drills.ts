/**
 * Phép thử âm: gỡ từng phần của pattern bằng cách sửa mã nguồn thật, chạy đúng test bảo vệ phần đó, rồi khôi phục.
 * Mỗi chuỗi cần sửa phải xuất hiện đúng một lần. Test phải xanh trước khi sửa, và có test đỏ sau khi sửa.
 *   RUN=main pnpm bench:drills     # không cần Docker; kết quả: bench/results/<RUN>/drills.json
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Drill {
  name: string;
  file: string;
  from: string;
  to: string;
  tests: string;
}

const CLIENT = 'src/wallet/bank.client.ts';

const DRILLS: Drill[] = [
  {
    name: 'Bỏ Idempotency-Key: retry tạo giao dịch trùng',
    file: CLIENT,
    from: '            idempotencyKey: command.topupId,\n',
    to: '',
    tests: 'test/same-key-one-transaction.test.ts',
  },
  {
    name: 'Mỗi lần retry sinh key mới',
    file: CLIENT,
    from: '            idempotencyKey: command.topupId,\n',
    to: '            idempotencyKey: crypto.randomUUID(),\n',
    tests: 'test/same-key-one-transaction.test.ts',
  },
  {
    name: 'Retry cả lỗi xác định',
    file: 'src/wallet/error-classifier.ts',
    from: "    return error.status === 429 && error.retryAfterMs !== undefined ? 'rate_limited' : undefined;\n",
    to: "    return 'overloaded';\n",
    tests: 'test/retry-policy.test.ts',
  },
  {
    name: 'Bỏ ngân sách retry',
    file: CLIENT,
    from: '    if (!this.budget.hasToken()) {\n',
    to: '    if (false as boolean) {\n',
    tests: 'test/retry-policy.test.ts',
  },
  {
    name: 'Bỏ jitter: chờ đủ giới hạn backoff',
    file: CLIENT,
    from: '  return random() * Math.min(settings.maxDelayMs, settings.baseDelayMs * 2 ** (attempt - 1));\n',
    to: '  return Math.min(settings.maxDelayMs, settings.baseDelayMs * 2 ** (attempt - 1));\n',
    tests: 'test/retry-policy.test.ts',
  },
  {
    name: 'Bỏ hạn chót tổng và timeout mỗi lần thử',
    file: CLIENT,
    from: '            signal: AbortSignal.any([deadline, AbortSignal.timeout(this.settings.attemptTimeoutMs)]),\n',
    to: '',
    tests: 'test/retry-policy.test.ts',
  },
  {
    name: 'Đối soát chỉ hỏi, không gửi lại lệnh chưa tới đối tác',
    file: 'src/wallet/reconcile.worker.ts',
    from: "    const resent = found === 'not_found' ? await this.resend(item) : 'unavailable';\n",
    to: "    const resent = 'unavailable' as string;\n",
    tests: 'test/same-key-one-transaction.test.ts',
  },
  {
    name: 'Không tôn trọng Retry-After',
    file: CLIENT,
    from: '      return failure.error.retryAfterMs;\n',
    to: '      return 0;\n',
    tests: 'test/retry-policy.test.ts',
  },
];

interface VitestReport {
  numTotalTests: number;
  numFailedTests: number;
  testResults: { assertionResults: { fullName: string; status: string }[] }[];
}

const outDir = join('bench/results', process.env.RUN ?? 'trial');
mkdirSync(outDir, { recursive: true });
const reportFile = join(outDir, 'drill-vitest.json');

function runTests(tests: string): VitestReport {
  rmSync(reportFile, { force: true });
  spawnSync('npx', ['vitest', 'run', tests, '--reporter=json', `--outputFile=${reportFile}`], { encoding: 'utf8' });
  return JSON.parse(readFileSync(reportFile, 'utf8')) as VitestReport;
}

const results = [];
for (const drill of DRILLS) {
  const original = readFileSync(drill.file, 'utf8');
  if (original.split(drill.from).length !== 2) {
    throw new Error(`"${drill.name}": chuỗi cần sửa phải xuất hiện đúng một lần trong ${drill.file}`);
  }
  // Nền phải xanh trước khi sửa, nếu không test đỏ vì lý do khác và phép thử âm "đạt" giả.
  const baseline = runTests(drill.tests);
  if (baseline.numTotalTests === 0 || baseline.numFailedTests > 0) {
    throw new Error(`"${drill.name}": ${drill.tests} chưa xanh trước khi sửa (${baseline.numFailedTests} đỏ)`);
  }
  try {
    writeFileSync(drill.file, original.replace(drill.from, () => drill.to));
    const report = runTests(drill.tests);
    const failed = report.testResults
      .flatMap((file) => file.assertionResults)
      .filter((test) => test.status === 'failed')
      .map((test) => test.fullName);
    results.push({ name: drill.name, total: report.numTotalTests, failed: report.numFailedTests, failedTests: failed });
  } finally {
    writeFileSync(drill.file, original);
  }
  if (readFileSync(drill.file, 'utf8') !== original) {
    throw new Error(`Không khôi phục được ${drill.file}`);
  }
}
rmSync(reportFile, { force: true });

writeFileSync(join(outDir, 'drills.json'), JSON.stringify(results, null, 2));
for (const result of results) {
  const passed = result.total > 0 && result.failed > 0;
  console.log(`${passed ? 'đạt ' : 'KHÔNG ĐẠT'} ${result.name}: ${result.failed}/${result.total} test đỏ`);
}
if (results.some((result) => result.total === 0 || result.failed === 0)) {
  process.exit(1);
}
