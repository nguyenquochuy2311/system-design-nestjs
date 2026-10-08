/**
 * Lượt đo chính "50 người lật trang" (README mục 5): 3 vòng, mỗi vòng chạy cả ba cấu hình, xoay thứ tự giữa các vòng.
 *   A = OFFSET, chưa có index phù hợp (trạng thái "trước")
 *   B = OFFSET + index (merchant_id, created_at DESC, id DESC) (chỉ thêm index, lựa chọn 1 ở mục 2)
 *   C = keyset + cùng index (pattern)
 * A cần bảng KHÔNG có index phức hợp nên mỗi lần đổi A ↔ B/C là một lần tạo/xóa index (ghi thời gian tạo index).
 * Chạy: RUN=main pnpm bench:scroll   (DURATION=30s WARMUP=10s VUS=50 PLAN="A,+,B,C|C,B,-,A|A,+,B,C")
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { postgresCpuSeconds, run, startApi } from './lib/api-process.js';
import { LAB_DIR, machineState, RESULTS_DIR, startSleepDetector, writeResult } from './lib/env.js';

const DURATION = process.env.DURATION ?? '30s';
const WARMUP = process.env.WARMUP ?? '10s';
const VUS = process.env.VUS ?? '50';
const PLAN = (process.env.PLAN ?? 'A,+,B,C|C,B,-,A|A,+,B,C').split('|').map((r) => r.split(','));
const MODE: Record<string, string> = { A: 'offset', B: 'offset', C: 'keyset' };

const psql = async (file: string) => {
  const t0 = Date.now();
  await run(`docker compose exec -T postgres psql -U app -d ledger -v ON_ERROR_STOP=1 -q -f /lab/db/${file}`);
  return (Date.now() - t0) / 1000;
};

// Chỉ schema public: test dựng schema lab_test có index cùng tên.
const hasIndex = async () =>
  (await run(`docker compose exec -T postgres psql -U app -d ledger -tAc "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'transactions_merchant_created_id_idx'"`)).trim() === '1';

/** k6 chạy bằng spawn bất đồng bộ: spawnSync chặn event loop và bộ phát hiện máy ngủ sẽ báo nhầm. */
function k6(args: string[]): Promise<{ status: number | null; stdout: string }> {
  return new Promise((done) => {
    const child = spawn('k6', args, { cwd: LAB_DIR, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    child.once('exit', (status) => done({ status, stdout }));
  });
}

// Vòng đầu bắt đầu bằng A thì bảng phải chưa có index phức hợp.
if (PLAN[0]![0] === 'A' && (await hasIndex())) await psql('drop-keyset-index.sql');
if (PLAN[0]![0] !== 'A' && !(await hasIndex())) await psql('add-keyset-index.sql');

mkdirSync(resolve(RESULTS_DIR, 'k6'), { recursive: true });
const api = await startApi();
const sleep = startSleepDetector();
const steps: unknown[] = [];
try {
  for (const [r, round] of PLAN.entries()) {
    for (const step of round) {
      if (step === '+' || step === '-') {
        const seconds = await psql(step === '+' ? 'add-keyset-index.sql' : 'drop-keyset-index.sql');
        steps.push({ round: r + 1, step: step === '+' ? 'tạo index' : 'xóa index', seconds });
        console.log(`-- vòng ${r + 1}: ${step === '+' ? 'tạo' : 'xóa'} index mất ${seconds.toFixed(1)} s`);
        continue;
      }
      const name = `r${r + 1}-${step}`;
      const before = machineState();
      const pg0 = await postgresCpuSeconds();
      const api0 = api.cpuSeconds();
      const t0 = Date.now();
      const res = await k6(['run', '--quiet', '-e', `MODE=${MODE[step]}`, '-e', `NAME=${name}`, '-e', `OUT=${resolve(RESULTS_DIR, 'k6')}`, '-e', `VUS=${VUS}`, '-e', `WARMUP=${WARMUP}`, '-e', `DURATION=${DURATION}`, 'bench/scroll-500-pages.k6.js']);
      const wallSeconds = (Date.now() - t0) / 1000;
      process.stdout.write(res.stdout);
      if (res.status !== 0) throw new Error(`k6 ${name} thoát mã ${res.status}`);
      const summary = JSON.parse(readFileSync(resolve(RESULTS_DIR, 'k6', `${name}.json`), 'utf8'));
      if (summary.checksRate !== 1) console.log(`!! ${name}: chỉ ${(summary.checksRate * 100).toFixed(1)} % request đạt "200 và đủ 20 dòng" — không dùng số của lượt này`);
      steps.push({
        round: r + 1, step, name, mode: MODE[step], wallSeconds,
        postgresCpuPercent: (((await postgresCpuSeconds()) - pg0) / wallSeconds) * 100,
        apiCpuPercent: ((api.cpuSeconds() - api0) / wallSeconds) * 100,
        before, after: machineState(), summary,
      });
    }
  }
} finally {
  await api.stop();
}
const gaps = sleep.stop();
const file = writeResult('scroll/rounds.json', { duration: DURATION, warmup: WARMUP, vus: Number(VUS), plan: PLAN, sleepGaps: gaps, steps });
console.log(`→ ${file}${gaps.length ? ` · CẢNH BÁO: máy ngủ ${gaps.length} lần, chạy lại lượt này` : ''}`);
