/**
 * Sự kiện về bản build dùng trong README: tên và kích thước file của từng bản (41–44, hai site), và kích thước vendor
 * khi build với NODE_ENV=test (như khi Vite được gọi từ trong Vitest mà không ép NODE_ENV).
 *   RUN=main pnpm tsx bench/build-facts.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { LAB_DIR, buildRelease, listFiles } from '../scripts/build-release';
import { RELEASES, type ReleaseId, type Site } from '../web/releases';
import { resultsDir, writeJson } from './lib';

const files = (dir: string) =>
  listFiles(dir)
    .filter((f) => !f.startsWith('.vite/'))
    .map((f) => ({ file: f, bytes: statSync(join(dir, f)).size, gzip: gzipSync(readFileSync(join(dir, f))).length }));
const builds: Record<string, unknown> = {};
for (const site of ['truoc', 'sau'] as Site[]) for (const r of Object.keys(RELEASES) as ReleaseId[]) builds[`${site}-${r}`] = files(await buildRelease(site, r));

// Build như từ trong Vitest: NODE_ENV=test, không ép production.
const tmp = mkdtempSync(join(tmpdir(), 'lab-04-02-nodeenv-'));
execFileSync(join(LAB_DIR, 'node_modules/.bin/vite'), ['build', '--config', join(LAB_DIR, 'web/vite.config.ts')], {
  cwd: LAB_DIR,
  env: { ...process.env, NODE_ENV: 'test', SITE: 'sau', RELEASE: '43', OUT_DIR: tmp },
  stdio: 'ignore',
});
const nodeEnvTest = files(tmp).filter((f) => f.file.startsWith('assets/vendor-'));
rmSync(tmp, { recursive: true, force: true });
writeJson(join(resultsDir(), 'build-facts.json'), { builds, vendorWithNodeEnvTest: nodeEnvTest });
