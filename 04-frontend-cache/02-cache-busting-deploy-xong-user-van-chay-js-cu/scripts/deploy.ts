/**
 * Deploy một bản phát hành lên thư mục máy gốc tĩnh (.data/www/<site>/, Nginx container `origin` đọc trực tiếp).
 *   pnpm site:deploy --site sau --release 42 [--keep 3] [--api http://127.0.0.1:3100 | --api none]
 *
 * Bản trước (hiện trạng): như `rsync -a --delete dist/ www/` — thay cả thư mục, file không còn trong bản mới bị xóa ngay.
 * Bản sau: API lên trước, assets lên trước, index.html sau cùng, giữ assets của N bản gần nhất.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isReleaseId, type ReleaseId, type Site } from '../web/releases';
import { LAB_DIR, buildRelease, listFiles } from './build-release';

/** [PATTERN] Số bản phát hành giữ lại assets (bản hiện tại + 2 bản trước). Tuần một bản thì khoảng 14 ngày. */
export const DEFAULT_KEEP_RELEASES = 3;
/** File vào cửa của bản sau: URL cố định, no-cache. index.html luôn chép cuối cùng. */
const ENTRY_FILES = ['version.json', 'widget.js', 'index.html'];

export const API_PORTS: Record<Site, number> = { sau: 3100, truoc: 3101 };
export const OPS_TOKEN = 'lab-only-ops-token';
export const wwwDirOf = (site: Site) => join(LAB_DIR, '.data/www', site);
const releasesFile = (site: Site) => join(LAB_DIR, '.data/releases', `${site}.json`);

export interface DeployStep {
  action: 'api' | 'copy' | 'skip' | 'remove';
  file?: string;
  at: number;
}
export interface DeployOptions {
  site: Site;
  release: ReleaseId;
  keepReleases?: number;
  /** URL gốc của API để báo bản mới (POST /ops/release); null = không báo. */
  api?: string | null;
  onStep?: (step: DeployStep) => void;
}
export interface DeployResult {
  site: Site;
  release: ReleaseId;
  buildDir: string;
  startedAt: number;
  finishedAt: number;
  steps: DeployStep[];
}
interface ReleaseRecord {
  release: ReleaseId;
  at: number;
  assets: string[];
}

/** Ghi file mới rồi rename: Nginx không bao giờ đọc được một file chép dở. */
function copyAtomic(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  copyFileSync(src, tmp);
  renameSync(tmp, dest);
}

export async function setApiRelease(api: string, release: ReleaseId): Promise<void> {
  const res = await fetch(`${api}/ops/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ops-token': OPS_TOKEN },
    body: JSON.stringify({ release }),
  });
  if (!res.ok) throw new Error(`báo bản ${release} cho API ${api} lỗi: ${res.status} ${await res.text()}`);
}

/** Đưa máy gốc về trống: xóa nội dung thư mục (không xóa chính thư mục, vì container mount nó) và lịch sử bản. */
export function resetSite(site: Site): void {
  const www = wwwDirOf(site);
  mkdirSync(www, { recursive: true });
  for (const f of listFiles(www)) rmSync(join(www, f));
  for (const d of ['assets']) rmSync(join(www, d), { recursive: true, force: true });
  rmSync(releasesFile(site), { force: true });
}

const readRecords = (site: Site): ReleaseRecord[] => (existsSync(releasesFile(site)) ? (JSON.parse(readFileSync(releasesFile(site), 'utf8')) as ReleaseRecord[]) : []);

export async function deploy(opts: DeployOptions): Promise<DeployResult> {
  const { site, release } = opts;
  const keep = opts.keepReleases ?? DEFAULT_KEEP_RELEASES;
  const buildDir = await buildRelease(site, release);
  const www = wwwDirOf(site);
  mkdirSync(www, { recursive: true });
  const files = listFiles(buildDir).filter((f) => !f.startsWith('.vite/'));
  const steps: DeployStep[] = [];
  const step = (action: DeployStep['action'], file?: string) => {
    const s = { action, file, at: Date.now() };
    steps.push(s);
    opts.onStep?.(s);
  };
  const startedAt = Date.now();

  if (site === 'truoc') {
    // Hiện trạng: rsync --delete. Thứ tự chép là thứ tự tên file (app.css, app.js, index.html, reports.js, vendor.js...),
    // nên có lúc index.html mới đã lên trong khi vendor.js vẫn là bản cũ.
    for (const f of listFiles(www)) {
      if (!files.includes(f)) {
        rmSync(join(www, f));
        step('remove', f);
      }
    }
    for (const f of files) {
      copyAtomic(join(buildDir, f), join(www, f));
      step('copy', f);
    }
    if (opts.api) {
      await setApiRelease(opts.api, release);
      step('api');
    }
  } else {
    // [PATTERN] 1. API (nhận cả hợp đồng cũ lẫn mới) lên trước, để JS mới không gọi vào API cũ.
    if (opts.api) {
      await setApiRelease(opts.api, release);
      step('api');
    }
    // [PATTERN] 2. Assets lên trước; 3. file vào cửa sau cùng, index.html là file cuối: lúc nó trỏ tới bộ assets mới
    // thì bộ đó đã có đủ. Tên có hash nên asset đã có cùng tên là cùng nội dung: bỏ qua, không ghi đè.
    const assets = files.filter((f) => !ENTRY_FILES.includes(f));
    const uploadOrder = [...assets, ...ENTRY_FILES];
    for (const f of uploadOrder) {
      if (assets.includes(f) && existsSync(join(www, f))) {
        step('skip', f);
        continue;
      }
      copyAtomic(join(buildDir, f), join(www, f));
      step('copy', f);
    }
    // [PATTERN] 4. Giữ assets của `keep` bản gần nhất cho tab đang mở và CDN còn index.html cũ; dọn phần còn lại.
    const records = [...readRecords(site), { release, at: Date.now(), assets }];
    mkdirSync(dirname(releasesFile(site)), { recursive: true });
    writeFileSync(releasesFile(site), `${JSON.stringify(records, null, 2)}\n`);
    const kept = new Set(records.slice(-keep).flatMap((r) => r.assets));
    for (const f of listFiles(www)) {
      if (f.startsWith('assets/') && !kept.has(f)) {
        rmSync(join(www, f));
        step('remove', f);
      }
    }
  }
  return { site, release, buildDir, startedAt, finishedAt: Date.now(), steps };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { values } = parseArgs({
    options: { site: { type: 'string', default: 'sau' }, release: { type: 'string' }, keep: { type: 'string' }, api: { type: 'string' } },
  });
  const site: Site = values.site === 'truoc' ? 'truoc' : 'sau';
  if (!values.release || !isReleaseId(values.release)) throw new Error('cần --release 41|42|43|44');
  const api = values.api === 'none' ? null : (values.api ?? `http://127.0.0.1:${API_PORTS[site]}`);
  const res = await deploy({ site, release: values.release, keepReleases: values.keep ? Number(values.keep) : undefined, api });
  for (const s of res.steps) console.log(`${s.action.padEnd(6)} ${s.file ?? ''}`);
  console.log(`deploy ${site} ${values.release} xong trong ${res.finishedAt - res.startedAt} ms (build: ${res.buildDir})`);
}
