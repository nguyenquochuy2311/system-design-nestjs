/**
 * (a) Nội dung thật của image runtime: kiểm trên filesystem đã export của image (không tin Dockerfile),
 * so với bản một stage (hiện trạng) để thấy test bắt được đúng triệu chứng.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildImage, checkRuntimeContents, devDependencyNames, DOCKERFILES, IMAGES, imageInfo, listImageFiles,
  prepareContext, processUid, smokeTest,
} from '../scripts/lib/docker.js';

let devDeps: string[] = [];

beforeAll(async () => {
  await prepareContext();
  devDeps = devDependencyNames();
  for (const b of [
    { dockerfile: DOCKERFILES.single, tag: IMAGES.single },
    { dockerfile: DOCKERFILES.multi, tag: IMAGES.multi, target: 'runtime' },
  ]) {
    const r = await buildImage(b);
    if (!r.ok) throw new Error(`build ${b.tag} lỗi:\n${r.out.slice(-3000)}`);
  }
});

describe('bản một stage (trước) — tái hiện triệu chứng', () => {
  it('image chứa typescript, mã nguồn src/, .git, devDependencies và pnpm', async () => {
    const kinds = new Set(checkRuntimeContents(await listImageFiles(IMAGES.single), devDeps).map((v) => v.kind));
    expect([...kinds].sort()).toEqual(expect.arrayContaining(['devDependency', 'git', 'pnpm', 'source', 'typescript', 'unexpected-app-entry']));
  });

  it('tiến trình chạy bằng root (uid 0)', async () => {
    expect(await processUid(IMAGES.single)).toBe('0');
  });
});

describe('bản nhiều stage (sau) — image runtime', () => {
  it('không chứa typescript, src/, .git, devDependency nào hay pnpm; /app chỉ có dist, node_modules, package.json', async () => {
    const files = await listImageFiles(IMAGES.multi);
    expect(files.length).toBeGreaterThan(1000); // export thật, không phải danh sách rỗng
    expect(files).toContain('app/dist/main.js');
    // node_modules kiểu pnpm: @nestjs/core là symlink vào .pnpm/, package.json thật nằm trong .pnpm/.
    expect(files).toContain('app/node_modules/@nestjs/core');
    expect(files.some((f) => /^app\/node_modules\/\.pnpm\/@nestjs\+core@10\.4\.22[^/]*\/node_modules\/@nestjs\/core\/package\.json$/.test(f))).toBe(true);
    expect(checkRuntimeContents(files, devDeps)).toEqual([]);
  });

  it('chạy bằng user node (uid 1000), không phải root', async () => {
    const info = await imageInfo(IMAGES.multi);
    expect(info.user).toBe('node');
    expect(await processUid(IMAGES.multi)).toBe('1000');
  });

  it('chạy thẳng node dist/main.js, không qua pnpm', async () => {
    expect((await imageInfo(IMAGES.multi)).cmd).toEqual(['node', 'dist/main.js']);
  });

  it('smoke test: container khởi động và /health trả status ok', async () => {
    const r = await smokeTest(IMAGES.multi);
    expect(r.reason).toBe('ok');
    expect(r.body).toMatchObject({ status: 'ok', service: 'api' });
  });
});
