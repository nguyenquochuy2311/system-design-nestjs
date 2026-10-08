/**
 * (c) `docker build --target test`: chạy test của @lab/api trong stage test, không build stage prod-deps/runtime,
 * không tạo image runtime mới; test hỏng làm build thất bại. Ngược lại build runtime không chạy test.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyEdits, buildImage, contextDirty, DOCKERFILES, IMAGES, imageInfo, prepareContext, run, type BuildResult,
} from '../scripts/lib/docker.js';

const runtimeImageIds = async () =>
  (await run('docker', ['image', 'ls', '-q', '--no-trunc', '--filter', 'label=lab.id=17-01', '--filter', 'label=lab.stage=runtime'])).out
    .split('\n').filter(Boolean).sort();
// Bước của một stage trong log `--progress=plain` có dạng `#12 [runtime 3/5] COPY ...`.
// Vitest trong stage test in mã màu ANSI; bỏ đi trước khi so chuỗi.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const stagesRun = (log: string) => new Set([...log.matchAll(/^#\d+ \[([a-z-]+) \d+\/\d+\]/gm)].map((m) => m[1]!));

beforeAll(async () => {
  await prepareContext();
});

describe('docker build --target test', () => {
  it('chạy vitest trong stage test, chỉ đi qua base → deps → build → test, không tạo image runtime', async () => {
    const idsBefore = await runtimeImageIds();
    // --no-cache-filter test: buộc stage test chạy lại (nếu không, bước RUN test có thể CACHED và không in kết quả).
    const r = await buildImage({ dockerfile: DOCKERFILES.multi, tag: IMAGES.testTarget, target: 'test', noCacheFilter: 'test' });
    expect(r.ok, r.out.slice(-2000)).toBe(true);
    expect(plain(r.out)).toMatch(/Tests\s+1 passed \(1\)/);
    expect([...stagesRun(r.out)].sort()).toEqual(['base', 'build', 'deps', 'test']);
    expect((await imageInfo(IMAGES.testTarget)).labels['lab.stage']).toBe('test');
    expect(await runtimeImageIds()).toEqual(idsBefore);
  });

  it('test hỏng làm build --target test thất bại (CI dừng trước khi có image để push)', async () => {
    const restore = applyEdits([{ file: 'apps/api/test/health.test.ts', from: "toMatchObject({ status: 'ok',", to: "toMatchObject({ status: 'down'," }]);
    let r: BuildResult | undefined;
    try {
      r = await buildImage({ dockerfile: DOCKERFILES.multi, tag: 'lab-17-01/neg-failing-test:test', target: 'test', noCacheFilter: 'test' });
    } finally {
      restore();
    }
    expect(await contextDirty()).toBe('');
    expect(r?.ok).toBe(false);
    expect(plain(r?.out ?? '')).toMatch(/Tests\s+1 failed \(1\)/);
  });
});

describe('docker build --target runtime', () => {
  it('không chạy stage test (BuildKit bỏ stage không nằm trên đường tới target) — CI phải gọi --target test riêng', async () => {
    // Log plain in cả bước CACHED (`#12 [runtime 3/5] ...` rồi `#12 CACHED`), nên tập stage là tập stage trong đồ thị build.
    const r = await buildImage({ dockerfile: DOCKERFILES.multi, tag: IMAGES.multi, target: 'runtime' });
    expect(r.ok, r.out.slice(-2000)).toBe(true);
    const stages = stagesRun(r.out);
    expect(stages.has('test')).toBe(false);
    expect(stages.has('runtime')).toBe(true);
    expect(stages.has('prod-deps')).toBe(true);
  });
});
