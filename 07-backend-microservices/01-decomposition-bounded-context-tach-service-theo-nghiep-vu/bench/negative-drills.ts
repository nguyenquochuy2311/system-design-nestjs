/**
 * Phép thử âm: gỡ từng phần của pattern bằng cách sửa mã nguồn thật, chạy đúng test bảo vệ phần đó, rồi khôi phục.
 * Mỗi chuỗi cần sửa phải xuất hiện đúng một lần. Kịch bản chỉ đạt khi có test chạy (tổng > 0) và có test đỏ.
 *   RUN=main pnpm bench:drills     # cần PostgreSQL có PGMQ; kết quả: bench/results/<RUN>/drills.json
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

const DRILLS: Drill[] = [
  {
    name: 'Ordering gọi Catalog lúc đặt hàng thay vì dùng bản sao giá',
    file: 'apps/ordering/place-order.service.ts',
    from: "    const lines = await this.priceFromSnapshots(command.items);\n",
    to: "    await fetch('http://127.0.0.1:9/products').catch(() => { throw new UnprocessableEntityException('Catalog chết'); });\n    const lines = await this.priceFromSnapshots(command.items);\n",
    tests: 'test/order-placed-while-catalog-down.test.ts',
  },
  {
    name: 'Lớp dịch ném lỗi thay vì cách ly sự kiện không hiểu',
    file: 'apps/ordering/acl/catalog-event-translator.ts',
    from: "  return { kind: 'quarantine', reason: `Không dịch được ProductPriceChanged schemaVersion=${String(event.schemaVersion)}` };",
    to: "  throw new Error('Không dịch được sự kiện');",
    tests: 'test/catalog-event-field-rename-tolerated.test.ts',
  },
  {
    name: 'Lớp dịch chỉ hiểu v1',
    file: 'apps/ordering/acl/catalog-event-translator.ts',
    from: 'const fields = event.schemaVersion === 2 ? fromV2(event) : fromV1(event);',
    to: 'const fields = fromV1(event);',
    tests: 'test/catalog-event-field-rename-tolerated.test.ts',
  },
  {
    name: 'Bỏ điều kiện phiên bản khi ghi bản sao giá',
    file: 'apps/ordering/catalog-event.consumer.ts',
    from: '             WHERE EXCLUDED.price_version > snapshot.price_version`,',
    to: '`,',
    tests: 'test/locked-price.test.ts',
  },
  {
    name: 'Tắt luật chặn import chéo của Ordering',
    file: 'eslint.config.js',
    from: "const contextBoundaries = CONTEXTS.map((context) => ({",
    to: "const contextBoundaries = CONTEXTS.filter((context) => context !== 'ordering').map((context) => ({",
    tests: 'test/context-boundaries.test.ts',
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
  // Nền phải xanh trước khi sửa: nếu DB chưa bật thì test đỏ vì lý do khác và phép thử âm "đạt" giả.
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
