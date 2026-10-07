import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { classifyDbError } from '../src/shared/db-errors';
import { PGBOUNCER_URLS, withDatabase } from '../src/shared/config';
import { createPooledPool, POOL_CONNECTION_TIMEOUT_MS } from '../src/sau/db-pool';
import { createDirectPool } from '../src/truoc/db-pool';
import { settle, sleep } from './helpers';

const ONE_URL = withDatabase(PGBOUNCER_URLS[0]!, 'wallet_one');

describe('khi nghẽn, request lỗi nhanh theo timeout thay vì treo', () => {
  it('sau: pool của pod hết 10 kết nối thì request thứ 11 lỗi db_pool_timeout sau khoảng 2 giây', async () => {
    const pool = createPooledPool(0);
    const held = await Promise.all(Array.from({ length: 10 }, () => pool.connect()));
    try {
      const started = Date.now();
      const r = await settle(pool.query('SELECT 1'));
      const waited = Date.now() - started;
      expect(r.ok).toBe(false);
      expect(classifyDbError((r as { error: unknown }).error)).toBe('db_pool_timeout');
      expect(waited).toBeGreaterThanOrEqual(POOL_CONNECTION_TIMEOUT_MS - 100);
      expect(waited).toBeLessThan(POOL_CONNECTION_TIMEOUT_MS + 1500);
    } finally {
      held.forEach((c) => c.release());
      await pool.end();
    }
  });

  it('trước: pool mặc định (connectionTimeoutMillis = 0) thì request thứ 21 vẫn đang chờ sau 3 giây', async () => {
    const pool = createDirectPool(0);
    const held = await Promise.all(Array.from({ length: 20 }, () => pool.connect()));
    try {
      const pending = pool.query('SELECT 1');
      const first = await Promise.race([pending.then(() => 'xong'), sleep(3000).then(() => 'vẫn chờ')]);
      expect(first).toBe('vẫn chờ');
      held.pop()!.release(); // trả một kết nối thì request mới chạy được
      await expect(pending).resolves.toBeDefined();
    } finally {
      held.forEach((c) => c.release());
      await pool.end();
    }
  });

  it('sau: PgBouncer hết kết nối thật thì timeout của pool phía app vô dụng; query_wait_timeout (5 s) mới cắt', async () => {
    // Giữ kết nối thật duy nhất của wallet_one bằng một transaction chưa kết thúc (như request gọi API ngoài trong transaction).
    const holder = new pg.Client({ connectionString: ONE_URL, application_name: 'holder' });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT 1');

    const pool = new pg.Pool({ connectionString: ONE_URL, max: 1, connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS });
    pool.on('error', () => undefined); // PgBouncer đóng kết nối sau khi báo lỗi: không để tiến trình test chết
    try {
      const t0 = Date.now();
      const client = await pool.connect(); // tới PgBouncer: xong ngay, chưa cần kết nối thật
      const connectMs = Date.now() - t0;
      expect(connectMs).toBeLessThan(1000);

      const t1 = Date.now();
      const r = await settle(client.query('SELECT 1')); // chờ trong hàng đợi của PgBouncer
      const waited = Date.now() - t1;
      client.release(true);
      expect(r.ok).toBe(false);
      expect(classifyDbError((r as { error: unknown }).error)).toBe('pooler_wait_timeout');
      expect(waited).toBeGreaterThan(POOL_CONNECTION_TIMEOUT_MS); // đã quá timeout của pool phía app mà vẫn chờ
      expect(waited).toBeGreaterThanOrEqual(4500);
      expect(waited).toBeLessThan(9000);
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
      await pool.end();
    }
  });
});
