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

const BULKHEAD = 'src/crm-api/tenant-bulkhead.ts';

const DRILLS: Drill[] = [
  {
    name: 'Dùng chung một pool cho hai khoang',
    file: 'src/crm-api/db-pools.ts',
    from: `    return new DbPools(
      new pg.Pool({ connectionString, max: sizes.interactive, statement_timeout: 2_000, connectionTimeoutMillis: 1_000 }),
      new pg.Pool({ connectionString, max: sizes.report, statement_timeout: 60_000 }),
    );
`,
    to: `    const pool = new pg.Pool({ connectionString, max: sizes.report });
    return new DbPools(pool, pool);
`,
    tests: 'test/full-report-compartment-does-not-slow-notes.test.ts',
  },
  {
    name: 'Không trả chỗ khi xong',
    file: 'src/crm-api/bulkhead.interceptor.ts',
    from: '        return next.handle().pipe(finalize(() => lease.release()));\n',
    to: '        return next.handle();\n',
    tests: 'test/slot-released-on-error.test.ts',
  },
  {
    name: 'Giới hạn theo khoang, không theo tenant',
    file: BULKHEAD,
    from: '    const key = `${compartment}:${tenantId}`;\n    const slot',
    to: '    const key = compartment;\n    const slot',
    tests: 'test/tenant-over-limit-gets-429.test.ts',
  },
  {
    name: 'Hàng chờ không giới hạn',
    file: BULKHEAD,
    from: '    if (slot.waiting.length >= limits.queue) {\n',
    to: '    if (false as boolean) {\n',
    tests: 'test/tenant-bulkhead.test.ts',
  },
  {
    name: 'Hàng chờ không có thời gian tối đa',
    file: BULKHEAD,
    from: '        }, limits.maxWaitMs),\n',
    to: '        }, 3_600_000),\n',
    tests: 'test/tenant-bulkhead.test.ts',
  },
  {
    name: 'Xuất dữ liệu ngay trong request',
    file: 'src/crm-api/crm.module.ts',
    from: "    if (this.config.mode === 'truoc') {\n      await this.pools.report.query",
    to: "    if (true as boolean) {\n      await this.pools.report.query",
    tests: 'test/full-report-compartment-does-not-slow-notes.test.ts',
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
