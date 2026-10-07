/**
 * Diễn tập "đổi một quy tắc" và các phép thử âm bằng cách sửa mã nguồn thật, chạy test / công cụ, rồi khôi phục.
 *   RUN=main pnpm bench:drills        # kết quả: bench/results/<RUN>/drills/
 * Cần PostgreSQL đang chạy (pnpm db:up). Mỗi kịch bản sửa đúng các chuỗi khai báo bên dưới (mỗi chuỗi phải xuất hiện
 * đúng một lần), và luôn khôi phục file gốc trong finally; cuối script so lại nội dung để chắc không sót thay đổi.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('bench/results', process.env.RUN ?? 'main', 'drills');
mkdirSync(OUT, { recursive: true });

interface Edit {
  file: string;
  from: string;
  to: string;
}
interface Check {
  label: string;
  cmd: string[];
  env?: Record<string, string>;
  /** vitest: đọc file JSON reporter để đếm test xanh/đỏ theo tên. */
  vitestJson?: boolean;
}
interface Scenario {
  name: string;
  description: string;
  edits: Edit[];
  checks: Check[];
}

const SAU_POLICY = 'src/sau/orders/domain/discount-policy.ts';
const SAU_CREDIT = 'src/sau/orders/domain/credit-limit-policy.ts';
const SAU_CONTROLLER = 'src/sau/orders/presentation/orders.controller.ts';
const TRUOC_CONTROLLER = 'src/truoc/orders.controller.ts';
const TRUOC_CSV = 'src/truoc/csv-import.job.ts';
const TRUOC_MARKET = 'src/truoc/marketplace-sync.job.ts';
const DISCOUNT_TEST = 'test/e2e/discount-policy-changed-in-one-place.e2e.test.ts';

const goldTest = (variant: string): Check => ({
  label: `${variant}: đơn Vàng với chính sách mới 7%`,
  cmd: ['npx', 'vitest', 'run', DISCOUNT_TEST, '-t', `${variant}: đơn hạng Vàng 10 triệu`],
  env: { EXPECTED_GOLD_BPS: '700' },
  vitestJson: true,
});

const SCENARIOS: Scenario[] = [
  {
    name: 'gold-7-sau',
    description: 'Đổi chiết khấu hạng Vàng 5% → 7% ở bản "sau": sửa một chỗ trong DiscountPolicy',
    edits: [{ file: SAU_POLICY, from: '  gold: 500,', to: '  gold: 700,' }],
    checks: [
      goldTest('sau'),
      // Test ghim tỉ lệ cũ phải đỏ: chứng tỏ bộ test bắt được thay đổi, và cho biết bao nhiêu kỳ vọng cần cập nhật.
      { label: 'unit (kỳ vọng còn ghim 5%)', cmd: ['npx', 'vitest', 'run', '--project', 'unit'], vitestJson: true },
    ],
  },
  {
    name: 'gold-7-truoc-controller-only',
    description: 'Đổi chiết khấu hạng Vàng 5% → 7% ở bản "trước": sửa chỗ hiển nhiên nhất (controller)',
    edits: [{ file: TRUOC_CONTROLLER, from: "tier === 'gold') {\n        rateBps = 500;", to: "tier === 'gold') {\n        rateBps = 700;" }],
    checks: [goldTest('truoc')],
  },
  {
    name: 'gold-7-truoc-all-copies',
    description: 'Đổi chiết khấu hạng Vàng 5% → 7% ở bản "trước": sửa cả ba bản sao',
    edits: [
      { file: TRUOC_CONTROLLER, from: "tier === 'gold') {\n        rateBps = 500;", to: "tier === 'gold') {\n        rateBps = 700;" },
      { file: TRUOC_CSV, from: "case 'gold':\n              rateBps = 500;", to: "case 'gold':\n              rateBps = 700;" },
      { file: TRUOC_MARKET, from: 'gold: 500,', to: 'gold: 700,' },
    ],
    checks: [
      goldTest('truoc'),
      {
        label: 'e2e bảng quy tắc của bản trước (kỳ vọng còn ghim 5%)',
        cmd: ['npx', 'vitest', 'run', 'test/e2e/web-order-rules.e2e.test.ts', '-t', 'truoc: bảng quy tắc'],
        vitestJson: true,
      },
    ],
  },
  {
    name: 'credit-check-removed-sau',
    description: 'Phép thử âm: gỡ phép kiểm hạn mức trong CreditLimitPolicy của bản "sau"',
    edits: [{ file: SAU_CREDIT, from: '  if (exposure > position.creditLimit) {', to: '  if (exposure > position.creditLimit && false) {' }],
    checks: [
      { label: 'unit (không DB)', cmd: ['npx', 'vitest', 'run', '--project', 'unit'], vitestJson: true },
      { label: 'e2e (HTTP + DB)', cmd: ['npx', 'vitest', 'run', '--project', 'e2e'], vitestJson: true },
    ],
  },
  {
    name: 'controller-imports-repository-sau',
    description: 'Phép thử âm: controller của bản "sau" import thẳng repository Kysely',
    edits: [
      {
        file: SAU_CONTROLLER,
        from: "import { parsePlaceOrderBody } from './place-order.dto';",
        to: "import { parsePlaceOrderBody } from './place-order.dto';\nimport { KyselyOrderRepository } from '../infrastructure/kysely-order-repository';\nexport const shortcut = KyselyOrderRepository;",
      },
    ],
    checks: [{ label: 'pnpm depcruise', cmd: ['pnpm', '-s', 'depcruise'] }],
  },
];

