/**
 * Phép thử âm: gỡ từng phần của pattern khỏi mã nguồn (sửa tạm), chạy các file test liên quan, ghi số test đỏ, rồi khôi phục
 * và so lại nội dung file (mẫu bench/mutation-drills.ts của bài 08/01). Mỗi chuỗi cần sửa phải xuất hiện đúng một lần;
 * lượt đã gỡ phải có tổng số test > 0 (nhật ký quyết định, bài 03/01: sửa thành cú pháp sai làm Vitest báo 0 test).
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
  testFiles: string[];
}

const WRITERS = 'src/sau/price-writers.ts';
const CSV = 'sql/sau/import-prices.sql';
const CACHE = 'src/sau/tagged.cache.ts';
const WORKER = 'src/sau/invalidation.worker.ts';
const SAU_MODULE = 'src/sau/sau.module.ts';
const T = {
  paths: 'test/every-write-path-invalidates.test.ts',
  tags: 'test/tag-index-and-ttl.test.ts',
  failure: 'test/delete-failure-ttl-safety-net.test.ts',
  race: 'test/stale-set-race.test.ts',
  replay: 'test/worker-restart-replays-outbox.test.ts',
  orders: 'test/orders-use-db-price.test.ts',
};

const drills: Drill[] = [
  {
    name: 'admin-khong-ghi-outbox',
    removes: 'đường ghi admin không ghi sự kiện vào outbox',
    edits: [{ file: WRITERS, find: "if (updated) await trx.insertInto('price_outbox').values({ product_id: id, source: 'admin' }).execute();", replace: 'void trx;' }],
    testFiles: [T.paths],
  },
  {
    name: 'csv-khong-ghi-outbox',
    removes: 'job CSV (SQL) không có câu INSERT vào outbox',
    edits: [{ file: CSV, find: "INSERT INTO price_outbox (product_id, source) SELECT product_id, 'csv' FROM price_import WHERE applied_at IS NULL;", replace: '' }],
    testFiles: [T.paths],
  },
  {
    name: 'promo-khong-ghi-outbox',
    removes: 'job khuyến mãi không ghi sự kiện vào outbox',
    edits: [{ file: WRITERS, find: "if (ids.length) await trx.insertInto('price_outbox')", replace: "if (ids.length && false) await trx.insertInto('price_outbox')" }],
    testFiles: [T.paths],
  },
  {
    name: 'khong-ghi-tag',
    removes: 'chỉ mục ngược: nạp trang không SADD vào tag:product:<id>',
    edits: [{ file: CACHE, find: "      tx.sadd(cacheKeys.tag('sau', id), key);\n", replace: '' }],
    testFiles: [T.paths, T.tags],
  },
  {
    name: 'khong-ttl',
    removes: 'TTL: SET không kèm EX (không còn lưới an toàn)',
    edits: [{ file: CACHE, find: "tx.set(key, JSON.stringify(body), 'EX', ttl);", replace: 'tx.set(key, JSON.stringify(body)); void ttl;' }],
    testFiles: [T.tags, T.failure, T.race],
  },
  {
    name: 'khong-jitter',
    removes: 'jitter: mọi key cùng TTL 900 s',
    edits: [{ file: CACHE, find: 'const ttl = randomInt(this.minTtlS, this.maxTtlS + 1);', replace: 'const ttl = this.baseTtlS; void randomInt;' }],
    testFiles: [T.tags],
  },
  {
    name: 'nuot-loi-redis',
    removes: 'worker nuốt lỗi Redis rồi vẫn đánh dấu sự kiện đã xử lý',
    edits: [
      {
        file: WORKER,
        find: "const members = (await this.exec(productIds.map((id) => ['smembers', cacheKeys.tag('sau', id)]))) as string[][];",
        replace: "const members = (await this.exec(productIds.map((id) => ['smembers', cacheKeys.tag('sau', id)])).catch(() => productIds.map(() => []))) as string[][];",
      },
      {
        file: WORKER,
        find: 'keysRemoved += await this.redis.unlink(...all.slice(i, i + this.opts.unlinkChunk));',
        replace: 'keysRemoved += await this.redis.unlink(...all.slice(i, i + this.opts.unlinkChunk)).catch(() => 0);',
      },
      {
        file: WORKER,
        find: "await this.exec(productIds.flatMap((id, i) => (members[i]!.length ? [['srem', cacheKeys.tag('sau', id), ...members[i]!]] : [])));",
        replace: "await this.exec(productIds.flatMap((id, i) => (members[i]!.length ? [['srem', cacheKeys.tag('sau', id), ...members[i]!]] : []))).catch(() => []);",
      },
    ],
    testFiles: [T.failure],
  },
  {
    name: 'khong-khoa-dong',
    removes: 'worker đọc outbox không FOR UPDATE SKIP LOCKED',
    edits: [{ file: WORKER, find: '        .limit(this.opts.batchSize)\n        .forUpdate()\n        .skipLocked()\n', replace: '        .limit(this.opts.batchSize)\n' }],
    testFiles: [T.replay],
  },
  {
    name: 'dat-hang-tu-cache',
    removes: 'bước đặt hàng của bản sau lấy giá từ trang chi tiết (cache) thay vì DB',
    edits: [
      {
        file: SAU_MODULE,
        find: "placeOrder: (productId) => repo.insertOrder('sau', productId, null),",
        replace: "placeOrder: async (productId, client) => {\n      const { body } = await pages.product(productId, client);\n      return body ? repo.insertOrder('sau', productId, body.price) : undefined;\n    },",
      },
    ],
    testFiles: [T.orders],
  },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function runVitest(testFiles: string[], label: string) {
  const report = join(OUT, `${label}.json`);
  const started = Date.now();
  const res = spawnSync('pnpm', ['vitest', 'run', ...testFiles, '--reporter=json', `--outputFile=${report}`], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
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
  const baseline = runVitest(d.testFiles, `${d.name}-baseline`);
  let mutated;
  try {
    for (const e of d.edits) {
      const current = readFileSync(e.file, 'utf8');
      const count = current.split(e.find).length - 1;
      if (count !== 1) throw new Error(`${d.name}: chuỗi cần sửa xuất hiện ${count} lần trong ${e.file}: ${JSON.stringify(e.find)}`);
      writeFileSync(e.file, current.replace(e.find, e.replace));
    }
    mutated = runVitest(d.testFiles, `${d.name}-mutated`);
  } finally {
    for (const [f, content] of originals) writeFileSync(f, content);
  }
  const restored = files.every((f) => sha(readFileSync(f, 'utf8')) === sha(originals.get(f)!));
  if (!restored) throw new Error(`${d.name}: khôi phục không khớp`);
  if (mutated.total === 0) throw new Error(`${d.name}: lượt đã gỡ không chạy test nào (mã nguồn sửa sai cú pháp?), xem ${d.name}-mutated.log`);
  const after = runVitest(d.testFiles, `${d.name}-restored`);
  results.push({ name: d.name, removes: d.removes, files, testFiles: d.testFiles, baseline, mutated, restoredMatches: restored, afterRestore: after });
  console.log(`${d.name}: trước ${baseline.passed}/${baseline.total} xanh · gỡ ${mutated.failed}/${mutated.total} đỏ · khôi phục ${after.passed}/${after.total} xanh`);
  for (const f of mutated.failedTests) console.log(`   ✗ ${f.title} — ${f.reason}`);
}
writeFileSync(join(OUT, '..', process.env.DRILLS ? 'negative-drills-partial.json' : 'negative-drills.json'), JSON.stringify(results, null, 2));
