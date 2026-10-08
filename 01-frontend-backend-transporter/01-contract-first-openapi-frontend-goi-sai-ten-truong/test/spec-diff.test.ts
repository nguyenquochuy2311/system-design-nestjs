import { describe, expect, it } from 'vitest';
import { diffSpec, SPEC } from '../packages/api-contract/ci/steps.js';
import { writeSpecVariant } from './support/spec-edit.js';

// oasdiff chạy bằng `docker run` image ghim tag (OASDIFF_IMAGE); cần Docker đang chạy.
describe('bước diff: so spec mới với spec của nhánh chính (oasdiff)', () => {
  it('(b) xóa trường phone khỏi Customer → diff đỏ, chỉ ra phone ở cả 3 API trả Customer', () => {
    const rev = writeSpecVariant('remove-phone', (s) => {
      const c = s.components.schemas.Customer;
      delete c.properties.phone;
      c.required = c.required.filter((f: string) => f !== 'phone');
    });
    const r = diffSpec(SPEC, rev);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('response-required-property-removed');
    expect(r.output.match(/`phone`|phone`/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('(c) thêm trường tùy chọn website ở response → diff xanh (tương thích)', () => {
    const rev = writeSpecVariant('add-optional', (s) => {
      s.components.schemas.Customer.properties.website = { type: 'string', format: 'uri', description: 'Website.' };
    });
    const r = diffSpec(SPEC, rev);
    expect(r.exitCode, r.output).toBe(0);
    expect(r.output).not.toMatch(/\berror\b/);
  });

  it('đổi tên theo hướng mở rộng (thêm phoneNumber, giữ phone deprecated) → diff xanh', () => {
    const rev = writeSpecVariant('expand-phone', (s) => {
      const c = s.components.schemas.Customer;
      c.properties.phone.deprecated = true;
      c.properties.phoneNumber = { type: ['string', 'null'], description: 'Số điện thoại E.164 (thay cho phone).' };
    });
    expect(diffSpec(SPEC, rev).exitCode).toBe(0);
  });

  it('thiếu cờ --fail-on ERR thì oasdiff in lỗi nhưng thoát 0 (CI sẽ xanh nhầm)', () => {
    const rev = writeSpecVariant('remove-phone-nofail', (s) => {
      const c = s.components.schemas.Customer;
      delete c.properties.phone;
      c.required = c.required.filter((f: string) => f !== 'phone');
    });
    const r = diffSpec(SPEC, rev, { failOn: false });
    expect(r.output).toContain('response-required-property-removed');
    expect(r.exitCode).toBe(0);
  });
});
