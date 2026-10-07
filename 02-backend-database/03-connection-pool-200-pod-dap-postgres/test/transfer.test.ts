import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createPooledPool } from '../src/sau/db-pool';
import { InsufficientFundsError, transfer } from '../src/shared/transfer';
import { adminClient, balances, createWallets, settle } from './helpers';

let admin: pg.Client;
let pool: pg.Pool;

beforeAll(async () => {
  admin = await adminClient();
  pool = createPooledPool(0);
});
afterAll(async () => {
  await pool.end();
  await admin.end();
});

describe('nghiệp vụ chuyển tiền qua PgBouncer', () => {
  it('chuyển 250.000 đồng: trừ ví gửi, cộng ví nhận, ghi sổ đúng người thực hiện', async () => {
    const [from, to] = await createWallets(admin, 2, 1_000_000);
    const result = await transfer(pool, { fromWalletId: from!, toWalletId: to!, amount: 250_000, userId: 'nv-lan' });
    expect(result.fromBalance).toBe(750_000);
    expect(await balances(admin, [from!, to!])).toEqual([750_000, 1_250_000]);
    const { rows } = await admin.query('SELECT created_by, amount FROM transfers WHERE id = $1', [result.transferId]);
    expect(rows[0]).toEqual({ created_by: 'nv-lan', amount: '250000' });
  });

  it('không đủ số dư: báo InsufficientFunds, số dư hai ví giữ nguyên, không ghi sổ', async () => {
    const [to, from] = await createWallets(admin, 2, 1_000); // ví nhận có id nhỏ hơn: bước cộng chạy trước rồi bị rollback
    const r = await settle(transfer(pool, { fromWalletId: from!, toWalletId: to!, amount: 5_000, userId: 'nv-lan' }));
    expect(r.ok).toBe(false);
    expect((r as { error: unknown }).error).toBeInstanceOf(InsufficientFundsError);
    expect(await balances(admin, [to!, from!])).toEqual([1_000, 1_000]);
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM transfers WHERE from_wallet_id = $1', [from]);
    expect(rows[0].n).toBe(0);
  });

  it('300 chuyển khoản đồng thời qua 10 pod, ngược chiều giữa 3 ví: tổng tiền giữ nguyên, không deadlock', async () => {
    const ids = await createWallets(admin, 3, 1_000_000);
    const pods = Array.from({ length: 10 }, (_, i) => createPooledPool(i));
    try {
      const work = Array.from({ length: 300 }, (_, i) => {
        const from = ids[i % 3]!;
        const to = ids[(i + 1 + (i % 2)) % 3]!; // xen kẽ hai chiều
        return settle(transfer(pods[i % 10]!, { fromWalletId: from, toWalletId: to, amount: 1_000, userId: `nv-${i}` }));
      });
      const results = await Promise.all(work);
      expect(results.filter((r) => !r.ok)).toEqual([]);
      const after = await balances(admin, ids);
      expect(after.reduce((s, b) => s + b, 0)).toBe(3_000_000);
    } finally {
      await Promise.all(pods.map((p) => p.end()));
    }
  });

  it('HTTP: 200 khi chuyển được, 400 khi gửi cho chính mình, 404 khi ví không tồn tại', async () => {
    const [from, to] = await createWallets(admin, 2);
    const app = buildApp(pool, { podName: 'pod-0' });
    try {
      const ok = await app.inject({ method: 'POST', url: '/transfers', payload: { fromWalletId: from, toWalletId: to, amount: 1, userId: 'nv-a' } });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['x-pod']).toBe('pod-0');
      const same = await app.inject({ method: 'POST', url: '/transfers', payload: { fromWalletId: from, toWalletId: from, amount: 1, userId: 'nv-a' } });
      expect(same.statusCode).toBe(400);
      const missing = await app.inject({
        method: 'POST',
        url: '/transfers',
        payload: { fromWalletId: from, toWalletId: 2_000_000_000, amount: 1, userId: 'nv-a' },
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
