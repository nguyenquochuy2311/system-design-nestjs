/**
 * (b) Thư viện cần lúc chạy bị khai báo nhầm ở devDependencies: image nhiều stage phải đỏ ở smoke test
 * (lỗi bị chặn ở CI), còn image một stage vẫn xanh vì có đủ devDependencies (lỗi bị che).
 * Phép thử sửa package.json + pnpm-lock.yaml của build context tạm thời rồi khôi phục khớp byte.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildImage, CONTEXT_DIR, contextDirty, DOCKERFILES, prepareContext, sha256File, smokeTest, type BuildResult,
} from '../scripts/lib/docker.js';

const MOVED = '@lab/shared';
const PKG = join(CONTEXT_DIR, 'apps/api/package.json');
const LOCK = join(CONTEXT_DIR, 'pnpm-lock.yaml');
const before: Record<string, { bytes: Buffer; sha: string }> = {};
const built: Record<'single' | 'multi', BuildResult | null> = { single: null, multi: null };

beforeAll(async () => {
  await prepareContext();
  for (const f of [PKG, LOCK]) before[f] = { bytes: readFileSync(f), sha: sha256File(f) };
  try {
    // Chuyển thư viện runtime sang devDependencies, cập nhật lockfile như một commit thật (CI dùng --frozen-lockfile).
    const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    pkg.devDependencies[MOVED] = pkg.dependencies[MOVED]!;
    delete pkg.dependencies[MOVED];
    writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`);
    execFileSync('pnpm', ['install', '--lockfile-only', '--prefer-offline', '--ignore-scripts'], { cwd: CONTEXT_DIR, stdio: 'pipe' });
    built.multi = await buildImage({ dockerfile: DOCKERFILES.multi, tag: 'lab-17-01/neg-devdep:multi', target: 'runtime' });
    built.single = await buildImage({ dockerfile: DOCKERFILES.single, tag: 'lab-17-01/neg-devdep:single' });
  } finally {
    for (const f of [PKG, LOCK]) writeFileSync(f, before[f]!.bytes);
  }
});

afterAll(async () => {
  // Không để lại thay đổi: context phải khớp commit "ci checkout".
  expect(await contextDirty()).toBe('');
});

describe(`${MOVED} bị chuyển sang devDependencies`, () => {
  it('package.json và pnpm-lock.yaml của context được khôi phục khớp byte', () => {
    for (const f of [PKG, LOCK]) expect(sha256File(f)).toBe(before[f]!.sha);
  });

  it('cả hai bản vẫn build xanh (lỗi không lộ ở bước build)', () => {
    expect(built.multi?.ok, built.multi?.out.slice(-2000)).toBe(true);
    expect(built.single?.ok, built.single?.out.slice(-2000)).toBe(true);
  });

  it('image nhiều stage: smoke test đỏ — container thoát vì không tìm thấy module', async () => {
    const r = await smokeTest('lab-17-01/neg-devdep:multi');
    expect(r.ok).toBe(false);
    expect(r.exitedWith).toBe(1);
    expect(r.logs).toContain(`Cannot find module '${MOVED}'`);
  });

  it('image một stage: smoke test vẫn xanh — devDependencies có trong image nên lỗi bị che', async () => {
    const r = await smokeTest('lab-17-01/neg-devdep:single');
    expect(r.reason).toBe('ok');
  });
});
