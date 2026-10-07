// (1) Tỉ lệ thay đổi được ghi nhật ký qua 4 đường (api, job, script, psql) cho 3 phiên bản (truoc, app-log, sau).
//     Mỗi ô: REPEAT hợp đồng mới, một thay đổi qua đường đó, đếm dòng nhật ký thêm vào và kiểm giá trị cũ / mới.
// (2) Người thực hiện có bị ghi sai khi đi qua PgBouncer chế độ transaction: 40 request song song,
//     đặt tên bằng SET mức phiên ngoài transaction (cách sai) và bằng withActor (set_config(..., true)).
// Ví dụ: RESULTS_DIR=bench/results/main pnpm bench:paths
import pg from 'pg';
import { buildApp } from '../src/app';
import { PGBOUNCER_URL, withDatabase } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { changeVia, countLogRows, EXPECTED_ACTOR, VARIANTS, WRITE_PATHS } from '../src/shared/write-paths';
import { createContract, updateContract } from '../src/sau/contract.repository';
import { rowHistory } from '../src/sau/audit-query';
import { createContractTruoc } from '../src/truoc/contract.repository';
import type { NewContract } from '../src/shared/contract';
import { save } from './lib';

const REPEAT = Number(process.env.REPEAT ?? 5);
const LEAK_RUNS = Number(process.env.LEAK_RUNS ?? 5);
const PARALLEL = 40;

const db = createDb();
const app = buildApp(db);
const input = (tag: string): NewContract => ({
  code: `PATHS-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  customerName: 'Công ty khách hàng thử',
  product: 'Tài sản',
  premium: 120_000_000,
  sumInsured: 80_000_000_000,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
});

const coverage: { variant: string; path: string; changes: number; logged: number; correct: number }[] = [];
const leak: { pooler: string; method: string; run: number; wrongActor: number; rejected: number; total: number }[] = [];
try {
  for (const variant of VARIANTS) {
    for (const path of WRITE_PATHS) {
      let logged = 0;
      let correct = 0;
      for (let i = 0; i < REPEAT; i++) {
        const c = variant === 'sau' ? await createContract(db, { userId: 'nv-ban-hang' }, input(variant)) : await createContractTruoc(db, 'nv-ban-hang', input(variant));
        const before = await countLogRows(db, variant, c.id);
        await changeVia(path, variant, { app, db }, c.id);
        const added = (await countLogRows(db, variant, c.id)) - before;
        logged += added === 1 ? 1 : 0;
        if (variant === 'sau' && added === 1) {
          const last = (await rowHistory(db, 'contracts', c.id)).at(-1)!;
          const now = await db.selectFrom('contracts').select('premium').where('id', '=', c.id).executeTakeFirstOrThrow();
          if (last.actor === EXPECTED_ACTOR[path] && last.old_row?.premium === c.premium && last.new_row?.premium === now.premium) correct++;
        }
      }
      coverage.push({ variant, path, changes: REPEAT, logged, correct });
      console.log(`${variant.padEnd(7)} ${path.padEnd(6)} ghi nhật ký ${logged}/${REPEAT}`);
    }
  }

  const one = withDatabase(PGBOUNCER_URL, 'insurance_one');
  for (const [pooler, url] of [['pgbouncer-5', PGBOUNCER_URL], ['pgbouncer-1', one]] as const) {
    for (let run = 1; run <= LEAK_RUNS; run++) {
      for (const method of ['set-session', 'with-actor'] as const) {
        const ids: number[] = [];
        for (let i = 0; i < PARALLEL; i++) ids.push((await createContract(db, { userId: 'nv-ban-hang' }, input('leak'))).id);
        // ok = câu UPDATE chạy được; rejected = rơi vào kết nối thật chưa có app.user_id nên trigger từ chối (fail closed).
        let ok: boolean[] = ids.map(() => true);
        if (method === 'set-session') {
          const pool = new pg.Pool({ connectionString: url, max: PARALLEL });
          ok = await Promise.all(
            ids.map(async (id, i) => {
              const c = await pool.connect();
              try {
                await c.query("SELECT set_config('app.user_id', $1, false)", [`nv-${i}`]);
                await c.query('UPDATE contracts SET premium = premium + 1000 WHERE id = $1', [id]);
                return true;
              } catch (err) {
                if (!/phải đặt app.user_id/.test((err as Error).message)) throw err;
                return false;
              } finally {
                c.release();
              }
            }),
          );
          // Dọn giá trị mức phiên còn sót trên các kết nối thật trước lượt sau.
          await Promise.all(Array.from({ length: 5 }, () => pool.query('RESET app.user_id')));
          await pool.end();
        } else {
          const viaBouncer = createDb(url, PARALLEL);
          await Promise.all(ids.map((id, i) => updateContract(viaBouncer, { userId: `nv-${i}` }, id, { premium: 100_000_000 + i })));
          await viaBouncer.destroy();
        }
        let wrong = 0;
        for (let i = 0; i < ids.length; i++) if (ok[i] && (await rowHistory(db, 'contracts', ids[i]!)).at(-1)!.actor !== `nv-${i}`) wrong++;
        const rejected = ok.filter((x) => !x).length;
        leak.push({ pooler, method, run, wrongActor: wrong, rejected, total: PARALLEL });
        console.log(`${pooler} ${method} lượt ${run}: ${wrong}/${PARALLEL} dòng nhật ký sai người, ${rejected} bị từ chối vì thiếu người thực hiện`);
      }
    }
  }
} finally {
  await app.close();
  await db.destroy();
}

const byVariant = Object.fromEntries(
  VARIANTS.map((v) => {
    const rows = coverage.filter((c) => c.variant === v);
    return [v, { logged: rows.reduce((a, r) => a + r.logged, 0), changes: rows.reduce((a, r) => a + r.changes, 0) }];
  }),
);
console.log(byVariant);
console.log('Đã ghi', save('write-paths.json', { repeat: REPEAT, coverage, byVariant, leak }));
