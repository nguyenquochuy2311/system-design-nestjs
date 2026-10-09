import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanCopy, environment, LAB, machine, median, parseEnvFile, PG14_IMAGE, sh, type ShResult } from './lib/run';

// Bước 2 và 4: thời gian từ "vừa clone" (bản sao sạch, không node_modules, không .env) tới kết quả, theo ba luồng:
//   truoc: hướng dẫn thủ công kiểu cũ (README cũ): "cài PostgreSQL 14" (mô phỏng bằng docker run postgres:14.24, image
//          đã có sẵn), tự tạo database bằng superuser, tự viết .env, migrate, chạy test cũ (test API).
//   sau  : cp .env.example .env → docker compose up -d --wait → pnpm install → pnpm test (bộ test đầy đủ).
//   ci   : job CI trên compose giống production (`-f compose.yaml`, KHÔNG override, biến lấy từ môi trường như secret
//          của CI) với mã "trước" (migration dùng chuỗi kết nối của role app): dừng ở bước đầu tiên lỗi.
// Đây là thời gian MÁY chạy các lệnh, không phải thời gian người đọc wiki và gõ lệnh.
// Chạy: tsx bench/setup-timing.ts <thư-mục-làm-việc> [tên lượt=main] [số vòng=3] [--cold-store]
// Cần: compose chính của lab ĐÃ TẮT (`docker compose down -v`) vì luồng sau/ci dùng cùng tên project và cổng 55432.
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const workdir = resolve(args[0] ?? join(LAB, '.tmp/clones'));
const outDir = join(LAB, 'bench/results', args[1] ?? 'main');
const rounds = Number(args[2] ?? 3);
const coldStore = process.argv.includes('--cold-store');
mkdirSync(outDir, { recursive: true });
mkdirSync(workdir, { recursive: true });

interface Step {
  name: string;
  cmd: string;
  ms: number;
  code: number | null;
  tail?: string[];
}
interface FlowRun {
  flow: string;
  round: number;
  machine: ReturnType<typeof machine>;
  files: number;
  steps: Step[];
  totalMs: number;
  ok: boolean;
  failedStep?: string;
}

const tail = (r: ShResult, n = 4) => r.out.trim().split('\n').slice(-n);

function runSteps(flow: string, round: number, dir: string, steps: { name: string; cmd: string; env?: Record<string, string> }[], expectFail = false): FlowRun {
  const files = cleanCopy(dir);
  const m = machine();
  const out: Step[] = [];
  const t0 = performance.now();
  let failedStep: string | undefined;
  for (const s of steps) {
    const r = sh(s.cmd, { cwd: dir, env: s.env });
    out.push({ name: s.name, cmd: s.cmd, ms: r.ms, code: r.code, ...(r.code !== 0 || expectFail ? { tail: tail(r, 6) } : {}) });
    if (r.code !== 0) {
      failedStep = s.name;
      break;
    }
  }
  const totalMs = performance.now() - t0;
  return { flow, round, machine: m, files, steps: out, totalMs, ok: !failedStep, ...(failedStep ? { failedStep } : {}) };
}

function truoc(round: number): FlowRun {
  const dir = join(workdir, `truoc-${round}`);
  const pw = randomBytes(9).toString('hex');
  const url = (db: string) => `postgres://postgres:${pw}@127.0.0.1:55433/${db}`;
  const name = 'lab-17-05-truoc';
  sh(`docker rm -f -v ${name}`);
  const envFile = [`DATABASE_URL=${url('crm')}`, `MIGRATION_DATABASE_URL=${url('crm')}`, `TEST_DATABASE_URL=${url('crm_test')}`, `TEST_MIGRATION_DATABASE_URL=${url('crm_test')}`].join('\\n');
  try {
    return runSteps('truoc', round, dir, [
      // README cũ: "brew install postgresql@14 && brew services start postgresql@14" — ở lab mô phỏng bằng container.
      { name: '1. cài và chạy PostgreSQL 14 (mô phỏng: docker run, image có sẵn)', cmd: `docker run -d --name ${name} --label lab.id=17-05 -p 127.0.0.1:55433:5432 -e POSTGRES_PASSWORD=${pw} ${PG14_IMAGE}` },
      { name: '2. chờ PostgreSQL nhận kết nối TCP', cmd: `for i in $(seq 1 240); do docker exec ${name} pg_isready -q -h 127.0.0.1 -U postgres && exit 0; sleep 0.25; done; exit 1` },
      { name: '3. tạo database bằng superuser (createdb)', cmd: `docker exec ${name} createdb -U postgres crm && docker exec ${name} createdb -U postgres crm_test` },
      { name: '4. tự viết .env (một role superuser cho mọi thứ)', cmd: `printf '${envFile}\\n' > .env` },
      { name: '5. pnpm install', cmd: 'pnpm install --frozen-lockfile --reporter=silent' },
      { name: '6. pnpm db:migrate', cmd: 'pnpm -s db:migrate' },
      { name: '7. chạy test (test API của dự án cũ)', cmd: 'pnpm -s exec vitest run test/api.test.ts' },
    ]);
  } finally {
    sh(`docker rm -f -v ${name}`);
  }
}

