/**
 * (b) Sửa một dòng trong apps/api/src rồi build lại trên cùng builder: đọc log `--progress=plain` xem bước cài
 * dependency có `CACHED` không. Bản theo pattern: fetch/install/deploy CACHED, chỉ bước biên dịch API chạy lại.
 * Bản hiện trạng (`COPY . .` trước install): install chạy lại.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { contextDirty, ensureBuilder, prepareContext, TEST_BUILDER } from '../scripts/lib/docker.js';
import { srcEditReport } from '../scripts/lib/checks.js';

beforeAll(async () => {
  await prepareContext();
  await ensureBuilder(TEST_BUILDER);
});

describe('sửa một dòng trong src', () => {
  it('Dockerfile theo pattern: pnpm fetch, pnpm install, pnpm deploy đều CACHED; chỉ biên dịch API chạy lại', async () => {
    const r = await srcEditReport('pattern', { builder: TEST_BUILDER });
    expect(r.ok, r.edited.out.slice(-2000)).toBe(true);
    expect(await contextDirty()).toBe('');
    expect(r.apiBuildCached).toBe(false); // bản sửa thật sự vào context
    expect(r.fetchCached).toBe(true);
    expect(r.installCached).toBe(true);
    expect(r.deployCached).toBe(true);
    expect(r.edited.log.pnpmDownloaded).toBe(0);
  });

  it('Dockerfile.naive: pnpm install chạy lại và tải lại mọi gói — tái hiện hiện trạng', async () => {
    const r = await srcEditReport('naive', { builder: TEST_BUILDER });
    expect(r.ok, r.edited.out.slice(-2000)).toBe(true);
    expect(await contextDirty()).toBe('');
    expect(r.installCached).toBe(false);
    expect(r.edited.log.pnpmDownloaded).toBeGreaterThan(400);
  });
});
