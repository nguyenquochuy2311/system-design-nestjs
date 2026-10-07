import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_TOKEN, CHROME_IMG_ACCEPT, inProcessApi } from './support/lab';

describe('bản sau: request có điều kiện (If-None-Match)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await inProcessApi('sau');
  });
  afterAll(() => app.close());

  it('If-None-Match khớp ETag thì 304 không body; không khớp thì 200 đủ body', async () => {
    const server = app.getHttpServer();
    for (const path of ['/api/products?category=tai-nghe', '/api/products/50']) {
      const first = await request(server).get(path);
      const again = await request(server).get(path).set('If-None-Match', first.headers.etag!);
      expect(again.status, path).toBe(304);
      expect(again.text ?? '', path).toBe('');
      expect(again.headers['content-length'], path).toBeUndefined();
      expect(again.headers['cache-control'], path).toBe('public, max-age=0, s-maxage=60');
      const other = await request(server).get(path).set('If-None-Match', 'W/"khac"');
      expect(other.status, path).toBe(200);
      expect(other.body, path).toEqual(first.body);
    }
  });

  it('ảnh: 304 khi cùng biến thể; ETag của bản WebP không làm bản JPEG thành 304', async () => {
    const server = app.getHttpServer();
    const webp = await request(server).get('/media/50/large?v=1').set('Accept', CHROME_IMG_ACCEPT);
    const again = await request(server).get('/media/50/large?v=1').set('Accept', CHROME_IMG_ACCEPT).set('If-None-Match', webp.headers.etag!);
    expect(again.status).toBe(304);
    expect(again.body).toEqual({});
    const jpeg = await request(server).get('/media/50/large?v=1').set('Accept', 'image/jpeg').set('If-None-Match', webp.headers.etag!);
    expect(jpeg.status).toBe(200);
    expect(jpeg.headers['content-type']).toBe('image/jpeg');
  });

  it('đổi giá thì ETag đổi: ETag cũ nhận 200 với giá mới', async () => {
    const server = app.getHttpServer();
    const before = await request(server).get('/api/products/51');
    await request(server).put('/api/admin/products/51/price').set('X-Admin-Token', ADMIN_TOKEN).send({ price: before.body.price + 10_000 }).expect(200);
    const after = await request(server).get('/api/products/51').set('If-None-Match', before.headers.etag!);
    expect(after.status).toBe(200);
    expect(after.body.price).toBe(before.body.price + 10_000);
    expect(after.headers.etag).not.toBe(before.headers.etag);
  });
});

describe('bản trước: không có validator nên không bao giờ có 304', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await inProcessApi('truoc');
  });
  afterAll(() => app.close());

  it('gửi lại ETag đã từng thấy (ở bản sau) vẫn nhận 200 đủ body', async () => {
    // Không dùng `If-None-Match: *`: theo RFC 9110 `*` khớp mọi bản hiện có, nên Express trả 304 cả khi không có ETag.
    const sau = await inProcessApi('sau');
    const etag = (await request(sau.getHttpServer()).get('/api/products?category=tai-nghe')).headers.etag!;
    await sau.close();
    const res = await request(app.getHttpServer()).get('/api/products?category=tai-nghe').set('If-None-Match', etag);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(24);
  });
});
