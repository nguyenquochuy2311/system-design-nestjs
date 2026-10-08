/**
 * (c) Cache không được che lỗi: build `--no-cache` (không dùng layer cache nào) của Dockerfile theo pattern vẫn thành
 * công, và image chạy được (gọi /health từ trong container).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { build, ensureBuilder, prepareContext, smoke, TEST_BUILDER, VARIANTS } from '../scripts/lib/docker.js';

beforeAll(async () => {
  await prepareContext();
  await ensureBuilder(TEST_BUILDER);
});

describe('build --no-cache', () => {
  it('Dockerfile theo pattern build từ đầu thành công, không bước RUN nào CACHED, image trả /health ok', async () => {
    const r = await build({ variant: 'pattern', builder: TEST_BUILDER, noCache: true, output: 'load' });
    expect(r.ok, r.out.slice(-3000)).toBe(true);
    // BuildKit vẫn báo CACHED cho `FROM` (base image đã có) và có thể cho `WORKDIR`; mọi bước RUN phải chạy thật.
    const cachedRuns = r.log.steps.filter((s) => /^\[[\w-]+ \d+\/\d+\] RUN/.test(s.name) && s.cached).map((s) => s.name);
    expect(cachedRuns).toEqual([]);
    expect(r.log.steps.filter((s) => /^\[[\w-]+ \d+\/\d+\] RUN/.test(s.name)).length).toBeGreaterThanOrEqual(6);
    const s = await smoke(VARIANTS.pattern.tag);
    expect(s.ok, s.logs).toBe(true);
    expect(JSON.parse(s.body)).toMatchObject({ status: 'ok', service: 'api' });
  });
});
