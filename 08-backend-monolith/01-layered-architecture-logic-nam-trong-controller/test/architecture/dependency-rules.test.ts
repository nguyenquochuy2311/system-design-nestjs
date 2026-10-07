import { cruise, type ICruiseResult } from 'dependency-cruiser';
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options';
import { describe, expect, it } from 'vitest';

// Cùng cấu hình với `pnpm depcruise` (CI). Mỗi vi phạm là một cặp (file nguồn → file đích, luật).
async function violations(paths: string[]) {
  const options = await extractDepcruiseOptions('./.dependency-cruiser.cjs');
  const { output } = await cruise(paths, options);
  return (output as ICruiseResult).summary.violations.map((v) => ({ rule: v.rule.name, from: v.from, to: v.to }));
}

describe('luật hướng phụ thuộc (dependency-cruiser)', () => {
  it('sau: 0 vi phạm', async () => {
    expect(await violations(['src/sau'])).toEqual([]);
  });

  it('trước: controller và job gọi thẳng Kysely, job import từ controller', async () => {
    const found = await violations(['src/truoc']);
    expect(found).toContainEqual({ rule: 'entry-point-not-to-entry-point', from: 'src/truoc/marketplace-sync.job.ts', to: 'src/truoc/orders.controller.ts' });
    expect(found).toContainEqual({ rule: 'entry-point-not-to-data-access', from: 'src/truoc/orders.controller.ts', to: 'src/shared/db.ts' });
    expect(found.filter((v) => v.rule === 'entry-point-not-to-data-access').map((v) => v.from)).toEqual(
      expect.arrayContaining(['src/truoc/orders.controller.ts', 'src/truoc/csv-import.job.ts', 'src/truoc/marketplace-sync.job.ts']),
    );
  });

  it('phép thử âm: controller import repository Kysely, domain import NestJS thì bị báo lỗi', async () => {
    const found = await violations(['test/fixtures/bad-layering']);
    const base = 'test/fixtures/bad-layering/orders';
    expect(found).toContainEqual({
      rule: 'entry-point-not-to-data-access',
      from: `${base}/presentation/orders.controller.ts`,
      to: `${base}/infrastructure/kysely-order-repository.ts`,
    });
    expect(found.some((v) => v.rule === 'domain-stays-pure' && v.from === `${base}/domain/discount-policy.ts`)).toBe(true);
  });
});
