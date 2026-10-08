/**
 * (a) Build context mà BuildKit THẬT SỰ nhận (stage `context-probe`: FROM scratch + COPY . /ctx, xuất tar rồi liệt kê),
 * không phải nội dung file `.dockerignore`. Context là bản sao giống thư mục làm việc của CI/máy dev: có `.git`,
 * `node_modules` của host và một `.env` giả (giá trị mẫu).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CONTEXT_DIR, ensureBuilder, FAKE_ENV, prepareContext, TEST_BUILDER } from '../scripts/lib/docker.js';
import { checkContext } from '../scripts/lib/checks.js';

beforeAll(async () => {
  await prepareContext();
  await ensureBuilder(TEST_BUILDER);
});

describe('build context gửi lên BuildKit', () => {
  it('thư mục context có đủ node_modules, .git và .env giả (để phép kiểm có nghĩa)', () => {
    expect(existsSync(join(CONTEXT_DIR, 'node_modules/.pnpm'))).toBe(true);
    expect(existsSync(join(CONTEXT_DIR, '.git/HEAD'))).toBe(true);
    expect(readFileSync(join(CONTEXT_DIR, '.env'), 'utf8')).toBe(FAKE_ENV);
  });

  it('Dockerfile theo pattern (.dockerignore): context không có node_modules, .git, .env và nhỏ hơn 5 MB', async () => {
    const { listing, violations } = await checkContext('pattern');
    expect(violations).toEqual([]);
    expect(listing.files.some((f) => f.path === 'apps/api/src/main.ts')).toBe(true);
    expect(listing.files.some((f) => f.path === 'pnpm-lock.yaml')).toBe(true);
    expect(listing.totalBytes).toBeLessThan(5e6);
  });

  it('Dockerfile.naive (không .dockerignore): context mang cả node_modules, .git, .env — tái hiện hiện trạng', async () => {
    const { listing, violations } = await checkContext('naive');
    expect(violations).toEqual(['node_modules', '.git', '.env']);
    expect(listing.totalBytes).toBeGreaterThan(50e6);
  });
});
