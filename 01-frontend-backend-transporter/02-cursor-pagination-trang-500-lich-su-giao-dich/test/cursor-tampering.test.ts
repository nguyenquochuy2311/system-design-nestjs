/**
 * Test (c) của mục 8: cursor bị sửa tay (hoặc không phải cursor hợp lệ của phiên bản hiện tại) trả 400,
 * không bao giờ tới database thành một câu SQL lỗi (500) hay một vị trí do client tự chọn.
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CursorPageResponse } from '../src/app.js';
import { createCursorCodec } from '../src/sau/cursor-codec.js';
import type { Database } from '../src/shared/db.js';
import { seedHistory, setupTestDb, TEST_SECRET, testApp } from './support/test-db.js';

let db: Kysely<Database>;
let app: FastifyInstance;
let validCursor: string;

const get = (merchantId: number, cursor: string) =>
  app.inject({ method: 'GET', url: `/merchants/${merchantId}/transactions?limit=20&cursor=${encodeURIComponent(cursor)}` });

/** Ký một payload tùy ý bằng đúng khóa của server: giả lập cursor "thật" của một phiên bản cũ hay lỗi định dạng. */
function signRaw(payload: unknown, secret = TEST_SECRET): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

beforeAll(async () => {
  db = await setupTestDb();
  app = testApp(db);
  await seedHistory(db, 1, 100);
  await seedHistory(db, 2, 100);
  const first = await app.inject({ method: 'GET', url: '/merchants/1/transactions?limit=20' });
  validCursor = first.json<CursorPageResponse>().nextCursor!;
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('cursor hợp lệ', () => {
  it('cursor do server phát lấy được trang 2', async () => {
    const res = await get(1, validCursor);
    expect(res.statusCode).toBe(200);
    expect(res.json<CursorPageResponse>().items).toHaveLength(20);
  });

  it('mã hóa rồi giải mã giữ nguyên created_at tới micro giây và id bigint', () => {
    const codec = createCursorCodec('k');
    const pos = { createdAt: '2026-09-28T23:17:13.920004Z', id: '9007199254740993' };
    expect(codec.decode(7, codec.encode(7, pos))).toEqual(pos);
  });
});

describe('cursor bị sửa tay trả 400', () => {
  it('sửa id trong payload, giữ chữ ký cũ', async () => {
    const [body, mac] = validCursor.split('.') as [string, string];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    const forged = `${Buffer.from(JSON.stringify({ ...payload, i: '1' })).toString('base64url')}.${mac}`;
    const res = await get(1, forged);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_cursor' });
  });

  it('ký bằng khóa khác', async () => {
    const [body] = validCursor.split('.') as [string];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
    expect((await get(1, signRaw(payload, 'khoa-khac'))).statusCode).toBe(400);
  });

  it.each(['abc', '', '.', 'a.b.c', `${'x'.repeat(30)}.${'y'.repeat(43)}`])('chuỗi rác %j', async (garbage) => {
    expect((await get(1, garbage)).statusCode).toBe(400);
  });

  it('cursor của merchant 2 đem dùng cho merchant 1', async () => {
    const page = await app.inject({ method: 'GET', url: '/merchants/2/transactions?limit=20' });
    expect((await get(1, page.json<CursorPageResponse>().nextCursor!)).statusCode).toBe(400);
  });
});

describe('cursor ký đúng khóa nhưng sai phiên bản hoặc định dạng trả 400, không thành lỗi 500 ở database', () => {
  it.each([
    ['phiên bản cũ v0', { v: 0, m: 1, t: '2026-09-01T00:00:00.000000Z', i: '5' }],
    ['created_at không phải ISO micro giây', { v: 1, m: 1, t: '2026-09-01 00:00:00+00', i: '5' }],
    ['created_at sai ngày', { v: 1, m: 1, t: '2026-13-45T25:61:00.000000Z', i: '5' }],
    ['id không phải số', { v: 1, m: 1, t: '2026-09-01T00:00:00.000000Z', i: "5'; DROP TABLE transactions; --" }],
    ['id 20 chữ số', { v: 1, m: 1, t: '2026-09-01T00:00:00.000000Z', i: '99999999999999999999' }],
    ['id 19 chữ số nhưng vượt bigint', { v: 1, m: 1, t: '2026-09-01T00:00:00.000000Z', i: '9999999999999999999' }],
    ['thiếu trường', { v: 1, m: 1 }],
  ])('%s', async (_name, payload) => {
    const res = await get(1, signRaw(payload));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_cursor' });
  });
});
