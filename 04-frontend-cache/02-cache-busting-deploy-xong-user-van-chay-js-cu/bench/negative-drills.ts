/**
 * Phép thử âm: gỡ từng phần của pattern khỏi mã nguồn (sửa tạm), chạy các file test liên quan, ghi số test đỏ, rồi
 * khôi phục và so lại nội dung file (mẫu bench/negative-drills.ts của bài 04/01). Mỗi chuỗi cần sửa phải xuất hiện
 * đúng một lần; tổng số test của lượt đã gỡ phải > 0 (nhật ký quyết định, bài 03/01).
 * Sửa nginx/*.conf thì globalSetup của Vitest nạp lại cấu hình; sửa web/ thì bản build đổi khóa (hash mã nguồn).
 *   RUN=main pnpm bench:drills      (DRILLS=ten1,ten2 để chạy một phần)
 * Cần CDN đang chạy (docker compose up -d --wait), cổng 3100, 3101 trống. Đừng sửa code khi script đang chạy.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reloadNginx } from '../scripts/cdn';
import { resultsDir, startSleepDetector, writeJson } from './lib';

const OUT = join(resultsDir(), 'drills');
mkdirSync(OUT, { recursive: true });

interface Edit {
  file: string;
  find: string;
  replace: string;
}
interface Drill {
  name: string;
  removes: string;
  edits: Edit[];
  testFiles: string[];
}

const DEPLOY = 'scripts/deploy.ts';
const drills: Drill[] = [
  {
    name: 'xoa-assets-cu-khi-deploy',
    removes: 'giữ assets của các bản trước: deploy chỉ giữ assets của bản mới (như thay cả thư mục)',
    edits: [{ file: DEPLOY, find: 'export const DEFAULT_KEEP_RELEASES = 3;', replace: 'export const DEFAULT_KEEP_RELEASES = 1;' }],
    testFiles: ['test/old-tab-survives-deploy.test.ts', 'test/deploy-keeps-old-assets.test.ts'],
  },
  {
    name: 'index-html-truoc-assets',
    removes: 'thứ tự deploy: chép index.html (và file vào cửa) trước assets',
    edits: [{ file: DEPLOY, find: 'const uploadOrder = [...assets, ...ENTRY_FILES];', replace: 'const uploadOrder = [...ENTRY_FILES, ...assets];' }],
    testFiles: ['test/deploy-keeps-old-assets.test.ts'],
  },
  {
    name: 'hash-theo-thoi-diem-build',
    removes: 'hash theo nội dung: tên file JS gắn thời điểm build thay cho [hash]',
    edits: [
      { file: 'web/vite.config.ts', find: "entryFileNames: 'assets/[name]-[hash].js',", replace: 'entryFileNames: `assets/[name]-${Date.now()}.js`,' },
      { file: 'web/vite.config.ts', find: "chunkFileNames: 'assets/[name]-[hash].js',", replace: 'chunkFileNames: `assets/[name]-${Date.now()}.js`,' },
    ],
    testFiles: ['test/build-hash-is-deterministic.test.ts'],
  },
  {
    name: 'index-html-co-max-age',
    removes: 'no-cache cho index.html: file vào cửa mang max-age=86400 như file thường',
    edits: [{ file: 'nginx/site-sau.conf', find: '  location = /index.html {\n    add_header Cache-Control "no-cache";', replace: '  location = /index.html {\n    add_header Cache-Control "max-age=86400";' }],
    testFiles: ['test/static-headers.test.ts', 'test/old-tab-survives-deploy.test.ts'],
  },
  {
    name: 'khong-bat-loi-tai-chunk',
    removes: 'bộ bắt vite:preloadError (không cài installChunkErrorHandler)',
    edits: [{ file: 'web/src/main.tsx', find: '  installChunkErrorHandler();\n', replace: '  void installChunkErrorHandler;\n' }],
    testFiles: ['test/chunk-error-reloads-once.test.ts'],
  },
  {
    name: 'api-khong-tuong-thich-nguoc',
    removes: 'API nhận trường cũ `text` trong thời gian chuyển tiếp',
    edits: [{ file: 'src/sau/contacts.controller.ts', find: "const value = v1 ? payload.text : typeof payload.body === 'string' ? payload.body : payload.text;", replace: 'const value = v1 ? payload.text : payload.body;' }],
    testFiles: ['test/api-accepts-previous-contract.test.ts', 'test/old-tab-survives-deploy.test.ts'],
  },
  {
    name: 'tu-tai-lai-khi-co-ban-moi',
    removes: 'chỉ mời tải lại: thấy bản mới thì tự location.reload() thay cho banner',
    edits: [{ file: 'web/src/sau/version-check.ts', find: '  newer = version;\n  showBanner(version);', replace: '  newer = version;\n  void showBanner;\n  location.reload();' }],
    testFiles: ['test/version-banner-no-auto-reload.test.ts'],
  },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function runVitest(files: string[], label: string) {
  const report = join(OUT, `${label}.json`);
  const started = Date.now();
  const res = spawnSync('pnpm', ['vitest', 'run', ...files, '--reporter=json', `--outputFile=${report}`], { encoding: 'utf8' });
  writeFileSync(join(OUT, `${label}.log`), `${res.stdout}\n${res.stderr}`);
  const json = JSON.parse(readFileSync(report, 'utf8')) as {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    testResults: { name: string; assertionResults: { title: string; status: string; failureMessages: string[] }[] }[];
  };
  const failed = json.testResults.flatMap((f) => f.assertionResults.map((a) => ({ ...a, file: f.name.split('/test/')[1] }))).filter((a) => a.status !== 'passed');
  return {
    total: json.numTotalTests,
    passed: json.numPassedTests,
    failed: json.numFailedTests,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    failedTests: failed.map((a) => ({ file: a.file, title: a.title, reason: (a.failureMessages[0] ?? '').split('\n')[0]?.slice(0, 220) })),
  };
}

const only = process.env.DRILLS?.split(',');
// Kết quả gộp theo tên phép thử: chạy từng phần (DRILLS=...) không xóa kết quả của phép thử khác.
const summaryFile = join(OUT, '..', 'negative-drills.json');
const results: { name: string }[] = existsSync(summaryFile) ? (JSON.parse(readFileSync(summaryFile, 'utf8')) as { name: string }[]) : [];
const keep = (r: { name: string }) => {
  const i = results.findIndex((x) => x.name === r.name);
  if (i >= 0) results[i] = r;
  else results.push(r);
};
for (const d of drills.filter((x) => !only || only.includes(x.name))) {
  const files = [...new Set(d.edits.map((e) => e.file))];
  const sleep = startSleepDetector();
  const originals = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
  const baseline = runVitest(d.testFiles, `${d.name}-baseline`);
  let mutated;
  try {
    for (const e of d.edits) {
      const current = readFileSync(e.file, 'utf8');
      const n = current.split(e.find).length - 1;
      if (n !== 1) throw new Error(`${d.name}: chuỗi cần sửa xuất hiện ${n} lần trong ${e.file}: ${JSON.stringify(e.find)}`);
      writeFileSync(e.file, current.replace(e.find, e.replace));
    }
    mutated = runVitest(d.testFiles, `${d.name}-mutated`);
  } finally {
    for (const [f, content] of originals) writeFileSync(f, content);
  }
  const restored = files.every((f) => sha(readFileSync(f, 'utf8')) === sha(originals.get(f)!));
  if (!restored) throw new Error(`${d.name}: khôi phục không khớp`);
  const after = runVitest(d.testFiles, `${d.name}-restored`);
  if (mutated.total === 0) throw new Error(`${d.name}: lượt đã gỡ có 0 test — mã nguồn sau khi sửa có lẽ không biên dịch được`);
  const asExpected = mutated.failed > 0 && baseline.failed === 0 && after.failed === 0;
  // Máy ngủ giữa chừng thì hẹn giờ của Vitest/Playwright hết hạn ngay khi máy thức: lượt đó không dùng được.
  const machineSleep = sleep.stop();
  keep({ name: d.name, removes: d.removes, files, testFiles: d.testFiles, asExpected, machineSleep, at: new Date().toISOString(), baseline, mutated, restoredMatches: restored, afterRestore: after } as { name: string });
  console.log(`${d.name}: trước ${baseline.passed}/${baseline.total} xanh · gỡ ${mutated.failed}/${mutated.total} đỏ · khôi phục ${after.passed}/${after.total} xanh · ${asExpected ? 'đúng kỳ vọng' : 'SAI KỲ VỌNG'} · máy ngủ ${machineSleep.length} lần`);
  for (const f of mutated.failedTests) console.log(`   ✗ ${f.file} › ${f.title} — ${f.reason}`);
}
// Cấu hình Nginx về đúng mã nguồn đã khôi phục.
await reloadNginx('origin');
writeJson(summaryFile, results);
