/**
 * Phép thử âm: gỡ từng phần của pattern khỏi mã nguồn (sửa tạm), chạy các file test liên quan, ghi số test đỏ, rồi khôi
 * phục và so lại nội dung file (mẫu bench/negative-drills.ts của bài 03/01). Mỗi chuỗi cần sửa phải xuất hiện đúng một
 * lần; tổng số test của lượt đã gỡ phải > 0 (sửa thành cú pháp sai làm Vitest báo 0 test, nhật ký quyết định bài 03/01).
 * Phép thử sửa next.config.ts thì build lại Next trước khi chạy test và sau khi khôi phục.
 *   RUN=main pnpm bench:drills      (DRILLS=ten1,ten2 để chạy một phần)
 * Cần CDN đang chạy (docker compose up -d) và cổng 3100–3102, 3200 trống. Đừng sửa code khi script đang chạy.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resultsDir, writeJson } from './lib';

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
  rebuildWeb?: boolean;
  /** true: phép thử kiểm một lớp bảo vệ còn lại, mong đợi 0 test đỏ. */
  expectGreen?: boolean;
}

const INTERCEPTOR = 'src/sau/http-cache.interceptor.ts';
const POLICY = 'src/sau/cache-policy.ts';
const CATALOG = 'src/sau/catalog.controller.ts';
const ACCOUNT = 'src/sau/account.controller.ts';
const NEXT_CONFIG = 'web/next.config.ts';

const drills: Drill[] = [
  {
    name: 'khong-etag-json',
    removes: 'ETag của JSON công khai (interceptor không đặt ETag)',
    edits: [{ file: INTERCEPTOR, find: "res.setHeader('ETag', etagFor(JSON.stringify(body)));", replace: 'void etagFor;' }],
    testFiles: ['test/policy-by-resource-type.test.ts', 'test/conditional-request-returns-304.test.ts', 'test/cdn-vary-and-revalidation.test.ts'],
  },
  {
    name: 'etag-theo-instance',
    removes: 'ETag chỉ từ nội dung: thêm pid của tiến trình vào hash (mỗi instance một ETag)',
    edits: [{ file: POLICY, find: "createHash('sha256').update(content)", replace: "createHash('sha256').update(String(process.pid)).update(content)" }],
    testFiles: ['test/two-instances-same-etag.test.ts', 'test/conditional-request-returns-304.test.ts'],
  },
  {
    name: 'route-guard-lo-public',
    removes: 'lớp ép private cho route có guard, đồng thời khai báo public-json cho GET /api/cart/summary',
    edits: [
      { file: INTERCEPTOR, find: "guards.length > 0 && isShared(declared) ? 'private' : declared;", replace: 'declared; void isShared; void guards;' },
      { file: ACCOUNT, find: "  @Get('cart/summary')\n", replace: "  @Get('cart/summary')\n  @CachePolicy('public-json')\n" },
    ],
    testFiles: ['test/authenticated-routes-are-private.test.ts', 'test/cdn-never-serves-other-users-cart.test.ts'],
  },
  {
    name: 'route-guard-khai-bao-public-van-con-lop-ep',
    removes: 'chỉ khai báo public-json cho GET /api/cart/summary, GIỮ lớp ép private (kiểm lớp bảo vệ thứ hai)',
    edits: [{ file: ACCOUNT, find: "  @Get('cart/summary')\n", replace: "  @Get('cart/summary')\n  @CachePolicy('public-json')\n" }],
    testFiles: ['test/authenticated-routes-are-private.test.ts', 'test/cdn-never-serves-other-users-cart.test.ts'],
    expectGreen: true,
  },
  {
    name: 'thieu-vary',
    removes: "Vary: Accept của ảnh (cùng URL trả WebP hoặc JPEG)",
    edits: [{ file: CATALOG, find: "    res.setHeader('Vary', 'Accept');\n", replace: '' }],
    testFiles: ['test/policy-by-resource-type.test.ts', 'test/cdn-vary-and-revalidation.test.ts'],
  },
  {
    name: 'loi-mang-chinh-sach-thanh-cong',
    removes: 'đặt lại no-store khi handler lỗi (404/400 mang chính sách public của route)',
    edits: [{ file: INTERCEPTOR, find: "          res.setHeader('Cache-Control', CACHE_POLICIES['no-store']);\n", replace: '' }],
    testFiles: ['test/policy-by-resource-type.test.ts'],
  },
  {
    name: 'html-khong-chinh-sach',
    removes: 'luật headers() cho HTML trong next.config.ts (trỏ luật vào một đường dẫn không tồn tại; HTML về mặc định của Next)',
    edits: [{ file: NEXT_CONFIG, find: "source: '/((?!_next/).*)',", replace: "source: '/__khong-route-nao-khop',"}],
    testFiles: ['test/next-headers.test.ts', 'test/cdn-vary-and-revalidation.test.ts'],
    rebuildWeb: true,
  },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function buildWeb(label: string): void {
  const res = spawnSync('pnpm', ['web:build'], { encoding: 'utf8' });
  writeFileSync(join(OUT, `${label}-build.log`), `${res.stdout}\n${res.stderr}`);
  if (res.status !== 0) throw new Error(`build Next lỗi (${label})`);
}

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
const results: unknown[] = [];
for (const d of drills.filter((x) => !only || only.includes(x.name))) {
  const files = [...new Set(d.edits.map((e) => e.file))];
  const originals = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
  if (d.rebuildWeb) buildWeb(`${d.name}-baseline`);
  const baseline = runVitest(d.testFiles, `${d.name}-baseline`);
  let mutated;
  try {
    for (const e of d.edits) {
      const current = readFileSync(e.file, 'utf8');
      const n = current.split(e.find).length - 1;
      if (n !== 1) throw new Error(`${d.name}: chuỗi cần sửa xuất hiện ${n} lần trong ${e.file}: ${JSON.stringify(e.find)}`);
      writeFileSync(e.file, current.replace(e.find, e.replace));
    }
    if (d.rebuildWeb) buildWeb(`${d.name}-mutated`);
    mutated = runVitest(d.testFiles, `${d.name}-mutated`);
  } finally {
    for (const [f, content] of originals) writeFileSync(f, content);
    // build lại cả khi lượt đã gỡ lỗi giữa chừng, để .next khớp mã nguồn đã khôi phục
    if (d.rebuildWeb) buildWeb(`${d.name}-restored`);
  }
  const restored = files.every((f) => sha(readFileSync(f, 'utf8')) === sha(originals.get(f)!));
  if (!restored) throw new Error(`${d.name}: khôi phục không khớp`);
  const after = runVitest(d.testFiles, `${d.name}-restored`);
  if (mutated.total === 0) throw new Error(`${d.name}: lượt đã gỡ có 0 test — mã nguồn sau khi sửa có lẽ không biên dịch được`);
  const asExpected = d.expectGreen ? mutated.failed === 0 : mutated.failed > 0;
  results.push({ name: d.name, removes: d.removes, files, testFiles: d.testFiles, expectGreen: !!d.expectGreen, asExpected, baseline, mutated, restoredMatches: restored, afterRestore: after });
  console.log(`${d.name}: trước ${baseline.passed}/${baseline.total} xanh · gỡ ${mutated.failed}/${mutated.total} đỏ · khôi phục ${after.passed}/${after.total} xanh · ${asExpected ? 'đúng kỳ vọng' : 'SAI KỲ VỌNG'}`);
  for (const f of mutated.failedTests) console.log(`   ✗ ${f.file} › ${f.title} — ${f.reason}`);
}
writeJson(join(OUT, '..', 'negative-drills.json'), results);
