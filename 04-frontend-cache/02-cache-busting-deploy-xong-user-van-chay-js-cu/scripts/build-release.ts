/**
 * Build một bản phát hành (site + release) bằng Vite vào .data/builds/<site>-<release>-<hash mã nguồn>/.
 * Bản build có sẵn thì dùng lại: khóa gồm hash của toàn bộ mã nguồn web/, nên sửa mã nguồn (kể cả phép thử âm) là
 * build lại.   pnpm site:build --site sau --release 42 [--force]
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { isReleaseId, type ReleaseId, type Site } from '../web/releases';

const execFileAsync = promisify(execFile);
export const LAB_DIR = resolve(import.meta.dirname, '..');
const WEB_DIR = join(LAB_DIR, 'web');
const BUILDS_DIR = join(LAB_DIR, '.data/builds');

/** Mọi file (đường dẫn tương đối, dùng dấu /) trong một thư mục, sắp xếp. */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export function sourceHash(): string {
  const h = createHash('sha256');
  for (const f of listFiles(WEB_DIR).filter((f) => !f.startsWith('dist/') && !f.startsWith('node_modules/'))) {
    h.update(f).update('\0').update(readFileSync(join(WEB_DIR, f))).update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

/** Build (hoặc dùng lại bản build) và trả thư mục kết quả. outDir: build vào chỗ khác, luôn build mới. */
export async function buildRelease(site: Site, release: ReleaseId, opts: { outDir?: string } = {}): Promise<string> {
  const outDir = opts.outDir ?? join(BUILDS_DIR, `${site}-${release}-${sourceHash()}`);
  if (!opts.outDir && existsSync(join(outDir, 'index.html'))) return outDir;
  try {
    await execFileAsync(join(LAB_DIR, 'node_modules/.bin/vite'), ['build', '--config', join(WEB_DIR, 'vite.config.ts')], {
      cwd: LAB_DIR,
      // NODE_ENV ép production: chạy từ Vitest (NODE_ENV=test) thì Vite giữ giá trị đó và đóng gói React bản
      // development (gấp đôi kích thước, hash khác) — gặp thật khi viết test.
      env: { ...process.env, NODE_ENV: 'production', SITE: site, RELEASE: release, OUT_DIR: outDir },
      encoding: 'utf8',
    });
  } catch (e) {
    rmSync(outDir, { recursive: true, force: true });
    const err = e as { stderr?: string; stdout?: string };
    throw new Error(`vite build lỗi (${site} ${release}):\n${err.stderr ?? ''}${err.stdout ?? ''}`);
  }
  return outDir;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { values } = parseArgs({ options: { site: { type: 'string', default: 'sau' }, release: { type: 'string', default: '41' }, out: { type: 'string' } } });
  const site = values.site === 'truoc' ? 'truoc' : 'sau';
  if (!isReleaseId(values.release!)) throw new Error(`release không hợp lệ: ${values.release}`);
  const dir = await buildRelease(site, values.release, values.out ? { outDir: resolve(values.out) } : {});
  console.log(dir);
  for (const f of listFiles(dir)) console.log(`  ${f}`);
}
