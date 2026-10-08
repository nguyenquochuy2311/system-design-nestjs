/**
 * (a) Response thiếu trường bắt buộc làm test hợp đồng đỏ. Mô phỏng "code backend trôi khỏi spec" bằng cách
 * thay presenter qua DI (không chèn móc test vào mã nguồn); script đo `bench/breaking-drills.ts` sửa mã nguồn thật.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CustomerPresenter } from '../apps/backend/src/sau/customer.presenter.js';
import type { CustomerRecord } from '../apps/backend/src/shared/customer-store.js';
import { createContractValidator } from '../packages/api-contract/index.js';
import { startApi, type RunningApi } from './support/app.js';
import { CASES, runCase } from './support/contract-cases.js';

const contract = createContractValidator();
const real = new CustomerPresenter();
let api: RunningApi | undefined;
afterEach(async () => { await api?.close(); api = undefined; });

async function failuresWith(toBody: (r: CustomerRecord) => unknown) {
  api = await startApi('sau', [{ provide: CustomerPresenter, useValue: { toBody } }]);
  const results = await Promise.all(CASES.map((c) => runCase(api!.baseUrl, contract, c)));
  return results.filter((r) => r.errors.length > 0);
}

describe('(a) test hợp đồng bắt response lệch spec', () => {
  it('backend đổi phone thành phoneNumber: thiếu trường bắt buộc phone → đỏ ở cả 3 operation trả Customer', async () => {
    const failed = await failuresWith((r) => {
      // Ép về JSON tùy ý: test không phụ thuộc type của presenter (script đo sửa chính presenter đó).
      const { phone, ...rest } = real.toBody(r) as unknown as Record<string, unknown>;
      return { ...rest, phoneNumber: phone };
    });
    expect(failed.map((f) => f.name)).toEqual(['listCustomers 200', 'getCustomer 200', 'createCustomer 201']);
    for (const f of failed) expect(f.errors.map((e) => e.message).join('\n')).toContain("must have required property 'phone'");
  });

  it('trường còn đó nhưng sai kiểu (tags thành chuỗi) → đỏ, chỉ đúng đường dẫn /tags', async () => {
    const failed = await failuresWith((r) => ({ ...(real.toBody(r) as unknown as Record<string, unknown>), tags: r.tags.join(',') }));
    expect(failed).toHaveLength(3);
    expect(new Set(failed.flatMap((f) => f.errors.map((e) => e.message.replace(/^\/value\/\d+/, ''))))).toEqual(new Set(['/tags must be array']));
  });

  it('presenter đúng spec → không case nào đỏ (đối chứng)', async () => {
    expect(await failuresWith((r) => real.toBody(r))).toEqual([]);
  });
});
