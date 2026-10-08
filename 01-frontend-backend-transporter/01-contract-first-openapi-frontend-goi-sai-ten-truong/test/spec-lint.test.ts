import { describe, expect, it } from 'vitest';
import { lintSpec } from '../packages/api-contract/ci/steps.js';
import { writeSpecVariant } from './support/spec-edit.js';

describe('bước lint: Spectral (spectral:oas + luật của đội)', () => {
  it('spec hiện tại không có lỗi hay cảnh báo', () => {
    const r = lintSpec();
    expect(r.exitCode, r.output).toBe(0);
  });

  it('thêm trường snake_case (phone_number) → lint đỏ đúng ở trường đó', () => {
    const rev = writeSpecVariant('snake', (s) => {
      s.components.schemas.Customer.properties.phone_number = { type: 'string', description: 'Sai quy ước.' };
    });
    const r = lintSpec(rev);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('property-names-camel-case');
    expect(r.output).toContain('components.schemas.Customer.properties.phone_number');
  });

  it('response lỗi viết inline, không dùng ErrorResponse chung → lint đỏ', () => {
    const rev = writeSpecVariant('inline-error', (s) => {
      s.paths['/customers/{customerId}'].get.responses['404'] = { description: 'Không có' };
    });
    const r = lintSpec(rev);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('error-responses-use-error-schema');
  });
});
