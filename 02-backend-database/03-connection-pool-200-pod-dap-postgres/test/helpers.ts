import pg from 'pg';
import { ADMIN_URL, PGBOUNCER_ADMIN_URLS } from '../src/shared/config';

/** Kết nối superuser (dùng chỗ dành riêng), mở trước khi làm DB đầy để luôn đo được. */
export async function adminClient(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: ADMIN_URL, application_name: 'test-admin' });
  await c.connect();
  return c;
}

/**
 * Số kết nối role ứng dụng còn được mở: max_connections - superuser_reserved_connections - reserved_connections
 * - kết nối của role khác đang mở. PostgreSQL so ngưỡng với TỔNG kết nối đang mở, nên kết nối superuser
 * (chính client đo này) cũng chiếm một chỗ thường: 100 - 3 - 1 = 96 khi chỉ có một client đo.
 */
export async function connectionLimit(admin: pg.Client): Promise<number> {
  const { rows } = await admin.query<{ limit: number }>(
    `SELECT current_setting('max_connections')::int
            - current_setting('superuser_reserved_connections')::int
            - current_setting('reserved_connections')::int
            - (SELECT count(*)::int FROM pg_stat_activity
               WHERE backend_type = 'client backend' AND usename IS DISTINCT FROM 'wallet_app') AS limit`,
  );
  return rows[0]!.limit;
}

/** Kết nối thật của role wallet_app đang mở trên PostgreSQL (từ pod nối thẳng hoặc từ PgBouncer). */
export async function appConnections(admin: pg.Client): Promise<{ total: number; idle: number }> {
  const { rows } = await admin.query<{ total: number; idle: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'idle')::int AS idle
     FROM pg_stat_activity WHERE backend_type = 'client backend' AND usename = 'wallet_app'`,
  );
  return rows[0]!;
}

/** Chạy một promise và lấy mẫu số kết nối thật mỗi 25 ms trong lúc chờ; trả về kết quả và đỉnh. */
export async function sampleWhile<T>(admin: pg.Client, work: Promise<T>): Promise<{ result: T; peak: number }> {
  let peak = 0;
  let done = false;
  const sampler = (async () => {
    while (!done) {
      peak = Math.max(peak, (await appConnections(admin)).total);
      await sleep(25);
    }
  })();
  try {
    const result = await work;
    return { result, peak };
  } finally {
    done = true;
    await sampler;
  }
}

/**
 * Mở từng kết nối một (không ồ ạt) cho tới khi PostgreSQL từ chối: DB đầy đúng tới trần, không bị sai số do
 * các backend đang bị từ chối tạm giữ chỗ. Trả về các kết nối đang giữ (rảnh), như pool của các pod đang chạy.
 */
export async function fillToLimit(pool: pg.Pool): Promise<pg.PoolClient[]> {
  const held: pg.PoolClient[] = [];
  let rejectedInARow = 0;
  for (;;) {
    try {
      held.push(await pool.connect());
      rejectedInARow = 0;
    } catch (err) {
      if ((err as { code?: string }).code !== '53300') {
        held.forEach((c) => c.release());
        throw err;
      }
      // Bị từ chối có thể do một backend vừa đóng chưa thoát hẳn: thử lại vài lần rồi mới coi là đầy.
      if (++rejectedInARow >= 3) return held;
      await sleep(200);
    }
  }
}

/** Chờ các kết nối của test trước thoát hẳn (backend PostgreSQL thoát sau khi client đóng một chút). */
export async function waitForAppConnections(admin: pg.Client, atMost: number, timeoutMs = 5000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { total } = await appConnections(admin);
    if (total <= atMost || Date.now() > deadline) return total;
    await sleep(50);
  }
}

/** Một client tới console quản trị của mỗi instance PgBouncer. */
export async function pgbouncerAdmins(): Promise<pg.Client[]> {
  return Promise.all(
    PGBOUNCER_ADMIN_URLS.map(async (url) => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      return c;
    }),
  );
}

/** Đóng mọi kết nối (client và thật) PgBouncer đang giữ, để số kết nối thật trên PostgreSQL về 0 trước khi đo. */
export async function resetPgBouncers(): Promise<void> {
  const admins = await pgbouncerAdmins();
  try {
    for (const a of admins) {
      for (const db of ['wallet', 'wallet_one']) {
        await a.query(`KILL ${db}`);
        await a.query(`RESUME ${db}`);
      }
    }
  } finally {
    await Promise.all(admins.map((a) => a.end()));
  }
}

/** Tổng default_pool_size của các instance: ngân sách kết nối thật cho database "wallet". */
export async function realConnectionBudget(): Promise<number> {
  const admins = await pgbouncerAdmins();
  try {
    let total = 0;
    for (const a of admins) {
      const { rows } = await a.query<{ key: string; value: string }>('SHOW CONFIG');
      total += Number(rows.find((r) => r.key === 'default_pool_size')!.value);
    }
    return total;
  } finally {
    await Promise.all(admins.map((a) => a.end()));
  }
}

/** Tạo ví riêng cho test (id lớn hơn phần seed), không đụng dữ liệu k6. */
export async function createWallets(admin: pg.Client, count: number, balance = 1_000_000): Promise<number[]> {
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO wallets (owner_name, balance) SELECT 'Test ' || g, $2 FROM generate_series(1, $1) AS g RETURNING id`,
    [count, balance],
  );
  return rows.map((r) => Number(r.id));
}

export async function balances(admin: pg.Client, ids: number[]): Promise<number[]> {
  const { rows } = await admin.query<{ id: string; balance: string }>('SELECT id, balance FROM wallets WHERE id = ANY($1) ORDER BY id', [ids]);
  return ids.map((id) => Number(rows.find((r) => Number(r.id) === id)!.balance));
}

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Đợi một promise và trả về kết quả hoặc lỗi, để đếm "thành công / bị từ chối" khi chạy đồng thời. */
export async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
