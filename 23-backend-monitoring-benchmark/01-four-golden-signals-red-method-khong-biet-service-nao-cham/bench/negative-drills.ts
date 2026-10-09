// Phép thử âm: gỡ từng phần của pattern rồi chạy đúng file test kiểm phần đó, xác nhận test ĐỎ; khôi phục và kiểm
// file khớp từng byte (nhật ký 08/01 điểm 4). Mỗi lượt phải có tổng số test > 0 (nhật ký 03/01 điểm 5).
//  1. raw-url          : http-server.ts dùng request.url (URL thô) thay cho route template → test (b) đỏ
//  2. no-service-name  : promotion không đặt OTEL_SERVICE_NAME → service_name="unknown_service:node" → test (a) đỏ
//  3. rule-without-le  : recording rule p95 bỏ `le` khỏi `sum by` → test (c) đỏ
//  4. promotion-sdk-off: tắt instrumentation riêng promotion (OTEL_SDK_DISABLED=true) → test (a) đỏ
// Chạy (stack đang bật): pnpm bench:negative [--only raw-url]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { URLS } from '../test/support/stack.js';
import { compose } from './lib/compose.js';
import { mustRun, run, sleep } from './lib/proc.js';

const { values: args } = parseArgs({ options: { only: { type: 'string' }, out: { type: 'string', default: 'negative' } } });
const OUT = `bench/results/${args.out}`;
mkdirSync(OUT, { recursive: true });
mkdirSync('.tmp', { recursive: true });

