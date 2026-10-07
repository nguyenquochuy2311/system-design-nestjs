import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { ADMIN_URL } from '../src/shared/config';
import { createDb } from '../src/shared/db';
import { psqlAs } from '../src/shared/write-paths';
import { addClaim, createContract, findContract, premiumReport, updateContract } from '../src/sau/contract.repository';
import { rowHistory } from '../src/sau/audit-query';
import { createTestContract, newContractInput, sqlState } from './helpers';

const db = createDb();
const admin = createDb(ADMIN_URL, 2);
const app = buildApp(db);

afterAll(async () => {
  await app.close();
  await Promise.all([db.destroy(), admin.destroy()]);
});

const del = (id: number, user = 'nv-xoa-nham') => app.inject({ method: 'DELETE', url: `/contracts/${id}`, headers: { 'x-user': user }, payload: { reason: 'Hợp đồng trùng' } });
const claimsOf = async (id: number) =>
  Number((await db.selectFrom('claims').select((eb) => eb.fn.countAll<number>().as('n')).where('contract_id', '=', id).executeTakeFirstOrThrow()).n);

describe('soft delete: xóa là đánh dấu, truy vấn thường không thấy, dữ liệu và tham chiếu vẫn còn', () => {
  it('hợp đồng xóa mềm không hiện trong truy vấn thường (GET 404, báo cáo phí) nhưng dòng và hồ sơ bồi thường vẫn còn', async () => {
    const product = `SP-${randomUUID()}`; // sản phẩm riêng để báo cáo chỉ chứa hợp đồng của test này
    const c = await createTestContract(db, 'sau', { product });
    await addClaim(db, { userId: 'nv-boi-thuong' }, c.id, 300_000_000);
    await addClaim(db, { userId: 'nv-boi-thuong' }, c.id, 50_000_000);
    expect(await premiumReport(db, product)).toEqual({ contracts: 1, totalPremium: 120_000_000 });

    expect((await del(c.id)).statusCode).toBe(204);

    expect((await app.inject({ method: 'GET', url: `/contracts/${c.id}` })).statusCode).toBe(404);
    expect(await findContract(db, c.id)).toBeUndefined();
    expect(await premiumReport(db, product)).toEqual({ contracts: 0, totalPremium: 0 });
    const row = await admin.selectFrom('contracts').select(['deleted_at', 'deleted_by']).where('id', '=', c.id).executeTakeFirstOrThrow();
    expect(row.deleted_at).toBeInstanceOf(Date);
    expect(row.deleted_by).toBe('nv-xoa-nham');
    expect(await claimsOf(c.id)).toBe(2); // không mồ côi: vẫn trỏ tới đúng dòng hợp đồng
  });

  it('điểm dễ sai: truy vấn thẳng trên bảng contracts (không qua view) vẫn thấy bản đã xóa mềm', async () => {
    const c = await createTestContract(db, 'sau');
    await del(c.id);
    const raw = await db.selectFrom('contracts').select('id').where('id', '=', c.id).executeTakeFirst();
    expect(raw).toEqual({ id: c.id });
  });

  it('tạo lại hợp đồng cùng mã sau khi xóa mềm thành công; hai hợp đồng còn hiệu lực cùng mã thì bị chặn (409)', async () => {
    const input = newContractInput();
    const first = await createContract(db, { userId: 'nv-ban-hang' }, input);
    await del(first.id);
    const again = await app.inject({ method: 'POST', url: '/contracts', headers: { 'x-user': 'nv-ban-hang' }, payload: input });
    expect(again.statusCode).toBe(201);
    const third = await app.inject({ method: 'POST', url: '/contracts', headers: { 'x-user': 'nv-ban-hang' }, payload: input });
    expect(third.statusCode).toBe(409);
  });

  it('khôi phục: một lệnh, hợp đồng và hồ sơ quay lại, thay đổi khác không mất; nhật ký biết ai xóa, ai khôi phục', async () => {
    const lost = await createTestContract(db, 'sau');
    const other = await createTestContract(db, 'sau');
    await addClaim(db, { userId: 'nv-boi-thuong' }, lost.id, 300_000_000);
    await del(lost.id);
    // Buổi sáng vẫn có người làm việc: thay đổi này không được mất khi khôi phục (khác với khôi phục từ sao lưu).
    await updateContract(db, { userId: 'nv-khac' }, other.id, { premium: 130_000_000 });

    const restored = await app.inject({ method: 'POST', url: `/contracts/${lost.id}/restore`, headers: { 'x-user': 'truong-phong' }, payload: { reason: 'Xóa nhầm' } });
    expect(restored.statusCode).toBe(200);
    expect(await findContract(db, lost.id)).toMatchObject({ id: lost.id, code: lost.code, premium: lost.premium });
    expect(await claimsOf(lost.id)).toBe(1);
    expect((await findContract(db, other.id))!.premium).toBe(130_000_000);

    const history = await rowHistory(db, 'contracts', lost.id);
    expect(history.map((h) => [h.action, h.actor, h.reason])).toEqual([
      ['INSERT', 'nv-ban-hang', 'Ký hợp đồng mới'],
      ['SOFT_DELETE', 'nv-xoa-nham', 'Hợp đồng trùng'],
      ['RESTORE', 'truong-phong', 'Xóa nhầm'],
    ]);
  });

  it('ứng dụng không xóa cứng được nữa (42501); DBA xóa cứng hợp đồng còn hồ sơ bồi thường thì khóa ngoại chặn', async () => {
    const c = await createTestContract(db, 'sau');
    await addClaim(db, { userId: 'nv-boi-thuong' }, c.id, 10_000_000);
    expect(await sqlState(sql`DELETE FROM contracts WHERE id = ${c.id}`.execute(db))).toBe('42501');
    await expect(psqlAs('dba_lan', `DELETE FROM contracts WHERE id = ${c.id}`)).rejects.toThrow(/violates foreign key constraint/);
    expect(await claimsOf(c.id)).toBe(1);
  });

  it('DBA xóa cứng hợp đồng không có hồ sơ: nhật ký giữ bản cũ đầy đủ, khôi phục được từ nhật ký', async () => {
    const c = await createTestContract(db, 'sau');
    await updateContract(db, { userId: 'nv-tham-dinh' }, c.id, { premium: 99_000_000 });
    await psqlAs('dba_lan', `DELETE FROM contracts WHERE id = ${c.id}`);
    expect(await admin.selectFrom('contracts').select('id').where('id', '=', c.id).executeTakeFirst()).toBeUndefined();

    const deleted = (await rowHistory(db, 'contracts', c.id)).at(-1)!;
    expect(deleted).toMatchObject({ action: 'DELETE', actor: 'db:dba_lan', new_row: null });
    await admin.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.user_id', 'dba-khoi-phuc', true)`.execute(trx);
      await sql`INSERT INTO contracts SELECT * FROM jsonb_populate_record(NULL::contracts, ${JSON.stringify(deleted.old_row)}::jsonb)`.execute(trx);
    });
    expect(await findContract(db, c.id)).toMatchObject({ id: c.id, code: c.code, premium: 99_000_000, updatedBy: 'nv-tham-dinh' });
  });
});

describe('trước: xóa cứng', () => {
  it('xóa hợp đồng là mất luôn hồ sơ bồi thường (ON DELETE CASCADE), DB không còn gì để khôi phục', async () => {
    const c = await createTestContract(db, 'truoc');
    await db.withSchema('truoc').insertInto('claims').values({ contract_id: c.id, amount: 300_000_000 }).execute();
    const res = await app.inject({ method: 'DELETE', url: `/contracts/${c.id}?mode=truoc`, headers: { 'x-user': 'nv-xoa-nham' } });
    expect(res.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/contracts/${c.id}?mode=truoc` })).statusCode).toBe(404);
    const claims = await db.withSchema('truoc').selectFrom('claims').select('id').where('contract_id', '=', c.id).execute();
    expect(claims).toEqual([]);
  });
});
