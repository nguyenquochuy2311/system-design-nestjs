import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROME_IMG_ACCEPT, rawGet, startApi, type Proc } from './support/lab';

// Hai instance là hai tiến trình riêng (khác pid, khởi động lệch nhau), giống hai máy sau load balancer: cùng nội dung
// phải cùng ETag, nếu không thì CDN hay trình duyệt hỏi lại instance kia sẽ không bao giờ nhận 304.
describe('bản sau: hai instance trả cùng ETag cho cùng nội dung', () => {
  let a: Proc;
  let b: Proc;
  beforeAll(async () => {
    a = await startApi('sau', 3101);
    await sleep(1_100); // lệch thời điểm khởi động hơn 1 giây để lộ ETag nào dựa vào thời gian
    b = await startApi('sau', 3102);
  });
  afterAll(async () => {
    await a?.stop();
    await b?.stop();
  });

  const cases: [string, Record<string, string>][] = [
    ['/api/products?category=dong-ho', {}],
    ['/api/products/80', {}],
    ['/media/80/thumb?v=1', { Accept: CHROME_IMG_ACCEPT }],
    ['/media/80/thumb?v=1', { Accept: 'image/jpeg' }],
  ];

  it.each(cases)('%s (%o): ETag giống nhau và ETag của instance A làm instance B trả 304', async (path, headers) => {
    expect(a.pid).not.toBe(b.pid);
    const ra = await rawGet(`http://127.0.0.1:3101${path}`, headers);
    const rb = await rawGet(`http://127.0.0.1:3102${path}`, headers);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(ra.header('etag')).toBeTruthy();
    expect(rb.header('etag')).toBe(ra.header('etag'));
    const cross = await rawGet(`http://127.0.0.1:3102${path}`, { ...headers, 'If-None-Match': ra.header('etag')! });
    expect(cross.status).toBe(304);
  });
});
