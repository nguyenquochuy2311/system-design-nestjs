import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContractValidator } from '../packages/api-contract/index.js';
import { startApi, type RunningApi } from './support/app.js';
import { CASES, runCase } from './support/contract-cases.js';

// Bước 3 của CI: chạy riêng được bằng `vitest run test/customers-contract.test.ts`.
const contract = createContractValidator();
let api: RunningApi;
beforeAll(async () => { api = await startApi('sau'); });
afterAll(async () => { await api.close(); });

describe('test hợp đồng backend (bản sau) theo openapi.yaml', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s: status và body khớp spec', async (_name, c) => {
    const result = await runCase(api.baseUrl, contract, c);
    expect(result.errors, `${result.request} → ${result.status}`).toEqual([]);
  });

  it('mọi operation và mọi status khai báo trong spec đều có test hợp đồng', () => {
    const declared = contract.operations().flatMap((op) =>
      Object.keys((op.operation.responses ?? {}) as object).map((s) => `${op.operationId} ${s}`));
    const covered = new Set(CASES.map((c) => `${c.operationId} ${c.status}`));
    expect(declared.filter((d) => !covered.has(d))).toEqual([]);
  });
});
