/**
 * Web làm song song với backend: chỉ cần spec, Prism dựng mock server trả `examples` trong spec,
 * client sinh từ spec gọi được ngay và màn hình render được (README mục 2, 3.3).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CustomerDetail } from '../apps/web/src/sau/customer-detail.js';
import { createApi } from '../apps/web/src/sau/api-client.js';
import { SAMPLE_FORM } from '../apps/web/src/shared/new-customer-form.js';
import { LAB_DIR, SPEC } from '../packages/api-contract/ci/steps.js';
import { createContractValidator } from '../packages/api-contract/index.js';
import { renderFields } from './support/render.js';

const PORT = Number(process.env.MOCK_PORT ?? 3101);
let prism: ChildProcess;
let startupMs = 0;

beforeAll(async () => {
  const t0 = performance.now();
  prism = spawn(join(LAB_DIR, 'node_modules/.bin/prism'), ['mock', '--host', '127.0.0.1', '--port', String(PORT), SPEC], { cwd: LAB_DIR });
  let log = '';
  await new Promise<void>((resolve, reject) => {
    const onData = (d: Buffer) => {
      log += d.toString();
      if (log.includes('Prism is listening')) resolve();
      // Chỉ coi cổng bận là lỗi khởi động; cảnh báo khác (ví dụ DEP0169 của Node) không phải lỗi.
      if (/EADDRINUSE/.test(log)) reject(new Error(`Prism không chạy được (cổng ${PORT} bận?):\n${log}`));
    };
    prism.stdout?.on('data', onData);
    prism.stderr?.on('data', onData);
    prism.on('exit', (code) => reject(new Error(`Prism thoát ${code}:\n${log}`)));
  });
  startupMs = performance.now() - t0;
});
afterAll(() => { prism?.kill('SIGTERM'); });

describe('mock server Prism từ openapi.yaml (OpenAPI 3.1)', () => {
  it('màn hình Chi tiết khách hàng chạy trên mock trước khi backend có code', async () => {
    const customer = await createApi(`http://127.0.0.1:${PORT}`).getCustomer('cus_001');
    const fields = renderFields(CustomerDetail, { customer });
    expect(fields.name).toBe('Công ty CP Minh Long'); // lấy từ `examples` trong spec
    expect(fields.phone).toBe('+84281234567');
    expect(createContractValidator().validateResponse('getCustomer', 200, customer)).toEqual([]);
    console.log(`Prism khởi động ${startupMs.toFixed(0)} ms`);
  });

  it('mock kiểm request theo spec: body thiếu trường bắt buộc → 400, body đúng → 201', async () => {
    const bad = await fetch(`http://127.0.0.1:${PORT}/customers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(bad.status).toBe(400);
    const created = await createApi(`http://127.0.0.1:${PORT}`).createCustomer(SAMPLE_FORM);
    expect(created.id).toBeTypeOf('string');
  });
});
