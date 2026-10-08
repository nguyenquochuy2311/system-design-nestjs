/**
 * "Người dùng mở màn hình": dựng backend (bản truoc/sau) với mã nguồn hiện tại trên đĩa, web gọi API,
 * render màn hình Chi tiết khách hàng và gửi form Thêm khách hàng. In một dòng JSON.
 *   tsx bench/runtime-probe.ts truoc
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { SAMPLE_FORM } from '../apps/web/src/shared/new-customer-form.js';
import { renderFields } from '../test/support/render.js';

const variant = process.argv[2] === 'sau' ? 'sau' : 'truoc';
const mod = variant === 'truoc'
  ? (await import('../apps/backend/src/truoc/app.module.js')).TruocAppModule
  : (await import('../apps/backend/src/sau/app.module.js')).SauAppModule;
const web = variant === 'truoc'
  ? { ...(await import('../apps/web/src/truoc/api-client.js')), ...(await import('../apps/web/src/truoc/customer-detail.js')) }
  : { ...(await import('../apps/web/src/sau/api-client.js')), ...(await import('../apps/web/src/sau/customer-detail.js')) };

const app = await NestFactory.create(mod, { logger: false });
await app.listen(0, '127.0.0.1');
const baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
const api = web.createApi(baseUrl);
const out: { ok: boolean; fields?: Record<string, string>; createStatus?: number; error?: string } = { ok: true };
try {
  const customer = await api.getCustomer('cus_001');
  // Hai bản có type Customer khác nhau; probe chỉ đọc HTML nên bỏ qua kiểm kiểu ở đây.
  out.fields = renderFields(web.CustomerDetail as never, { customer } as never);
} catch (err) {
  out.ok = false;
  out.error = `màn hình chi tiết: ${(err as Error).message}`;
}
try {
  await api.createCustomer(SAMPLE_FORM);
  out.createStatus = 201;
} catch (err) {
  out.ok = false;
  out.createStatus = (err as { status?: number }).status;
  out.error = `${out.error ? `${out.error}; ` : ''}form thêm khách hàng: ${(err as Error).message}`;
}
await app.close();
console.log(JSON.stringify(out));