function applyEdits(edits: Edit[], originals: Map<string, string>): void {
  for (const e of edits) {
    if (!originals.has(e.file)) originals.set(e.file, readFileSync(e.file, 'utf8'));
    const current = readFileSync(e.file, 'utf8');
    const count = current.split(e.from).length - 1;
    if (count !== 1) throw new Error(`${e.file}: chuỗi cần sửa xuất hiện ${count} lần (phải đúng 1): ${JSON.stringify(e.from)}`);
    writeFileSync(e.file, current.replace(e.from, e.to));
  }
}

function runCheck(scenario: string, check: Check, index: number) {
  const jsonFile = join(OUT, `${scenario}-${index}.vitest.json`);
  const args = check.vitestJson ? [...check.cmd.slice(1), '--reporter=json', `--outputFile=${jsonFile}`] : check.cmd.slice(1);
  const started = performance.now();
  const res = spawnSync(check.cmd[0] as string, args, { env: { ...process.env, ...check.env }, encoding: 'utf8' });
  const seconds = (performance.now() - started) / 1000;
  writeFileSync(join(OUT, `${scenario}-${index}.log`), `$ ${check.cmd.join(' ')}\n${res.stdout}\n${res.stderr}`);
  const result: Record<string, unknown> = { label: check.label, exitCode: res.status, seconds: Number(seconds.toFixed(2)) };
  if (check.vitestJson) {
    const report = JSON.parse(readFileSync(jsonFile, 'utf8')) as {
      numPassedTests: number;
      numFailedTests: number;
      testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[];
    };
    const tests = report.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status !== 'skipped' && a.status !== 'pending'));
    result.passed = report.numPassedTests;
    result.failed = report.numFailedTests;
    result.failedTests = tests.filter((t) => t.status === 'failed').map((t) => t.fullName);
    result.passedTests = tests.filter((t) => t.status === 'passed').map((t) => t.fullName);
  } else {
    result.output = res.stdout.trim().split('\n').slice(-6);
  }
  return result;
}

const allFiles = [...new Set(SCENARIOS.flatMap((s) => s.edits.map((e) => e.file)))];
const pristine = new Map(allFiles.map((f) => [f, readFileSync(f, 'utf8')]));
// Bản sao dự phòng: nếu tiến trình bị giết giữa chừng, chép lại từ đây.
mkdirSync(join(OUT, 'backup'), { recursive: true });
for (const [file, content] of pristine) writeFileSync(join(OUT, 'backup', file.replaceAll('/', '__')), content);
const results: unknown[] = [];

for (const scenario of SCENARIOS) {
  console.log(`\n== ${scenario.name}: ${scenario.description}`);
  const originals = new Map<string, string>();
  try {
    applyEdits(scenario.edits, originals);
    const checks = scenario.checks.map((c, i) => runCheck(scenario.name, c, i));
    const filesEdited = new Set(scenario.edits.map((e) => e.file)).size;
    results.push({ name: scenario.name, description: scenario.description, filesEdited, edits: scenario.edits, checks });
    for (const c of checks) console.log(JSON.stringify({ ...c, passedTests: undefined }, null, 1));
  } finally {
    for (const [file, content] of originals) writeFileSync(file, content);
  }
}

for (const [file, content] of pristine) {
  if (readFileSync(file, 'utf8') !== content) throw new Error(`${file} không được khôi phục đúng`);
}
writeFileSync(join(OUT, 'mutation-drills.json'), JSON.stringify(results, null, 2));
console.log(`\nĐã khôi phục ${pristine.size} file gốc. Kết quả: ${join(OUT, 'mutation-drills.json')}`);
