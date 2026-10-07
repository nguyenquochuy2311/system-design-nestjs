import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DIRECT_URL, PGBOUNCER_URLS, withDatabase } from '../src/shared/config';
import { transfer } from '../src/shared/transfer';
import { adminClient, createWallets, settle } from './helpers';

// Database "wallet_one" của PgBouncer chỉ có 1 kết nối thật: mọi client dùng chung đúng một phiên PostgreSQL,
// nên thấy được chắc chắn trạng thái phiên có rò hay không (với pool 10 thì rò ngẫu nhiên, khó thấy hơn chứ không hết).
const ONE_URL = withDatabase(PGBOUNCER_URLS[0]!, 'wallet_one');

let admin: pg.Client;
let wallets: number[];
const clients: pg.Client[] = [];

async function connect(url: string, name: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url, application_name: name });
  await c.connect();
  clients.push(c);
  return c;
}

async function currentUserId(c: pg.Client): Promise<string | null> {
  const { rows } = await c.query<{ v: string | null }>("SELECT current_setting('app.user_id', true) AS v");
  return rows[0]!.v;
}

/** Request "quên" đặt app.user_id: created_by lấy theo DEFAULT current_setting('app.user_id'). */
function insertTransferWithoutUser(c: pg.Client) {
  return c.query<{ created_by: string }>('INSERT INTO transfers (from_wallet_id, to_wallet_id, amount) VALUES ($1, $2, 1) RETURNING created_by', [
    wallets[0],
    wallets[1],
  ]);
}

beforeAll(async () => {
  admin = await adminClient();
  wallets = await createWallets(admin, 2);
});
beforeEach(async () => {
  // Xóa giá trị còn sót trên kết nối thật dùng chung từ test trước.
  const c = await connect(ONE_URL, 'reset');
  await c.query('RESET app.user_id');
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()));
  await admin.end();
});

describe('trạng thái phiên qua PgBouncer transaction mode', () => {
  it('SET mức phiên của client A rò sang client B: sổ chuyển tiền của B ghi sai người tạo là A', async () => {
    const a = await connect(ONE_URL, 'nv-A');
    const b = await connect(ONE_URL, 'nv-B');
    await a.query("SELECT set_config('app.user_id', 'nv-A', false)"); // = SET app.user_id = 'nv-A' (không LOCAL)

    expect(await currentUserId(b)).toBe('nv-A');
    const { rows } = await insertTransferWithoutUser(b);
    expect(rows[0]!.created_by).toBe('nv-A'); // B chưa hề nói mình là ai, sổ ghi là A
  });

  it('SET LOCAL trong transaction: hết transaction là hết, B không thấy, và quên đặt thì lỗi ngay', async () => {
    const a = await connect(ONE_URL, 'nv-A');
    const b = await connect(ONE_URL, 'nv-B');
    await a.query('BEGIN');
    await a.query("SELECT set_config('app.user_id', 'nv-A', true)"); // = SET LOCAL
    expect(await currentUserId(a)).toBe('nv-A');
    await a.query('COMMIT');

    expect(await currentUserId(b)).not.toBe('nv-A');
    const insert = await settle(insertTransferWithoutUser(b));
    expect(insert.ok).toBe(false); // CHECK (created_by <> '') chặn, không ghi nhầm người
    expect((insert as { error: { code?: string } }).error.code).toBe('23514');
  });

  it('transfer() đặt người thực hiện bằng SET LOCAL: chuyển xong, client khác trên cùng kết nối thật không thấy', async () => {
    const pool = new pg.Pool({ connectionString: ONE_URL, max: 1 });
    try {
      const done = await transfer(pool, { fromWalletId: wallets[0]!, toWalletId: wallets[1]!, amount: 1, userId: 'nv-transfer' });
      const { rows } = await admin.query('SELECT created_by FROM transfers WHERE id = $1', [done.transferId]);
      expect(rows[0].created_by).toBe('nv-transfer');
    } finally {
      await pool.end();
    }
    const b = await connect(ONE_URL, 'nv-B');
    expect(await currentUserId(b)).not.toBe('nv-transfer');
  });

  it('đối chứng: nối thẳng PostgreSQL (mỗi client một phiên riêng) thì SET của A không sang B', async () => {
    const a = await connect(DIRECT_URL, 'nv-A');
    const b = await connect(DIRECT_URL, 'nv-B');
    await a.query("SELECT set_config('app.user_id', 'nv-A', false)");
    expect(await currentUserId(a)).toBe('nv-A');
    expect(await currentUserId(b)).toBeNull();
  });
});
