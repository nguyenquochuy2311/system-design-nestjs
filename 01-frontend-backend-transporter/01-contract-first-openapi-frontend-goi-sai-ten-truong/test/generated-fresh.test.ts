import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateTypes, GENERATED, LAB_DIR, SPEC } from '../packages/api-contract/ci/steps.js';
import { writeSpecVariant } from './support/spec-edit.js';

// schema.d.ts được commit để web biên dịch được ngay sau khi clone; đổi lại, CI phải kiểm nó khớp spec.
describe('type sinh ra khớp spec', () => {
  it('sinh lại generated/schema.d.ts từ openapi.yaml không tạo khác biệt', () => {
    const out = `.tmp/schema-fresh-${process.pid}.d.ts`;
    const r = generateTypes(SPEC, out);
    expect(r.exitCode, r.output).toBe(0);
    expect(readFileSync(join(LAB_DIR, out), 'utf8')).toBe(readFileSync(join(LAB_DIR, GENERATED), 'utf8'));
  });

  it('OpenAPI 3.1: type [string, "null"] sinh ra `string | null`, trường tùy chọn sinh ra `?:`', () => {
    const generated = readFileSync(join(LAB_DIR, GENERATED), 'utf8');
    expect(generated).toMatch(/\n\s+phone: string \| null;/); // Customer: bắt buộc, có thể null
    expect(generated).toMatch(/\n\s+phone\?: string \| null;/); // CreateCustomerRequest: tùy chọn
  });

  it('spec đổi mà quên sinh lại → phát hiện được (file cũ khác file sinh từ spec mới)', () => {
    const rev = writeSpecVariant('stale', (s) => {
      s.components.schemas.Customer.properties.website = { type: 'string', description: 'Website.' };
    });
    const out = `.tmp/schema-stale-${process.pid}.d.ts`;
    expect(generateTypes(rev, out).exitCode).toBe(0);
    expect(readFileSync(join(LAB_DIR, out), 'utf8')).not.toBe(readFileSync(join(LAB_DIR, GENERATED), 'utf8'));
  });
});
