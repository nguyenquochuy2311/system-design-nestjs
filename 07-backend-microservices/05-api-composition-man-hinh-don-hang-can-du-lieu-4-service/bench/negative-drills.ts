/**
 * Phép thử âm: gỡ từng phần của pattern bằng cách sửa mã nguồn thật, chạy đúng test bảo vệ phần đó, rồi khôi phục.
 * Mỗi chuỗi cần sửa phải xuất hiện đúng một lần. Test phải xanh trước khi sửa, và có test đỏ sau khi sửa.
 *   RUN=main pnpm bench:drills     # cần PostgreSQL; kết quả: bench/results/<RUN>/drills.json
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

const COMPOSER = 'apps/bff/order-detail.composer.ts';

const DRILLS: Drill[] = [
  {
    name: 'Dùng Promise.all thay cho allSettled',
    file: COMPOSER,
    from: 'const [payment, shipping, customer] = await Promise.allSettled([',
    to: 'const [payment, shipping, customer] = await Promise.all([',
    tests: 'test/shipping-timeout-returns-partial.test.ts',
  },
  {
    name: 'Bỏ timeout từng nguồn',
    file: 'apps/bff/source-client.ts',
    from: '      signal: AbortSignal.timeout(SOURCES[source].timeoutMs),\n',
    to: '',
    tests: 'test/shipping-timeout-returns-partial.test.ts',
  },
  {
    name: 'Await lần lượt trong composer',
    file: COMPOSER,
    from: `const [payment, shipping, customer] = await Promise.allSettled([
      loaders.payment.load(order.id),
      loaders.shipping.load(order.id),
      loaders.customer.load(order.customer_id),
    ]);`,
    to: `const settle = <T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> =>
      promise.then(
        (value) => ({ status: 'fulfilled', value }),
        (reason: unknown) => ({ status: 'rejected', reason }),
      );
    const payment = await settle(loaders.payment.load(order.id));
    const shipping = await settle(loaders.shipping.load(order.id));
    const customer = await settle(loaders.customer.load(order.customer_id));`,
    tests: 'test/parallel-calls-cut-latency.test.ts',
  },
  {
    name: 'Bỏ gom lô',
    file: 'apps/bff/batch-loaders.ts',
    from: '    { maxBatchSize: MAX_BATCH_SIZE },\n',
    to: '    { maxBatchSize: 1 },\n',
    tests: 'test/list-uses-one-batch-call-per-provider.test.ts',
  },
  {
    name: 'Dùng chung cache của bộ gom lô giữa các request',
    file: COMPOSER,
    from: `    const orders = await this.requiredList(customerId);
    const loaders = createLoaders(this.urls, this.metrics);
`,
    to: `    const orders = await this.requiredList(customerId);
    const shared = globalThis as unknown as { labLoaders?: ReturnType<typeof createLoaders> };
    const loaders = (shared.labLoaders ??= createLoaders(this.urls, this.metrics));
`,
    tests: 'test/list-uses-one-batch-call-per-provider.test.ts',
  },
  {
    name: 'Bỏ kiểm quyền xem đơn',
    file: COMPOSER,
    from: '    if (!canView(viewer, order.customer_id)) {\n',
    to: '    if (false as boolean) {\n',
    tests: 'test/order-failure-fails-whole-response.test.ts',
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