/** Sửa một chuỗi xuất hiện ĐÚNG một lần trong file; trả hàm khôi phục (kiểm nội dung khớp bản gốc). */
function mutate(file: string, from: string, to: string): () => void {
  const original = readFileSync(file, 'utf8');
  const count = original.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: chuỗi cần sửa xuất hiện ${count} lần (cần đúng 1)`);
  writeFileSync(file, original.replace(from, to));
  return () => {
    writeFileSync(file, original);
    if (readFileSync(file, 'utf8') !== original) throw new Error(`${file}: khôi phục không khớp bản gốc`);
  };
}

async function vitest(file: string, tag: string) {
  const report = `${OUT}/${tag}-vitest.json`;
  await run('pnpm', ['exec', 'vitest', 'run', file, '--reporter=json', `--outputFile=${report}`], { env: { TEST_WAIT_MS: '30000' } });
  const r = JSON.parse(readFileSync(report, 'utf8')) as { numTotalTests: number; numFailedTests: number; numPassedTests: number; numFailedTestSuites: number; testResults: { message?: string; assertionResults: { title: string; status: string; failureMessages: string[] }[] }[] };
  const failed = r.testResults.flatMap((t) => [
    ...(t.message ? [`(hook) ${t.message.slice(0, 220)}`] : []),
    ...t.assertionResults.filter((a) => a.status === 'failed').map((a) => `${a.title}: ${a.failureMessages[0]?.split('\n')[0]?.slice(0, 220)}`),
  ]);
  // Hook lỗi (beforeAll) làm cả file đỏ nhưng các test bị tính "skipped": đếm cả suite lỗi.
  return { total: r.numTotalTests, failed: r.numFailedTests > 0 ? r.numFailedTests : r.numFailedTestSuites, passed: r.numPassedTests, failures: failed };
}

const rebuildAndRecreate = async () => {
  await mustRun('node', ['scripts/build-services.mjs']);
  await compose(['up', '-d', '--wait', '--force-recreate', 'promotion', 'checkout', 'gateway']);
};
const promotionOverride = (env: Record<string, string>) => {
  const file = '.tmp/drill-override.yaml';
  writeFileSync(file, `services:\n  promotion:\n    environment:\n${Object.entries(env).map(([k, v]) => `      ${k}: "${v}"`).join('\n')}\n`);
  return file;
};
const reloadPrometheus = async () => {
  const res = await fetch(`${URLS.prometheus}/-/reload`, { method: 'POST' });
  if (!res.ok) throw new Error(`reload Prometheus → ${res.status}`);
};

const DRILLS: { name: string; testFile: string; apply: () => Promise<() => Promise<void>> }[] = [
  {
    name: 'raw-url',
    testFile: 'test/route-template-label.test.ts',
    apply: async () => {
      const restore = mutate('packages/observability/http-server.ts', 'const route = request.routeOptions.url;', 'const route = request.url;');
      await rebuildAndRecreate();
      return async () => {
        restore();
        await rebuildAndRecreate();
      };
    },
  },
  {
    name: 'no-service-name',
    testFile: 'test/red-metrics-exposed.test.ts',
    apply: async () => {
      await compose(['-f', 'compose.yaml', '-f', promotionOverride({ OTEL_SERVICE_NAME: '' }), 'up', '-d', '--wait', 'promotion']);
      return async () => void (await compose(['up', '-d', '--wait', 'promotion']));
    },
  },
  {
    name: 'rule-without-le',
    testFile: 'test/recording-rules-match.test.ts',
    apply: async () => {
      const restore = mutate(
        'infra/rules/red.rules.yml',
        'histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket[1m])))',
        'histogram_quantile(0.95, sum by (service_name) (rate(http_server_request_duration_seconds_bucket[1m])))',
      );
      await reloadPrometheus();
      // Chờ mẫu cũ (đúng) của rule quá 30 s, để test chỉ còn thấy mẫu do biểu thức sai tạo ra.
      await sleep(35_000);
      return async () => {
        restore();
        await reloadPrometheus();
      };
    },
  },
  {
    name: 'promotion-sdk-off',
    testFile: 'test/red-metrics-exposed.test.ts',
    apply: async () => {
      await compose(['-f', 'compose.yaml', '-f', promotionOverride({ OTEL_SDK_DISABLED: 'true' }), 'up', '-d', '--wait', 'promotion']);
      return async () => void (await compose(['up', '-d', '--wait', 'promotion']));
    },
  },
];

/** Băm toàn bộ mã nguồn và cấu hình mà phép thử có thể sửa, để chắc đã khôi phục đúng. */
async function sourceHash(): Promise<string> {
  const r = await mustRun('/bin/sh', ['-c', "find packages services infra compose.yaml -type f | sort | xargs shasum -a 256 | shasum -a 256"]);
  return r.stdout.trim().split(' ')[0]!;
}
const sourceBefore = await sourceHash();
const results = [];
for (const d of DRILLS.filter((x) => !args.only || x.name === args.only)) {
  console.log(`== ${d.name}: áp dụng`);
  const restore = await d.apply();
  let broken;
  try {
    broken = await vitest(d.testFile, `${d.name}-broken`);
  } finally {
    await restore();
  }
  // Sau khi khôi phục, cùng file test phải xanh lại (đợi series cũ của lượt hỏng không ảnh hưởng).
  const restored = await vitest(d.testFile, `${d.name}-restored`);
  const r = { drill: d.name, testFile: d.testFile, broken, restored, ok: broken.total > 0 && broken.failed > 0 && restored.failed === 0 && restored.total > 0 };
  results.push(r);
  console.log(JSON.stringify({ drill: d.name, broken: `${broken.failed}/${broken.total} đỏ`, restored: `${restored.failed}/${restored.total} đỏ`, ok: r.ok }));
  for (const f of broken.failures.slice(0, 3)) console.log(`   ✗ ${f}`);
}
const sourceAfter = await sourceHash();
writeFileSync(`${OUT}/summary.json`, JSON.stringify({ results, sourceBefore, sourceAfter, sourceUnchanged: sourceAfter === sourceBefore }, null, 2));
console.log(`nguồn sau khi khôi phục: ${sourceAfter === sourceBefore ? 'khớp từng byte với lúc bắt đầu' : 'KHÁC lúc bắt đầu!'}`);
if (sourceAfter !== sourceBefore) process.exit(1);
process.exit(results.every((r) => r.ok) ? 0 : 1);
