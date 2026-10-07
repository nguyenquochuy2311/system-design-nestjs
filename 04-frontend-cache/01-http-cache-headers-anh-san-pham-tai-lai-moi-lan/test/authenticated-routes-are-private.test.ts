import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inProcessApi } from './support/lab';
import { listRoutes, scanGuardedRoutes } from './support/route-scan';

// Mục 5: "Số route có xác thực trả public" — quét mọi route có guard, cả lúc đã đăng nhập (response thật) và chưa (401).
describe('bản sau: route có guard không bao giờ cho cache dùng chung lưu', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await inProcessApi('sau');
  });
  afterAll(() => app.close());

  it('phép quét tìm thấy đủ route có guard (không đạt "0 vi phạm" chỉ vì không quét được gì)', () => {
    const guarded = listRoutes(app).filter((r) => r.guards.length > 0);
    expect(guarded.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/account',
      'PUT /api/admin/products/:id/price',
      'GET /api/cart',
      'POST /api/cart/items',
      'GET /api/cart/summary',
      'GET /api/orders',
    ]);
  });

  it('mọi route có guard trả private hoặc no-store, không public, không s-maxage — khi đăng nhập và khi chưa', async () => {
    const results = await scanGuardedRoutes(app);
    expect(results.length).toBe(12);
    // khi đã đăng nhập phải là response thật, không phải lỗi: kiểm đúng header của dữ liệu riêng
    for (const r of results.filter((x) => x.authenticated)) expect(r.status, r.route).toBeLessThan(300);
    for (const r of results.filter((x) => !x.authenticated)) expect(r.status, r.route).toBe(401);
    expect(results.filter((r) => r.violation)).toEqual([]);
  });

  it('route công khai được CDN lưu không gửi Set-Cookie (nhiều CDN bỏ qua cache khi có Set-Cookie)', async () => {
    const server = app.getHttpServer();
    for (const path of ['/api/products?category=laptop', '/api/products/1', '/media/1/thumb?v=1']) {
      const res = await request(server).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers['set-cookie'], path).toBeUndefined();
    }
  });
});

describe('bản trước: phép quét bắt được route lỡ public', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await inProcessApi('truoc');
  });
  afterAll(() => app.close());

  it('chỉ ra đúng GET /api/cart/summary khi đã đăng nhập (public, max-age=30)', async () => {
    const results = await scanGuardedRoutes(app);
    expect(results.length).toBe(12);
    const violations = results.filter((r) => r.violation);
    expect(violations.map((v) => [v.route, v.authenticated, v.cacheControl])).toEqual([['GET /api/cart/summary', true, 'public, max-age=30']]);
  });
});
