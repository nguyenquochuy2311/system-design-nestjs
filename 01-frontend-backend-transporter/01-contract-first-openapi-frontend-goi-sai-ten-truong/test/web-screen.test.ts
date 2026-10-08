/**
 * Triệu chứng của mục 1 và cách pattern chặn nó, nhìn từ màn hình "Chi tiết khách hàng".
 * "Release mới của backend" mô phỏng bằng presenter thay qua DI; đo trên mã nguồn thật ở `bench/breaking-drills.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CustomerPresenter as SauPresenter } from '../apps/backend/src/sau/customer.presenter.js';
import { CustomerPresenter as TruocPresenter } from '../apps/backend/src/truoc/customer.dto.js';
import { CustomerDetail as SauDetail } from '../apps/web/src/sau/customer-detail.js';
import { createApi as createSauApi } from '../apps/web/src/sau/api-client.js';
import { CustomerDetail as TruocDetail } from '../apps/web/src/truoc/customer-detail.js';
import { createApi as createTruocApi } from '../apps/web/src/truoc/api-client.js';
import { SAMPLE_FORM } from '../apps/web/src/shared/new-customer-form.js';
import type { CustomerRecord } from '../apps/backend/src/shared/customer-store.js';
import { startApi, type RunningApi } from './support/app.js';
import { renderFields } from './support/render.js';

let api: RunningApi | undefined;
afterEach(async () => { await api?.close(); api = undefined; });

describe('bản trước: interface viết tay + fetch ép kiểu', () => {
  it('backend chưa đổi: màn hình hiện số điện thoại', async () => {
    api = await startApi('truoc');
    const fields = renderFields(TruocDetail, { customer: await createTruocApi(api.baseUrl).getCustomer('cus_001') });
    expect(fields.phone).toBe('+84281234567');
  });

  it('backend đổi phone thành phoneNumber: không lỗi nào, màn hình báo "Chưa có số điện thoại" dù khách có số', async () => {
    const real = new TruocPresenter();
    const renamed = {
      toDto: (r: CustomerRecord) => {
        const { phone, ...rest } = real.toDto(r) as unknown as Record<string, unknown>;
        return { ...rest, phoneNumber: phone };
      },
    };
    api = await startApi('truoc', [{ provide: TruocPresenter, useValue: renamed }]);
    const customer = await createTruocApi(api.baseUrl).getCustomer('cus_001'); // không ném lỗi: JSON vẫn "là" Customer
    const fields = renderFields(TruocDetail, { customer });
    expect(fields.phone).toBe('Chưa có số điện thoại');
    expect(fields.name).toBe('Công ty CP Minh Long'); // phần còn lại vẫn đúng nên lỗi khó thấy
  });
});

describe('bản sau: client sinh từ spec', () => {
  it('màn hình chi tiết hiện đủ trường từ backend bản sau', async () => {
    api = await startApi('sau');
    const fields = renderFields(SauDetail, { customer: await createSauApi(api.baseUrl).getCustomer('cus_001') });
    expect(fields).toMatchObject({
      avatar: 'CT', name: 'Công ty CP Minh Long', phone: '+84281234567', tier: 'Hạng Vàng', city: '45 Lê Lợi, Hồ Chí Minh',
      tags: 'b2b uu-tien', credit: 'Hạn mức 500.000.000 ₫', created: 'Khách từ 14/3/2025',
    });
  });

  it('form "Thêm khách hàng" gửi body đúng hợp đồng → 201; khách chưa có số điện thoại hiện null đúng nghĩa', async () => {
    api = await startApi('sau');
    const client = createSauApi(api.baseUrl);
    const created = await client.createCustomer({ ...SAMPLE_FORM, phone: '' });
    expect(created.phone).toBeNull();
    expect(renderFields(SauDetail, { customer: created }).phone).toBe('Chưa có số điện thoại');
  });

  it('backend trả lỗi theo ErrorResponse: client nhận mã lỗi có kiểu', async () => {
    api = await startApi('sau');
    await expect(createSauApi(api.baseUrl).getCustomer('cus_999')).rejects.toMatchObject({ status: 404, body: { error: { code: 'NotFound' } } });
  });

  it('presenter đúng spec (đối chứng cho test DI)', async () => {
    api = await startApi('sau', [{ provide: SauPresenter, useValue: new SauPresenter() }]);
    expect((await createSauApi(api.baseUrl).getCustomer('cus_003')).tier).toBe('platinum');
  });
});
