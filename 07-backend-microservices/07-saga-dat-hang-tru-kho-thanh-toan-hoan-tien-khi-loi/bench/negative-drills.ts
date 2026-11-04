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

const INVENTORY = 'apps/inventory-service/inventory-service.module.ts';
const MACHINE = 'apps/order-service/saga-machine.ts';

const DRILLS: Drill[] = [
  {
    name: 'Coi timeout là thất bại, không tra cứu cổng',
    file: 'apps/payment-service/gateway.client.ts',
    from: '      return this.lookup(key);\n',
    to: "      return 'declined';\n",
    tests: 'test/payment-timeout-queries-before-compensating.test.ts',
  },
  {
    name: 'Bước bù không idempotent',
    file: INVENTORY,
    from: "WHERE saga_id = $1 AND status = 'RESERVED' RETURNING sku, quantity",
    to: 'WHERE saga_id = $1 RETURNING sku, quantity',
    tests: 'test/compensation-is-idempotent.test.ts',
  },
  {
    name: 'Bỏ tombstone của bước bù',
    file: INVENTORY,
    from: `    await tx.query(
      "INSERT INTO inventory.reservations (saga_id, sku, quantity, status) VALUES ($1, '-', 0, 'RELEASED') ON CONFLICT (saga_id) DO NOTHING",
      [sagaId],
    );
`,
    to: '',
    tests: 'test/compensation-is-idempotent.test.ts',
  },
  {
    name: 'Hết hạn thì nhả hàng ngay dù chưa chốt với cổng',
    file: MACHINE,
    from: "    DeadlineReached: { next: 'VOIDING', command: 'VoidPayment' },\n",
    to: "    DeadlineReached: { next: 'COMPENSATING', command: 'ReleaseStock' },\n",
    tests: 'test/deadline-settles-before-releasing.test.ts',
  },
  {
    name: 'Không có hạn chót khi còn giữ hàng',
    file: MACHINE,
    from: "    OutOfStock: { next: 'CANCELLED' },\n    DeadlineReached: { next: 'COMPENSATING', command: 'ReleaseStock' },\n",
    to: "    OutOfStock: { next: 'CANCELLED' },\n",
    tests: 'test/deadline-settles-before-releasing.test.ts',
  },
  {
    name: 'Gửi lệnh đầu tiên ngoài transaction tạo đơn',
    file: 'apps/order-service/order-service.module.ts',
    from: "      await sendMessage(tx, 'inventory_commands', {\n        type: 'ReserveStock',",
    to: "      await sendMessage(this.db, 'inventory_commands', {\n        type: 'ReserveStock',",
    tests: 'test/orchestrator-crash-resumes-saga.test.ts',
  },
  {
    name: 'Hủy không hoàn tiền: cổng giữ nguyên giao dịch đã trừ',
    file: 'apps/fake-gateway/fake-gateway.ts',
    from: "        this.charges.set(key, 'REFUNDED');\n",
    to: '',
    tests: 'test/deadline-settles-before-releasing.test.ts',
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
