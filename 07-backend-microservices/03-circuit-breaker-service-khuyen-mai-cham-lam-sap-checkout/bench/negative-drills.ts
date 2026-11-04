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

const GUARD = 'src/checkout/guarded-promotion.client.ts';

const DRILLS: Drill[] = [
  {
    name: 'Đếm cả lỗi do request sai vào ngưỡng',
    file: GUARD,
    from: '      errorFilter: (error: unknown) => error instanceof InvalidPromoCodeError,\n',
    to: '',
    tests: 'test/client-error-does-not-open-breaker.test.ts',
  },
  {
    name: 'Bỏ số lời gọi tối thiểu: vài lỗi lúc tải thấp cũng mở cầu dao',
    file: GUARD,
    from: '      volumeThreshold: settings.volumeThreshold,\n',
    to: '      volumeThreshold: 0,\n',
    tests: 'test/opens-after-n-failures.test.ts',
  },
  {
    name: 'Bỏ fallback',
    file: GUARD,
    from: '    this.breaker.fallback(() => NO_DISCOUNT);\n',
    to: '',
    tests: 'test/opens-after-n-failures.test.ts',
  },
  {
    name: 'Cầu dao không bao giờ thử lại',
    file: GUARD,
    from: '      resetTimeout: settings.resetTimeout,\n',
    to: '      resetTimeout: 3_600_000,\n',
    tests: 'test/half-open-allows-single-probe.test.ts',
  },
  {
    name: 'Bỏ timeout của lời gọi: chậm không thành lỗi',
    file: 'src/checkout/promotion.client.ts',
    from: '    signal: AbortSignal.timeout(timeoutMs),\n',
    to: '',
    tests: 'test/slow-promotion-exhausts-pool.test.ts',
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
