import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PGBOUNCER_URL, withDatabase } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { updateContract } from '../src/sau/contract.repository';
import { rowHistory } from '../src/sau/audit-query';
import { connect, createTestContract, settle } from './helpers';

// Qua PgBouncer chế độ transaction. "insurance_one" chỉ có 1 kết nối thật: mọi client dùng chung đúng một phiên
// PostgreSQL, nên thấy chắc chắn trạng thái phiên có rò hay không (với nhiều kết nối thật thì rò ngẫu nhiên hơn).
const ONE_URL = withDatabase(PGBOUNCER_URL, 'insurance_one');
const direct = createDb(); // tạo dữ liệu thử và đọc nhật ký bằng kết nối thẳng
const clients: pg.Client[] = [];

async function client(url: string, name: string): Promise<pg.Client> {
  const c = await connect(url, name);
  clients.push(c);
  return c;
}

async function lastActor(contractId: number): Promise<string> {
  return (await rowHistory(direct, 'contracts', contractId)).at(-1)!.actor;
}

async function contracts(n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push((await createTestContract(direct, 'sau')).id);
  return ids;
}

beforeEach(async () => {
  // Xóa giá trị phiên còn sót trên kết nối thật dùng chung từ test trước.
  const c = await client(ONE_URL, 'reset');
  await c.query('RESET app.user_id');
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()));
  await direct.destroy();
});

describe('người thực hiện không rò giữa các request khi đi qua pooler', () => {
  it('trước: SET mức phiên ngoài transaction, A và B cùng đặt tên mình, nhưng thay đổi của A bị ghi là của B', async () => {
    const [id] = await contracts(1);
    const a = await client(ONE_URL, 'nv-A');
    const b = await client(ONE_URL, 'nv-B');
    await a.query("SELECT set_config('app.user_id', 'nv-A', false)"); // = SET app.user_id = 'nv-A'
    await b.query("SELECT set_config('app.user_id', 'nv-B', false)"); // cùng kết nối thật: ghi đè giá trị của A
    await a.query('UPDATE contracts SET premium = premium + 1000 WHERE id = $1', [id]);
    expect(await lastActor(id!)).toBe('nv-B'); // nhật ký sai người
  });

  it('trước: 40 request song song đặt người thực hiện bằng SET ngoài transaction: có dòng nhật ký sai người', async () => {
    const ids = await contracts(40);
    const pool = new pg.Pool({ connectionString: ONE_URL, max: 40 });
    let ran: boolean[];
    try {
      // Câu UPDATE có thể rơi vào lúc kết nối thật chưa có tên ai: trigger từ chối (fail closed), không tính là sai người.
      ran = await Promise.all(
        ids.map(async (id, i) => {
          const c = await pool.connect();
          try {
            await c.query("SELECT set_config('app.user_id', $1, false)", [`nv-${i}`]);
            return (await settle(c.query('UPDATE contracts SET premium = premium + 1000 WHERE id = $1', [id]))).ok;
          } finally {
            c.release();
          }
        }),
      );
    } finally {
      await pool.end();
    }
    const wrong = (await Promise.all(ids.map(async (id, i) => ran[i] && (await lastActor(id)) !== `nv-${i}`))).filter(Boolean).length;
    expect(wrong).toBeGreaterThan(0);
  });

  for (const [label, url] of [
    ['PgBouncer 5 kết nối thật', PGBOUNCER_URL],
    ['PgBouncer 1 kết nối thật', ONE_URL],
  ] as const) {
    it(`sau: 40 request song song qua withActor (${label}): mọi dòng nhật ký đúng người gửi`, async () => {
      const ids = await contracts(40);
      const db = createDb(url, 40);
      try {
        await Promise.all(ids.map((id, i) => updateContract(db, { userId: `nv-${i}`, reason: 'song song' }, id, { premium: 100_000_000 + i })));
      } finally {
        await db.destroy();
      }
      const actors = await Promise.all(ids.map((id) => lastActor(id)));
      expect(actors).toEqual(ids.map((_, i) => `nv-${i}`));
    });
  }

  it('sau: hết transaction của withActor, client khác trên cùng kết nối thật không thấy tên cũ; quên đặt thì bị từ chối', async () => {
    const [id] = await contracts(1);
    const db = createDb(ONE_URL, 1);
    try {
      await updateContract(db, { userId: 'nv-A' }, id!, { premium: 99_000_000 });
    } finally {
      await db.destroy();
    }
    const b = await client(ONE_URL, 'nv-B-quen');
    const { rows } = await b.query("SELECT coalesce(current_setting('app.user_id', true), '') AS v");
    expect(rows[0].v).toBe('');
    const forgot = await settle(b.query('UPDATE contracts SET premium = premium + 1000 WHERE id = $1', [id]));
    expect(forgot.ok).toBe(false);
    expect((forgot as { error: Error }).error.message).toMatch(/phải đặt app.user_id/);
    expect(await lastActor(id!)).toBe('nv-A');
  });
});
