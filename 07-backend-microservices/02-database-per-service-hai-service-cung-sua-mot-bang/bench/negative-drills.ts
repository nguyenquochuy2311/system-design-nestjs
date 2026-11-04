/**
 * Phép thử âm: gỡ từng phần của pattern bằng cách sửa mã nguồn thật, chạy đúng test bảo vệ phần đó, rồi khôi phục.
 * Mỗi chuỗi cần sửa phải xuất hiện đúng một lần. Test phải xanh trước khi sửa, và có test đỏ sau khi sửa.
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

const CONSUMER = 'apps/shipping-service/order-event.consumer.ts';

const DRILLS: Drill[] = [
  {
    name: 'Cấp quyền chéo "cho tiện": shipping_rw đọc được bảng đơn',
    file: 'apps/order-service/migrations/001_ordering.sql',
    from: '  quantity integer NOT NULL,\n  PRIMARY KEY (order_id, sku)\n);\n',
    to: '  quantity integer NOT NULL,\n  PRIMARY KEY (order_id, sku)\n);\nGRANT USAGE ON SCHEMA ordering TO shipping_rw;\nGRANT SELECT ON ordering.orders TO shipping_rw;\n',
    tests: 'test/cross-schema-access-denied.test.ts',
  },
  {
    name: 'Bản sao chép thêm trường giá',
    file: 'apps/shipping-service/migrations/001_shipping.sql',
    from: '  zone_code text NOT NULL,\n  order_version integer NOT NULL,',
    to: '  zone_code text NOT NULL,\n  total_vnd bigint,\n  order_version integer NOT NULL,',
    tests: 'test/cross-schema-access-denied.test.ts',
  },
  {
    name: 'Gửi sự kiện ngoài transaction ghi đơn',
    file: 'apps/order-service/order-service.module.ts',
    from: "await sql`SELECT pgmq.send('order_events', ${JSON.stringify(event)}::jsonb)`.execute(trx);",
    to: "await sql`SELECT pgmq.send('order_events', ${JSON.stringify(event)}::jsonb)`.execute(this.database.db);",
    tests: 'test/event-and-order-commit-together.test.ts',
  },
  {
    name: 'Bỏ điều kiện phiên bản khi ghi bản sao',
    file: CONSUMER,
    from: "          .doUpdateSet(fields)\n          .whereRef('excluded.order_version', '>', 'shipment_orders.order_version'),",
    to: '          .doUpdateSet(fields),',
    tests: 'test/duplicate-event-upserts-once.test.ts',
  },
  {
    name: 'Archive sự kiện trước khi xử lý: lỗi ở shipping làm mất sự kiện',
    file: CONSUMER,
    from: '        await this.handle(message);\n',
    to: "        await sql`SELECT pgmq.archive('order_events', ${message.msg_id}::bigint)`.execute(this.database.db);\n        await this.handle(message);\n",
    tests: 'test/shipping-migration-does-not-break-orders.test.ts',
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
