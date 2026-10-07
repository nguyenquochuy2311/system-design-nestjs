/**
 * Phép thử âm: gỡ từng phần của pattern khỏi mã nguồn (sửa tạm), chạy test tương ứng, ghi số test đỏ, rồi khôi phục
 * và so lại nội dung file (mẫu bench/mutation-drills.ts của bài 08/01). Mỗi chuỗi cần sửa phải xuất hiện đúng một lần.
 *   RUN=main pnpm bench:drills   → bench/results/<RUN>/negative-drills.json
 * Đừng sửa code khi script đang chạy.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('bench/results', process.env.RUN ?? 'main', 'drills');
mkdirSync(OUT, { recursive: true });

interface Drill {
  name: string;
  /** Phần nào của pattern bị gỡ. */
  removes: string;
  file: string;
  find: string;
  replace: string;
  testFile: string;
}

const SERVICE = 'src/sau/exports/create-export.service.ts';
const WORKER = 'src/sau/exports/export.worker.ts';
const drills: Drill[] = [
  {
    name: 'khong-khoa-chong-trung',
    removes: 'khóa chống trùng: mỗi lần bấm có filter_hash khác nhau',
    file: SERVICE,
    find: 'const hash = filterHash(filter);',
    replace: 'const hash = filterHash(filter) + Math.random();',
    testFile: 'test/repeated-clicks-create-one-job.test.ts',
  },
  {
    name: 'gui-message-ngoai-transaction',
    removes: 'gửi message trong cùng transaction: pgmq.send chạy trên kết nối riêng, tự commit',
    file: SERVICE,
    find: 'await sendMessage(trx, this.config.exports.queue, { jobId: inserted.id });',
    replace: 'await sendMessage(this.db, this.config.exports.queue, { jobId: inserted.id });',
    testFile: 'test/rollback-leaves-no-message.test.ts',
  },
  {
    name: 'pop-thay-read',
    removes: 'visibility timeout: lấy message bằng pgmq.pop (xóa ngay khi nhận)',
    file: WORKER,
    find: 'messages = await readMessages(this.db, queue, visibilityTimeoutSeconds, 1);',
    replace: 'messages = (await sql<QueueMessage>`SELECT msg_id, read_ct, message FROM pgmq.pop(${queue})`.execute(this.db)).rows;',
    testFile: 'test/job-completes-after-worker-kill.test.ts',
  },
  {
    name: 'khong-heartbeat',
    removes: 'heartbeat gia hạn visibility timeout (khoảng gia hạn thành 1 giờ, coi như không gia hạn)',
    file: WORKER,
    find: 'Math.max(500, (vt * 1000) / 3)',
    replace: '3_600_000',
    testFile: 'test/job-completes-after-worker-kill.test.ts',
  },
  {
    name: 'khong-gioi-han-lan-thu',
    removes: 'giới hạn số lần thử theo read_ct',
    file: WORKER,
    find: 'if (msg.read_ct > maxAttempts) {',
    replace: 'if (false && msg.read_ct > maxAttempts) {',
    testFile: 'test/exhausted-retries-mark-job-failed.test.ts',
  },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function runVitest(testFile: string, label: string) {
  const report = join(OUT, `${label}.json`);
  const started = Date.now();
  spawnSync('pnpm', ['vitest', 'run', testFile, '--reporter=json', `--outputFile=${report}`], { encoding: 'utf8', stdio: 'ignore' });
  const json = JSON.parse(readFileSync(report, 'utf8')) as {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    testResults: { assertionResults: { title: string; status: string; failureMessages: string[] }[] }[];
  };
  const failed = json.testResults.flatMap((f) => f.assertionResults).filter((a) => a.status !== 'passed');
  return {
    total: json.numTotalTests,
    passed: json.numPassedTests,
    failed: json.numFailedTests,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    failedTests: failed.map((a) => ({ title: a.title, reason: (a.failureMessages[0] ?? '').split('\n')[0]?.slice(0, 200) })),
  };
}

const results: unknown[] = [];
for (const d of drills) {
  const original = readFileSync(d.file, 'utf8');
  const count = original.split(d.find).length - 1;
  if (count !== 1) throw new Error(`${d.name}: chuỗi cần sửa xuất hiện ${count} lần trong ${d.file}`);
  const baseline = runVitest(d.testFile, `${d.name}-baseline`);
  let mutated;
  try {
    writeFileSync(d.file, original.replace(d.find, d.replace));
    mutated = runVitest(d.testFile, `${d.name}-mutated`);
  } finally {
    writeFileSync(d.file, original);
  }
  const restored = sha(readFileSync(d.file, 'utf8')) === sha(original);
  if (!restored) throw new Error(`${d.name}: khôi phục ${d.file} không khớp`);
  const after = runVitest(d.testFile, `${d.name}-restored`);
  const r = { name: d.name, removes: d.removes, file: d.file, testFile: d.testFile, baseline, mutated, restoredMatches: restored, afterRestore: after };
  results.push(r);
  console.log(`${d.name}: trước ${baseline.passed}/${baseline.total} xanh · gỡ pattern ${mutated.failed}/${mutated.total} đỏ · khôi phục ${after.passed}/${after.total} xanh`);
}
writeFileSync(join(OUT, '..', 'negative-drills.json'), JSON.stringify(results, null, 2));
