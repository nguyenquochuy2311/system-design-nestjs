import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import pg from 'pg';
import { LAB_DIR, OPS_SCRIPT_URL } from './config';
import type { Database } from './db';
import { runRenewalJob, RENEWAL_ACTOR } from '../sau/renewal.job';
import { renewContractTruoc } from '../truoc/contract.repository';
import { renewContractAppLogged } from '../truoc/contract.app-logged.repository';

/**
 * Bốn đường thay đổi một hợp đồng ở mục 1 README, cho cả ba phiên bản. Test và bench/write-paths-coverage.ts
 * dùng chung để đếm: thay đổi qua đường nào thì có dòng nhật ký.
 *   api    : PATCH /contracts/:id qua route Fastify thật (app.inject), tài khoản contract_app
 *   job    : job gia hạn tự động, tài khoản contract_app
 *   script : script sửa dữ liệu nối thẳng DB bằng tài khoản ops_script, KHÔNG đặt người thực hiện
 *   psql   : DBA gõ lệnh trong psql (docker compose exec), tài khoản dba_lan, có đặt app.reason
 */
export const WRITE_PATHS = ['api', 'job', 'script', 'psql'] as const;
export type WritePath = (typeof WRITE_PATHS)[number];
export const VARIANTS = ['truoc', 'app-log', 'sau'] as const;
export type Variant = (typeof VARIANTS)[number];

/** Người thực hiện mà nhật ký "sau" phải ghi cho từng đường. */
export const EXPECTED_ACTOR: Record<WritePath, string> = {
  api: 'nv-tham-dinh',
  job: RENEWAL_ACTOR,
  script: 'db:ops_script',
  psql: 'db:dba_lan',
};

const run = promisify(execFile);

/** Chạy SQL bằng psql trong container postgres, đúng như DBA gõ tay. */
export async function psqlAs(user: string, statement: string): Promise<string> {
  const { stdout } = await run('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', user, '-d', 'insurance', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement], {
    cwd: LAB_DIR,
  });
  return stdout;
}

export async function changeVia(path: WritePath, variant: Variant, ctx: { app: FastifyInstance; db: Kysely<Database> }, id: number): Promise<void> {
  const schema = variant === 'sau' ? 'public' : 'truoc';
  switch (path) {
    case 'api': {
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `/contracts/${id}?mode=${variant}`,
        headers: { 'x-user': EXPECTED_ACTOR.api, 'x-request-id': `req-${variant}-${id}` },
        payload: { premium: 110_000_000, reason: 'Giảm phí theo kết quả thẩm định rủi ro' },
      });
      if (res.statusCode !== 200) throw new Error(`api: PATCH hợp đồng ${id} trả ${res.statusCode}: ${res.body}`);
      return;
    }
    case 'job':
      if (variant === 'sau') await runRenewalJob(ctx.db, [id], `run-${id}`);
      else if (variant === 'app-log') await renewContractAppLogged(ctx.db, RENEWAL_ACTOR, id);
      else await renewContractTruoc(ctx.db, RENEWAL_ACTOR, id);
      return;
    case 'script': {
      // Script "cộng bù phí do lỗi tính phí": viết vội, ghi thẳng bảng, không đặt người thực hiện hay updated_by.
      const client = new pg.Client({ connectionString: OPS_SCRIPT_URL, application_name: 'fix-premium-script' });
      await client.connect();
      try {
        const res = await client.query(`UPDATE ${schema}.contracts SET premium = premium + 1000000 WHERE id = $1`, [id]);
        if (res.rowCount !== 1) throw new Error(`script: không cập nhật được hợp đồng ${id}`);
      } finally {
        await client.end();
      }
      return;
    }
    case 'psql':
      // DBA sửa theo phiếu yêu cầu: đặt lý do (quy trình đề ra), không đặt app.user_id (tên tài khoản DB là đủ).
      await psqlAs(
        'dba_lan',
        `BEGIN; SELECT set_config('app.reason', 'Sửa theo phiếu yêu cầu IT-2041', true); ` +
          `UPDATE ${schema}.contracts SET premium = premium - 2000000 WHERE id = ${Number(id)}; COMMIT;`,
      );
      return;
  }
}

/** Số dòng nhật ký đang có cho hợp đồng `id` theo từng phiên bản. "truoc" không có nơi nào lưu lịch sử. */
export async function countLogRows(db: Kysely<Database>, variant: Variant, id: number): Promise<number> {
  if (variant === 'truoc') return 0;
  const q =
    variant === 'sau'
      ? sql<{ n: number }>`SELECT count(*)::int AS n FROM audit.audit_log WHERE table_name = 'contracts' AND row_id = ${id}`
      : sql<{ n: number }>`SELECT count(*)::int AS n FROM truoc.app_audit_log WHERE contract_id = ${id}`;
  const { rows } = await q.execute(db);
  return rows[0]!.n;
}
