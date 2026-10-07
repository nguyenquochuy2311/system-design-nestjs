import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_TOKEN, CHROME_IMG_ACCEPT, inProcessApi, sessionCookie } from './support/lab';

describe('bản sau: header đúng theo loại tài nguyên', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await inProcessApi('sau');
  });
  afterAll(() => app.close());

  it('JSON công khai: public, max-age=0, s-maxage=60 + ETag yếu', async () => {
    for (const path of ['/api/products?category=laptop', '/api/products/30']) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers['cache-control'], path).toBe('public, max-age=0, s-maxage=60');
      expect(res.headers.etag, path).toMatch(/^W\/"[\w-]{27}"$/);
    }
  });

  it('ảnh: public, max-age=86400, s-maxage=604800 + ETag + Vary: Accept; WebP cho trình duyệt nhận WebP, JPEG cho trình duyệt khác', async () => {
    const webp = await request(app.getHttpServer()).get('/media/30/thumb?v=1').set('Accept', CHROME_IMG_ACCEPT);
    const jpeg = await request(app.getHttpServer()).get('/media/30/thumb?v=1').set('Accept', 'image/jpeg,image/*;q=0.8');
    for (const res of [webp, jpeg]) {
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=86400, s-maxage=604800');
      expect(res.headers.vary).toBe('Accept');
      expect(res.headers.etag).toMatch(/^W\/"[\w-]{27}"$/);
    }
    expect(webp.headers['content-type']).toBe('image/webp');
    expect(jpeg.headers['content-type']).toBe('image/jpeg');
    expect(webp.headers.etag).not.toBe(jpeg.headers.etag);
  });

  it('dữ liệu riêng và thao tác ghi: private, no-store', async () => {
    const server = app.getHttpServer();
    const cart = await request(server).get('/api/cart/summary').set('Cookie', sessionCookie(5));
    const add = await request(server).post('/api/cart/items').set('Cookie', sessionCookie(5)).send({ productId: 3, qty: 1 });
    expect(cart.headers['cache-control']).toBe('private, no-store');
    expect(add.status).toBe(201);
    expect(add.headers['cache-control']).toBe('private, no-store');
    expect(cart.headers.etag).toBeUndefined();
  });

  it('lỗi không mang chính sách của response thành công (CDN không giữ 404/400/401 cho mọi người)', async () => {
    const server = app.getHttpServer();
    const cases = [
      await request(server).get('/api/products/9999'),
      await request(server).get('/api/products/abc'),
      await request(server).get('/media/1/huge'),
      await request(server).get('/api/cart/summary'),
      await request(server).put('/api/admin/products/1/price').set('X-Admin-Token', ADMIN_TOKEN).send({ price: -1 }),
    ];
    expect(cases.map((r) => r.status)).toEqual([404, 400, 404, 401, 400]);
    for (const r of cases) {
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers.etag).toBeUndefined();
    }
  });
});

describe('bản trước: mọi response no-store, không ETag (tái hiện hiện trạng)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await inProcessApi('truoc');
  });
  afterAll(() => app.close());

  it('JSON và ảnh đều no-store, không ETag, không Vary', async () => {
    for (const path of ['/api/products?category=laptop', '/api/products/30', '/media/30/thumb?v=1']) {
      const res = await request(app.getHttpServer()).get(path).set('Accept', CHROME_IMG_ACCEPT);
      expect(res.status, path).toBe(200);
      expect(res.headers['cache-control'], path).toBe('no-store');
      expect(res.headers.etag, path).toBeUndefined();
      expect(res.headers.vary, path).toBeUndefined();
    }
  });
});
