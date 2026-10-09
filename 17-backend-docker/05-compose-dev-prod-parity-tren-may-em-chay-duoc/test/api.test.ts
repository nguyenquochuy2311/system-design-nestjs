import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { createDb, KYSELY } from '../src/db/database';
import { runMigrations } from '../src/db/migrator';
import { testUrls } from './support/db';

// Kiểm đầu cuối: migration bằng chuỗi kết nối migration, rồi API (NestJS thật, HTTP thật) chạy bằng chuỗi kết nối
// ứng dụng. Ở bản sau, đó là role app chỉ có DML: lỗi thiếu quyền (thiếu default privileges...) lộ ra ở đây.
describe('API khách hàng chạy bằng chuỗi kết nối của ứng dụng', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const run = await runMigrations(testUrls().migration);
    expect(run.error, run.error?.message).toBeUndefined();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(KYSELY)
      .useValue(createDb(testUrls().app))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app?.close();
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : undefined };
  };

  it('tạo, đọc, đổi tên, xóa một khách hàng', async () => {
    const created = await call('POST', '/customers', { name: 'Công ty B', email: `b-${Date.now()}@vi-du.test` });
    expect(created.status).toBe(201);
    const id = String(created.body?.id);
    expect((await call('GET', `/customers/${id}`)).body).toMatchObject({ id, name: 'Công ty B' });
    expect((await call('PATCH', `/customers/${id}`, { name: 'Công ty B2' })).body).toMatchObject({ name: 'Công ty B2' });
    expect((await call('DELETE', `/customers/${id}`)).status).toBe(204);
    expect((await call('GET', `/customers/${id}`)).status).toBe(404);
  });

  it('/health trả role và phiên bản server mà API đang nối tới', async () => {
    const r = await call('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ role: expect.any(String), serverVersion: expect.stringMatching(/^\d+\.\d+/) });
  });
});
