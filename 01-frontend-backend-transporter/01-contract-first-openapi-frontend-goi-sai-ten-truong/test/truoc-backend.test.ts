/**
 * Test sẵn có của backend bản trước (code-first): kiểm status và mã, như đội backend thường viết.
 * Đây là bước test duy nhất của CI "trước" cùng với `tsc`; script đo xem nó có chặn được thay đổi phá vỡ nào không.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type RunningApi } from './support/app.js';

let api: RunningApi;
beforeAll(async () => { api = await startApi('truoc'); });
afterAll(async () => { await api.close(); });

describe('backend bản trước', () => {
  it('GET chi tiết khách hàng trả 200 và đúng mã', async () => {
    const res = await fetch(`${api.baseUrl}/customers/cus_001`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('cus_001');
  });

  it('GET danh sách trả 200', async () => {
    const res = await fetch(`${api.baseUrl}/customers?limit=2`);
    expect(res.status).toBe(200);
  });

  it('POST tạo khách hàng trả 201', async () => {
    const res = await fetch(`${api.baseUrl}/customers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Công ty TNHH Hoa Sen', email: 'lienhe@hoasen.example', tier: 'standard', address: { line1: '12 Nguyễn Huệ', city: 'Hồ Chí Minh' } }),
    });
    expect(res.status).toBe(201);
  });
});
