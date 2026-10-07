// Chi phí của riêng trigger trên MỘT câu UPDATE hợp đồng, đo trong DB bằng EXPLAIN (ANALYZE):
// PostgreSQL in thời gian của từng trigger ("Triggers": Time) và tổng Execution Time. Mỗi mẫu chạy trong một
// transaction rồi ROLLBACK, nên không để lại thay đổi hay dòng nhật ký nào.
// ROUNDS vòng, mỗi vòng SAMPLES mẫu bật và SAMPLES mẫu tắt, đổi thứ tự bật / tắt giữa các vòng.
// Thêm: thời gian một vòng gọi DB (SELECT 1) từ host qua cổng 55432, tuần tự và 10 kết nối song song, để so với
// số vòng gọi mà withActor thêm vào (BEGIN, set_config, COMMIT).
// Ví dụ: RESULTS_DIR=bench/results/main pnpm bench:trigger
import pg from 'pg';
import { APP_URL } from '../src/shared/config';
import { adminClient, median, round, save, setAuditTrigger } from './lib';

const ROUNDS = Number(process.env.ROUNDS ?? 5);
const SAMPLES = Number(process.env.SAMPLES ?? 200);

const admin = await adminClient();
const samples: { round: number; state: 'on' | 'off'; executionMs: number; triggerMs: number | null }[] = [];

async function sample(state: 'on' | 'off', round: number, i: number): Promise<void> {
  const id = 1 + ((i * 197 + round * 31) % 40000);
  await admin.query('BEGIN');
  try {
    await admin.query("SELECT set_config('app.user_id', 'bench-trigger-cost', true), set_config('app.reason', 'đo chi phí trigger', true)");
    const { rows } = await admin.query(
      `EXPLAIN (ANALYZE, FORMAT JSON) UPDATE public.contracts SET premium = premium + 1000, updated_by = 'bench', updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    const top = rows[0]['QUERY PLAN'][0];
    const trig = (top.Triggers ?? []).find((t: { 'Trigger Name': string }) => t['Trigger Name'] === 'contracts_audit');
    samples.push({ round, state, executionMs: top['Execution Time'], triggerMs: trig ? trig.Time : null });
  } finally {
    await admin.query('ROLLBACK');
  }
}

try {
  for (let r = 1; r <= ROUNDS; r++) {
    const order: ('on' | 'off')[] = r % 2 ? ['off', 'on'] : ['on', 'off'];
    for (const state of order) {
      await setAuditTrigger(admin, state);
      for (let i = 0; i < 20; i++) await sample(state, -r, i); // warm-up, không tính
      for (let i = 0; i < SAMPLES; i++) await sample(state, r, i);
    }
  }
} finally {
  await setAuditTrigger(admin, 'on');
  await admin.end();
}

// Một vòng gọi DB từ host (tài khoản ứng dụng, như API).
const rttPool = new pg.Pool({ connectionString: APP_URL, max: 10 });
const sequential: number[] = [];
const concurrent: number[] = [];
try {
  for (let i = 0; i < 200; i++) await rttPool.query('SELECT 1'); // warm-up
  const one = await rttPool.connect();
  for (let i = 0; i < 2000; i++) {
    const t = performance.now();
    await one.query('SELECT 1');
    sequential.push(performance.now() - t);
  }
  one.release();
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      const c = await rttPool.connect();
      for (let i = 0; i < 1000; i++) {
        const t = performance.now();
        await c.query('SELECT 1');
        concurrent.push(performance.now() - t);
      }
      c.release();
    }),
  );
} finally {
  await rttPool.end();
}

const kept = samples.filter((s) => s.round > 0);
const perRound = [...new Set(kept.map((s) => s.round))].map((r) => {
  const on = kept.filter((s) => s.round === r && s.state === 'on');
  const off = kept.filter((s) => s.round === r && s.state === 'off');
  return {
    round: r,
    onExecMedianMs: round(median(on.map((s) => s.executionMs)), 4),
    offExecMedianMs: round(median(off.map((s) => s.executionMs)), 4),
    triggerMedianMs: round(median(on.map((s) => s.triggerMs ?? 0)), 4),
  };
});
const result = {
  samplesPerState: SAMPLES * ROUNDS,
  perRound,
  medianOfRounds: {
    onExecMs: round(median(perRound.map((p) => p.onExecMedianMs)), 4),
    offExecMs: round(median(perRound.map((p) => p.offExecMedianMs)), 4),
    triggerMs: round(median(perRound.map((p) => p.triggerMedianMs)), 4),
  },
  offHasTrigger: kept.some((s) => s.state === 'off' && s.triggerMs !== null),
  roundTripSelect1Ms: { sequentialMedian: round(median(sequential), 4), concurrent10Median: round(median(concurrent), 4) },
};
console.log(JSON.stringify(result, null, 2));
console.log('Đã ghi', save('trigger-cost.json', { ...result, samples: kept }));
