import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDb } from '../src/shared/db';
import type { Contract } from '../src/shared/contract';
import type { FieldChange } from '../src/sau/audit-query';
import { newContractInput } from './helpers';

const db = createDb();
const app = buildApp(db);

afterAll(async () => {
  await app.close();
  await db.destroy();
});

/** Kịch bản ở mục 1 README: phí hợp đồng lớn giảm từ 120 triệu xuống 95 triệu qua hai lần sửa. */
async function premiumStory(mode: 'truoc' | 'sau'): Promise<number> {
  const create = await app.inject({
    method: 'POST',
    url: `/contracts?mode=${mode}`,
    headers: { 'x-user': 'nv-ban-hang', 'x-request-id': 'req-ky-moi' },
    payload: { ...newContractInput(), reason: 'Ký hợp đồng mới' },
  });
  expect(create.statusCode).toBe(201);
  const id = create.json<Contract>().id;
  const edits = [
    { user: 'nv-tham-dinh', rid: 'req-tham-dinh', body: { premium: 110_000_000, reason: 'Giảm phí theo kết quả thẩm định rủi ro' } },
    { user: 'nv-van-hanh', rid: 'req-sua-stbh', body: { sumInsured: 85_000_000_000, reason: 'Cập nhật số tiền bảo hiểm' } }, // trường khác
    { user: 'truong-phong-kd', rid: 'req-duyet-95', body: { premium: 95_000_000, reason: 'Duyệt giảm phí khách hàng lớn' } },
  ];
  for (const e of edits) {
    const res = await app.inject({ method: 'PATCH', url: `/contracts/${id}?mode=${mode}`, headers: { 'x-user': e.user, 'x-request-id': e.rid }, payload: e.body });
    expect(res.statusCode).toBe(200);
  }
  return id;
}

describe('câu hỏi của kiểm toán: ai đổi phí hợp đồng X, lúc nào, từ bao nhiêu sang bao nhiêu', () => {
  it('sau: một lần gọi API trả đủ chuỗi thay đổi phí, kèm người, lý do, request id và thời điểm', async () => {
    const id = await premiumStory('sau');
    const res = await app.inject({ method: 'GET', url: `/contracts/${id}/history?field=premium` });
    expect(res.statusCode).toBe(200);
    const history = res.json<FieldChange[]>();

    expect(history.map(({ action, actor, from, to, reason, requestId }) => ({ action, actor, from, to, reason, requestId }))).toEqual([
      { action: 'INSERT', actor: 'nv-ban-hang', from: null, to: 120_000_000, reason: 'Ký hợp đồng mới', requestId: 'req-ky-moi' },
      { action: 'UPDATE', actor: 'nv-tham-dinh', from: 120_000_000, to: 110_000_000, reason: 'Giảm phí theo kết quả thẩm định rủi ro', requestId: 'req-tham-dinh' },
      { action: 'UPDATE', actor: 'truong-phong-kd', from: 110_000_000, to: 95_000_000, reason: 'Duyệt giảm phí khách hàng lớn', requestId: 'req-duyet-95' },
    ]);
    const times = history.map((h) => Date.parse(h.changedAt));
    expect(times.every((t, i) => i === 0 || t >= times[i - 1]!)).toBe(true);
  });

  it('sau: lần sửa trường khác (số tiền bảo hiểm) không lẫn vào lịch sử phí nhưng có trong lịch sử của trường đó', async () => {
    const id = await premiumStory('sau');
    const res = await app.inject({ method: 'GET', url: `/contracts/${id}/history?field=sum_insured` });
    const changes = res.json<FieldChange[]>().filter((h) => h.action === 'UPDATE');
    expect(changes).toEqual([expect.objectContaining({ actor: 'nv-van-hanh', from: 80_000_000_000, to: 85_000_000_000 })]);
  });

  it('trước: DB chỉ còn giá mới và người sửa cuối; 120 triệu, 110 triệu và người duyệt trung gian đã mất', async () => {
    const id = await premiumStory('truoc');
    const res = await app.inject({ method: 'GET', url: `/contracts/${id}?mode=truoc` });
    expect(res.json<Contract>()).toMatchObject({ premium: 95_000_000, updatedBy: 'truong-phong-kd' });
    // Không có bảng nào khác lưu lịch sử của schema truoc ngoài app_audit_log, và chế độ truoc không ghi vào đó.
    const logged = await db
      .withSchema('truoc')
      .selectFrom('app_audit_log')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('contract_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(Number(logged.n)).toBe(0);
  });
});
