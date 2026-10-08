import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/shared/config';
import type { Site } from '../web/releases';

const tmp = mkdtempSync(join(tmpdir(), 'lab-04-02-api-'));
let app: NestExpressApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function apiAt(site: Site, logFile?: string) {
  app = await createApp(loadConfig({ SITE: site, RELEASE: '42', REQUEST_LOG: logFile ?? '' }));
  await app.init();
  return app.getHttpServer();
}

describe('API trong thời gian chuyển tiếp (bản 42 đổi hợp đồng)', () => {
  it('bản sau: client bản 41 gửi ghi chú ở trường cũ `text` vẫn được lưu; response mang cả name lẫn displayName', async () => {
    const http = await apiAt('sau');
    const saved = await request(http).post('/api/contacts/5/notes').set('X-App-Version', '41').send({ text: 'Hẹn gọi lại thứ Hai' });
    expect(saved.status).toBe(201);
    const notes = (await request(http).get('/ops/notes?contactId=5')).body as { body: string; lost: boolean }[];
    expect(notes.at(-1)).toMatchObject({ body: 'Hẹn gọi lại thứ Hai', lost: false });
    const list = (await request(http).get('/api/contacts')).body as Record<string, unknown>[];
    expect(list[0]).toMatchObject({ name: expect.any(String), displayName: expect.any(String) });
    const one = (await request(http).get('/api/contacts/5')).body as { notes: Record<string, unknown>[] };
    expect(one.notes.at(-1)).toMatchObject({ text: 'Hẹn gọi lại thứ Hai', body: 'Hẹn gọi lại thứ Hai' });
  });

  it('bản sau: client bản 42 gửi trường mới `body`', async () => {
    const http = await apiAt('sau');
    await request(http).post('/api/contacts/6/notes').set('X-App-Version', '42').send({ body: 'Đã gửi báo giá' });
    const notes = (await request(http).get('/ops/notes?contactId=6')).body as { body: string }[];
    expect(notes.at(-1)?.body).toBe('Đã gửi báo giá');
  });

  it('bản trước (tái hiện): API bản 42 bỏ qua trường `text` của client bản 41 — lưu ghi chú rỗng, vẫn trả 201', async () => {
    const http = await apiAt('truoc');
    const saved = await request(http).post('/api/contacts/5/notes').set('X-App-Version', '41').send({ text: 'Hẹn gọi lại thứ Hai' });
    expect(saved.status).toBe(201);
    const notes = (await request(http).get('/ops/notes?contactId=5')).body as { body: string; lost: boolean }[];
    expect(notes.at(-1)).toMatchObject({ body: '', lost: true });
    const list = (await request(http).get('/api/contacts')).body as Record<string, unknown>[];
    expect(list[0]?.name).toBeUndefined();
  });

  it('nhật ký request ghi phiên bản client (X-App-Version) và ghi chú bị mất', async () => {
    const log = join(tmp, 'req.log');
    const http = await apiAt('truoc', log);
    await request(http).get('/api/contacts').set('X-App-Version', '41').set('Cookie', 'uid=u07');
    await request(http).post('/api/contacts/2/notes').set('X-App-Version', '41').send({ text: 'mất' });
    await app!.close();
    app = undefined;
    const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ m: 'GET', u: '/api/contacts', v: '41', uid: 'u07' });
    expect(lines[1]).toMatchObject({ m: 'POST', v: '41', note: { lost: true, fields: ['text'] } });
    rmSync(tmp, { recursive: true, force: true });
  });
});
