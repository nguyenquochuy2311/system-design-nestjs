import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGBOUNCER_ADMIN_URLS, PGBOUNCER_URLS, withDatabase } from '../src/shared/config';
import { adminClient, createWallets, settle } from './helpers';

// node-postgres chỉ dùng prepared statement CÓ TÊN khi truyền { name } (Kysely và query thường dùng statement không tên).
// Hai client dùng cùng một kết nối thật (wallet_one, pool_size = 1) và cùng tên statement.
const ONE_URL = withDatabase(PGBOUNCER_URLS[0]!, 'wallet_one');

let walletId: number;
const clients: pg.Client[] = [];

async function connect(name: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: ONE_URL, application_name: name });
  await c.connect();
  clients.push(c);
  return c;
}

async function setMaxPreparedStatements(value: number): Promise<void> {
  const a = new pg.Client({ connectionString: PGBOUNCER_ADMIN_URLS[0]! });
  await a.connect();
  await a.query(`SET max_prepared_statements = ${value}`);
  await a.end();
}

function balanceQuery(name: string) {
  return { name, text: 'SELECT balance FROM wallets WHERE id = $1', values: [walletId] };
}

beforeAll(async () => {
  const admin = await adminClient();
  walletId = (await createWallets(admin, 1))[0]!;
  await admin.end();
});
afterAll(async () => {
  await setMaxPreparedStatements(200); // trả lại cấu hình trong pgbouncer.ini dù test lỗi giữa chừng
  await Promise.all(clients.map((c) => c.end()));
});

describe('prepared statement có tên qua PgBouncer transaction mode', () => {
  it('PgBouncer 1.26, max_prepared_statements = 200: hai client cùng tên statement trên một kết nối thật vẫn chạy đúng', async () => {
    const name = `wallet-balance-${randomUUID()}`;
    const a = await connect('A');
    const b = await connect('B');
    for (let i = 0; i < 3; i++) {
      expect((await a.query(balanceQuery(name))).rowCount).toBe(1);
      expect((await b.query(balanceQuery(name))).rowCount).toBe(1);
    }
  });

  it('phép thử âm: max_prepared_statements = 0 (hành vi trước 1.21) thì client B báo statement đã tồn tại', async () => {
    await setMaxPreparedStatements(0);
    try {
      const name = `wallet-balance-${randomUUID()}`;
      const a = await connect('A0');
      const b = await connect('B0');
      expect((await a.query(balanceQuery(name))).rowCount).toBe(1); // A tạo statement trên kết nối thật dùng chung
      const r = await settle(b.query(balanceQuery(name))); // B tạo cùng tên trên cùng kết nối thật
      expect(r.ok).toBe(false);
      expect((r as { error: { code?: string } }).error.code).toBe('42P05'); // duplicate_prepared_statement
    } finally {
      await setMaxPreparedStatements(200);
    }
  });
});
