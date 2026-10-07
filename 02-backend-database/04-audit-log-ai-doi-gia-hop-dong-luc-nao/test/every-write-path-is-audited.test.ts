import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDb } from '../src/shared/db';
import { changeVia, countLogRows, EXPECTED_ACTOR, WRITE_PATHS } from '../src/shared/write-paths';
import { findContract } from '../src/sau/contract.repository';
import { rowHistory } from '../src/sau/audit-query';
import { findContractTruoc } from '../src/truoc/contract.repository';
import { createTestContract, SALES, settle } from './helpers';

const db = createDb();
const app = buildApp(db);
const ctx = { app, db };

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('sau: trigger ghi nhật ký cho cả bốn đường ghi', () => {
  for (const path of WRITE_PATHS) {
    it(`đường ${path}: đúng một dòng nhật ký, có giá trị cũ, giá trị mới và người thực hiện "${EXPECTED_ACTOR[path]}"`, async () => {
      const created = await createTestContract(db, 'sau');
      const before = await countLogRows(db, 'sau', created.id);

      await changeVia(path, 'sau', ctx, created.id);

      const now = (await findContract(db, created.id))!;
      expect(await countLogRows(db, 'sau', created.id)).toBe(before + 1);
      const last = (await rowHistory(db, 'contracts', created.id)).at(-1)!;
      expect(last).toMatchObject({ action: 'UPDATE', actor: EXPECTED_ACTOR[path] });
      expect(last.changed_fields).toContain('premium');
      expect(last.old_row!.premium).toBe(created.premium);
      expect(last.new_row!.premium).toBe(now.premium);
      expect(now.premium).not.toBe(created.premium);
      if (path === 'psql') expect(last).toMatchObject({ db_user: 'dba_lan', reason: 'Sửa theo phiếu yêu cầu IT-2041' });
      if (path === 'api') expect(last).toMatchObject({ db_user: 'contract_app', request_id: `req-sau-${created.id}` });
    });
  }

  it('tạo hợp đồng cũng có dòng INSERT với bản mới đầy đủ và người tạo', async () => {
    const created = await createTestContract(db, 'sau');
    const [first] = await rowHistory(db, 'contracts', created.id);
    expect(first).toMatchObject({ action: 'INSERT', actor: SALES, reason: 'Ký hợp đồng mới', old_row: null });
    expect(first!.new_row).toMatchObject({ id: created.id, code: created.code, premium: 120_000_000 });
  });

  it('mọi endpoint ghi lấy người thực hiện từ x-user và request id từ x-request-id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/contracts',
      headers: { 'x-user': 'nv-a', 'x-request-id': 'r-create' },
      payload: { code: `API-${Date.now()}-${Math.random()}`, customerName: 'Công ty X', product: 'Tài sản', premium: 1, sumInsured: 1, startDate: '2026-01-01', endDate: '2026-12-31' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json<{ id: number }>().id;
    const calls = [
      { method: 'PATCH' as const, url: `/contracts/${id}`, headers: { 'x-user': 'nv-b', 'x-request-id': 'r-patch' }, payload: { premium: 2 } },
      { method: 'DELETE' as const, url: `/contracts/${id}`, headers: { 'x-user': 'nv-c', 'x-request-id': 'r-delete' } },
      { method: 'POST' as const, url: `/contracts/${id}/restore`, headers: { 'x-user': 'nv-d', 'x-request-id': 'r-restore' } },
    ];
    for (const call of calls) expect((await app.inject(call)).statusCode).toBeLessThan(300);

    const rows = await rowHistory(db, 'contracts', id);
    expect(rows.map((r) => [r.action, r.actor, r.request_id])).toEqual([
      ['INSERT', 'nv-a', 'r-create'],
      ['UPDATE', 'nv-b', 'r-patch'],
      ['SOFT_DELETE', 'nv-c', 'r-delete'],
      ['RESTORE', 'nv-d', 'r-restore'],
    ]);
  });

  it('request ghi thiếu x-user bị từ chối 400, không ghi gì', async () => {
    const created = await createTestContract(db, 'sau');
    const res = await app.inject({ method: 'PATCH', url: `/contracts/${created.id}`, payload: { premium: 1 } });
    expect(res.statusCode).toBe(400);
    expect((await findContract(db, created.id))!.premium).toBe(created.premium);
  });

  it('fail closed: tài khoản ứng dụng ghi thẳng mà không qua withActor thì trigger từ chối, hợp đồng không đổi', async () => {
    const created = await createTestContract(db, 'sau');
    const direct = await settle(db.updateTable('contracts').set({ premium: 1 }).where('id', '=', created.id).execute());
    expect(direct.ok).toBe(false);
    expect((direct as { error: Error }).error.message).toMatch(/phải đặt app.user_id/);
    expect((await findContract(db, created.id))!.premium).toBe(created.premium);
  });

  it('UPDATE không đổi giá trị nào thì không sinh dòng nhật ký', async () => {
    const created = await createTestContract(db, 'sau');
    const before = await countLogRows(db, 'sau', created.id);
    await db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.user_id', 'nv-noop', true)`.execute(trx);
      await trx.updateTable('contracts').set({ premium: created.premium }).where('id', '=', created.id).execute();
    });
    expect(await countLogRows(db, 'sau', created.id)).toBe(before);
  });
});

describe('trước: UPDATE ghi đè, không đường nào để lại lịch sử', () => {
  it('sau bốn thay đổi chỉ còn giá cuối; updated_by nói "job" dù hai lần sửa sau là script và DBA', async () => {
    const created = await createTestContract(db, 'truoc');
    for (const path of WRITE_PATHS) await changeVia(path, 'truoc', ctx, created.id);

    const now = (await findContractTruoc(db, created.id))!;
    // 120 tr -> api 110 tr -> job × 1,05 = 115,5 tr -> script + 1 tr -> psql - 2 tr = 114,5 tr
    expect(now.premium).toBe(114_500_000);
    expect(now.updatedBy).toBe('job:auto-renewal'); // script và psql không đặt updated_by: "người sửa cuối" sai
    expect(await countLogRows(db, 'truoc', created.id)).toBe(0);
  });
});

describe('phương án so sánh: repository tự ghi nhật ký chỉ bắt được đường đi qua repository', () => {
  it('api và job có nhật ký; script và psql ghi thẳng bảng nên lọt', async () => {
    const logged: Record<string, number> = {};
    for (const path of WRITE_PATHS) {
      const created = await createTestContract(db, 'app-log');
      await changeVia(path, 'app-log', ctx, created.id);
      logged[path] = await countLogRows(db, 'app-log', created.id);
    }
    expect(logged).toEqual({ api: 1, job: 1, script: 0, psql: 0 });
  });
});
