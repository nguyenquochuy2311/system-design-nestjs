/**
 * EXPLAIN (ANALYZE, BUFFERS) cho trang 1, 50, 500 của cả hai bản, trên đúng câu SQL repository sinh ra.
 * Mỗi ô: 1 lần đầu (ghi riêng số buffer phải đọc từ đĩa/OS) + 5 lần đo, lấy trung vị thời gian thực thi.
 * Chạy: RUN=main LABEL=B-co-index pnpm bench:explain   (MERCHANTS=1,500 PAGES=1,50,500 ROUNDS=5)
 */
import { sql } from 'kysely';
import { keysetPageQuery } from '../src/sau/transactions-keyset.repository.js';
import { createDb } from '../src/shared/db.js';
import { explain, positionBeforePage, summarizePlan } from '../src/shared/explain.js';
import { offsetPageQuery } from '../src/truoc/transactions-offset.repository.js';
import { machineState, median, writeResult } from './lib/env.js';

const LABEL = process.env.LABEL ?? 'explain';
const MERCHANTS = (process.env.MERCHANTS ?? '1,500').split(',').map(Number);
const PAGES = (process.env.PAGES ?? '1,50,500').split(',').map(Number);
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const SIZE = 20;

const db = createDb({ max: 1 });
const state = machineState();
const indexes = (await sql<{ indexname: string }>`SELECT indexname FROM pg_indexes WHERE tablename = 'transactions' AND schemaname = 'public' ORDER BY 1`.execute(db)).rows.map((r) => r.indexname);
const version = (await sql<{ v: string }>`SELECT current_setting('server_version') AS v`.execute(db)).rows[0]!.v;
const merchantRows = Object.fromEntries(
  await Promise.all(MERCHANTS.map(async (m) => [m, Number((await sql<{ n: string }>`SELECT count(*) AS n FROM transactions WHERE merchant_id = ${m}`.execute(db)).rows[0]!.n)])),
);
console.log(`== ${LABEL} · PostgreSQL ${version} · index: ${indexes.join(', ')} · ${state.power} ${state.battery ?? '?'}% · load ${state.load1}`);

const cells = [];
for (const merchantId of MERCHANTS) {
  for (const page of PAGES) {
    const after = await positionBeforePage(db, merchantId, page, SIZE);
    for (const variant of ['offset', 'keyset'] as const) {
      const query = variant === 'offset' ? offsetPageQuery(db, merchantId, page, SIZE) : keysetPageQuery(db, merchantId, SIZE, after);
      const first = summarizePlan(await explain(db, query));
      const runs = [];
      for (let i = 0; i < ROUNDS; i++) runs.push(summarizePlan(await explain(db, query)));
      const cell = {
        merchantId, page, variant,
        executionMsMedian: median(runs.map((r) => r.executionMs)),
        executionMs: runs.map((r) => r.executionMs),
        buffers: runs[runs.length - 1]!.sharedHit + runs[runs.length - 1]!.sharedRead,
        firstRun: { executionMs: first.executionMs, sharedHit: first.sharedHit, sharedRead: first.sharedRead },
        scanRows: runs[0]!.scanRows,
        nodes: runs[0]!.nodes,
      };
      cells.push(cell);
      console.log(
        `m${merchantId} p${String(page).padStart(3)} ${variant.padEnd(6)} ` +
          `${cell.executionMsMedian.toFixed(3).padStart(9)} ms · buffer ${String(cell.buffers).padStart(7)} (lần đầu đọc ${first.sharedRead}) · ` +
          `quét ${cell.scanRows} dòng · ${cell.nodes.join(' → ')}`,
      );
    }
  }
}

const file = writeResult(`explain/${LABEL}.json`, { label: LABEL, version, indexes, merchantRows, rounds: ROUNDS, size: SIZE, before: state, after: machineState(), cells });
console.log(`→ ${file}`);
await db.destroy();