function sau(round: number, storeDir?: string): FlowRun {
  const dir = join(workdir, `sau-${round}${storeDir ? '-cold' : ''}`);
  const store = storeDir ? ` --store-dir ${storeDir}` : '';
  try {
    return runSteps(storeDir ? 'sau-kho-pnpm-trong' : 'sau', round, dir, [
      { name: '1. cp .env.example .env', cmd: 'cp .env.example .env' },
      { name: '2. docker compose up -d --wait', cmd: 'docker compose up -d --wait' },
      { name: '3. pnpm install', cmd: `pnpm install --frozen-lockfile --reporter=silent${store}` },
      { name: '4. pnpm test', cmd: 'pnpm -s test' },
    ]);
  } finally {
    sh('docker compose down -v', { cwd: dir });
  }
}

function ci(round: number): FlowRun {
  const dir = join(workdir, `ci-${round}`);
  // Biến của job CI (như secret của CI): giá trị mẫu của .env.example, nhưng migration dùng chuỗi kết nối của
  // role app — đúng cấu hình của dự án trước khi tách role migration.
  const env = parseEnvFile(join(LAB, '.env.example'));
  env.MIGRATION_DATABASE_URL = env.DATABASE_URL ?? '';
  env.TEST_MIGRATION_DATABASE_URL = env.TEST_DATABASE_URL ?? '';
  try {
    return runSteps('ci-ma-truoc', round, dir, [
      { name: '1. docker compose -f compose.yaml up -d --wait', cmd: 'docker compose -f compose.yaml up -d --wait', env },
      { name: '2. pnpm install', cmd: 'pnpm install --frozen-lockfile --reporter=silent', env },
      { name: '3. pnpm check:versions', cmd: 'pnpm -s check:versions', env },
      { name: '4. pnpm db:migrate', cmd: 'pnpm -s db:migrate', env },
      { name: '5. pnpm test', cmd: 'pnpm -s test', env },
    ], true);
  } finally {
    sh('docker compose -f compose.yaml down -v', { cwd: dir, env });
  }
}

if (sh('docker compose ps -q').out.trim()) {
  console.error('Compose chính của lab đang chạy: `docker compose down -v` trước khi đo (cùng project và cổng 55432).');
  process.exit(2);
}

const runs: FlowRun[] = [];
const flows = { truoc, sau, ci } as const;
const orders: (keyof typeof flows)[][] = [['truoc', 'sau', 'ci'], ['sau', 'ci', 'truoc'], ['ci', 'truoc', 'sau']];
for (let round = 1; round <= rounds; round++) {
  for (const f of orders[(round - 1) % orders.length]!) {
    const r = flows[f](round);
    runs.push(r);
    console.log(`vòng ${round} ${r.flow.padEnd(12)} ${(r.totalMs / 1000).toFixed(1).padStart(6)} s ${r.ok ? 'xanh' : `DỪNG ở "${r.failedStep}"`} · ${r.steps.map((s) => `${(s.ms / 1000).toFixed(1)}`).join(' + ')} · AC=${r.machine.power} load=${r.machine.load}`);
  }
}
if (coldStore) {
  const store = join(workdir, 'pnpm-store-cold');
  rmSync(store, { recursive: true, force: true });
  const r = sau(1, store);
  runs.push(r);
  console.log(`kho pnpm trống  ${(r.totalMs / 1000).toFixed(1)} s ${r.ok ? 'xanh' : `DỪNG ở "${r.failedStep}"`} · ${r.steps.map((s) => `${(s.ms / 1000).toFixed(1)}`).join(' + ')}`);
  rmSync(store, { recursive: true, force: true });
}

const summary: Record<string, unknown> = {};
for (const flow of [...new Set(runs.map((r) => r.flow))]) {
  const rs = runs.filter((r) => r.flow === flow);
  const totals = rs.map((r) => r.totalMs / 1000);
  summary[flow] = {
    n: rs.length,
    medianS: median(totals),
    minS: Math.min(...totals),
    maxS: Math.max(...totals),
    ok: rs.map((r) => r.ok),
    failedStep: rs.map((r) => r.failedStep ?? null),
    stepMedianS: Object.fromEntries(rs[0]!.steps.map((s, i) => [s.name, median(rs.map((r) => (r.steps[i]?.ms ?? NaN) / 1000))])),
  };
}
writeFileSync(join(outDir, 'setup-timing.json'), JSON.stringify({ environment: environment(), workdir, summary, runs }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`→ ${join(outDir, 'setup-timing.json')}`);
