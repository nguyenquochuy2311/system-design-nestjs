/**
 * Phép thử âm: gỡ từng phần của pattern khỏi mã nguồn (sửa tạm), chạy file test tương ứng, ghi số test đỏ, rồi khôi phục
 * và so lại nội dung file (mẫu bench/mutation-drills.ts của bài 08/01). Mỗi chuỗi cần sửa phải xuất hiện đúng một lần.
 *   RUN=main pnpm bench:drills   → bench/results/<RUN>/negative-drills.json, log từng lượt trong bench/results/<RUN>/drills/
 *   RUN=trial DRILLS=khong-ttl pnpm bench:drills   (chỉ chạy một phần)
 * Cần pnpm db:up. Đừng sửa code khi script đang chạy.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('bench/results', process.env.RUN ?? 'main', 'drills');
mkdirSync(OUT, { recursive: true });

interface Edit {
  file: string;
  find: string;
  replace: string;
}
interface Drill {
  name: string;
  /** Phần nào của pattern bị gỡ. */
  removes: string;
  edits: Edit[];
  testFile: string;
}

const SERVICE = 'src/sau/product.service.ts';
const CACHE = 'src/sau/product.cache.ts';
const REDIS_CLIENT = 'src/shared/redis.client.ts';
const drills: Drill[] = [
  {
    name: 'khong-doc-cache',
    removes: 'bước 1 (hỏi cache trước): service coi mọi lần đọc là trượt',
    edits: [{ file: SERVICE, find: 'const cached = await this.cache.get(id);', replace: "const cached = { kind: 'miss' } as Awaited<ReturnType<ProductCache['get']>>;" }],
    testFile: 'test/second-read-skips-db.test.ts',
  },
  {
    name: 'khong-ttl',
    removes: 'TTL: SET không kèm EX',
    edits: [{ file: CACHE, find: "page ? JSON.stringify(page) : NOT_FOUND_MARKER, 'EX', ttl);", replace: 'page ? JSON.stringify(page) : NOT_FOUND_MARKER);' }],
    testFile: 'test/second-read-skips-db.test.ts',
  },
  {
    name: 'khong-xoa-key',
    removes: 'xóa key sau khi sửa giá',
    edits: [{ file: SERVICE, find: 'if (updated) await this.cache.invalidate(id);', replace: 'if (updated && false) await this.cache.invalidate(id);' }],
    testFile: 'test/update-invalidates-cache.test.ts',
  },
  {
    name: 'xoa-key-truoc-khi-ghi',
    removes: 'thứ tự "ghi DB rồi mới xóa key": chuyển lệnh xóa lên trước transaction',
    edits: [
      {
        file: SERVICE,
        find: 'const updated = await this.repository.updatePrice(id, change);',
        replace: 'await this.cache.invalidate(id);\n    const updated = await this.repository.updatePrice(id, change);',
      },
      { file: SERVICE, find: 'if (updated) await this.cache.invalidate(id);', replace: '' },
    ],
    testFile: 'test/update-invalidates-cache.test.ts',
  },
  {
    name: 'khong-negative-cache',
    removes: 'negative cache: không ghi nhớ id không tồn tại',
    edits: [{ file: SERVICE, find: 'await this.cache.set(id, page);', replace: 'if (page) await this.cache.set(id, page);' }],
    testFile: 'test/negative-cache.test.ts',
  },
  {
    name: 'khong-fail-open',
    removes: 'fail open: lỗi Redis ném thẳng ra controller',
    edits: [{ file: CACHE, find: "this.warn('get', id, err);\n      return { kind: 'error' };", replace: 'throw err;' }],
    testFile: 'test/redis-down-falls-back-to-db.test.ts',
  },
  {
    name: 'khong-command-timeout',
    removes: 'commandTimeout 50 ms: lệnh chờ Redis trả lời không giới hạn',
    edits: [{ file: REDIS_CLIENT, find: 'commandTimeout: commandTimeoutMs,', replace: 'commandTimeout: undefined,' }],
    testFile: 'test/redis-down-falls-back-to-db.test.ts',
  },
  {
    name: 'ioredis-mac-dinh',
    removes: 'cấu hình client cho cache: dùng mặc định của ioredis (offline queue, 20 lần thử lại, không timeout lệnh)',
    edits: [
      {
        file: REDIS_CLIENT,
        find: '  const redis = new Redis(url, {',
        replace: '  const redis = new Redis(url);\n  void commandTimeoutMs;\n  void ({',
      },
    ],
    testFile: 'test/redis-down-falls-back-to-db.test.ts',
  },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function runVitest(testFile: string, label: string) {
  const report = join(OUT, `${label}.json`);
  const started = Date.now();
  const res = spawnSync('pnpm', ['vitest', 'run', testFile, '--reporter=json', `--outputFile=${report}`], { encoding: 'utf8' });
  writeFileSync(join(OUT, `${label}.log`), `${res.stdout}\n${res.stderr}`);
  const json = JSON.parse(readFileSync(report, 'utf8')) as {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    testResults: { assertionResults: { title: string; status: string; duration?: number; failureMessages: string[] }[] }[];
  };
  const failed = json.testResults.flatMap((f) => f.assertionResults).filter((a) => a.status !== 'passed');
  return {
    total: json.numTotalTests,
    passed: json.numPassedTests,
    failed: json.numFailedTests,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    failedTests: failed.map((a) => ({ title: a.title, durationMs: a.duration, reason: (a.failureMessages[0] ?? '').split('\n')[0]?.slice(0, 200) })),
  };
}

// DRILLS=ten1,ten2 để chạy lại một phần; mặc định chạy tất cả.
const only = process.env.DRILLS?.split(',');
const results: unknown[] = [];
for (const d of drills.filter((x) => !only || only.includes(x.name))) {
  const files = [...new Set(d.edits.map((e) => e.file))];
  const originals = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
  const baseline = runVitest(d.testFile, `${d.name}-baseline`);
  let mutated;
  try {
    for (const e of d.edits) {
      const current = readFileSync(e.file, 'utf8');
      const count = current.split(e.find).length - 1;
      if (count !== 1) throw new Error(`${d.name}: chuỗi cần sửa xuất hiện ${count} lần trong ${e.file}: ${JSON.stringify(e.find)}`);
      writeFileSync(e.file, current.replace(e.find, e.replace));
    }
    mutated = runVitest(d.testFile, `${d.name}-mutated`);
  } finally {
    for (const [f, content] of originals) writeFileSync(f, content);
  }
  const restored = files.every((f) => sha(readFileSync(f, 'utf8')) === sha(originals.get(f)!));
  if (!restored) throw new Error(`${d.name}: khôi phục không khớp`);
  const after = runVitest(d.testFile, `${d.name}-restored`);
  results.push({ name: d.name, removes: d.removes, files, testFile: d.testFile, baseline, mutated, restoredMatches: restored, afterRestore: after });
  console.log(`${d.name}: trước ${baseline.passed}/${baseline.total} xanh · gỡ ${mutated.failed}/${mutated.total} đỏ · khôi phục ${after.passed}/${after.total} xanh`);
  for (const f of mutated.failedTests) console.log(`   ✗ ${f.title} — ${f.reason}`);
}
writeFileSync(join(OUT, '..', 'negative-drills.json'), JSON.stringify(results, null, 2));
