/**
 * Thời gian chạy bộ test quy tắc đặt hàng: qua service không cần DB (bản "sau") so với qua HTTP + PostgreSQL
 * (cách duy nhất test được bản "trước"). Mỗi lệnh chạy ROUNDS vòng sau một vòng khởi động không tính,
 * thứ tự các lệnh xoay vòng giữa các vòng. Đo thời gian thực (từ lúc gọi tới lúc tiến trình thoát) và tổng
 * thời gian các test theo JSON reporter của Vitest.
 *   RUN=main ROUNDS=5 pnpm bench:test-time     # cần pnpm db:up; kết quả: bench/results/<RUN>/test-time.json
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('bench/results', process.env.RUN ?? 'main');
const ROUNDS = Number(process.env.ROUNDS ?? 5);
mkdirSync(join(OUT, 'test-time'), { recursive: true });

const SUITES: Record<string, string[]> = {
  'rules-unit-sau': ['test/unit/order-rules.test.ts'],
  'rules-e2e-truoc': ['test/e2e/web-order-rules.e2e.test.ts', '-t', 'truoc: bảng quy tắc'],
  'unit-all': ['--project', 'unit'],
  'e2e-all': ['--project', 'e2e'],
};

interface Run {
  round: number;
  wallSeconds: number;
  tests: number;
  failed: number;
  sumTestMs: number;
}

function runOnce(name: string, args: string[], round: number): Run {
  const jsonFile = join(OUT, 'test-time', `${name}-r${round}.json`);
  const started = performance.now();
  const res = spawnSync('node_modules/.bin/vitest', ['run', ...args, '--reporter=json', `--outputFile=${jsonFile}`], { encoding: 'utf8' });
  const wallSeconds = (performance.now() - started) / 1000;
  if (res.status !== 0) throw new Error(`${name} vòng ${round} thất bại:\n${res.stdout}\n${res.stderr}`);
  const report = JSON.parse(readFileSync(jsonFile, 'utf8')) as {
    numPassedTests: number;
    numFailedTests: number;
    testResults: { assertionResults: { status: string; duration?: number }[] }[];
  };
  const ran = report.testResults.flatMap((f) => f.assertionResults).filter((a) => a.status === 'passed' || a.status === 'failed');
  return {
    round,
    wallSeconds: Number(wallSeconds.toFixed(3)),
    tests: report.numPassedTests,
    failed: report.numFailedTests,
    sumTestMs: Number(ran.reduce((s, a) => s + (a.duration ?? 0), 0).toFixed(1)),
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

const names = Object.keys(SUITES);
for (const name of names) runOnce(name, SUITES[name] as string[], 0); // khởi động: nạp cache transform, kết nối DB

const runs: Record<string, Run[]> = Object.fromEntries(names.map((n) => [n, []]));
for (let round = 1; round <= ROUNDS; round++) {
  const order = names.map((_, i) => names[(i + round) % names.length] as string);
  for (const name of order) {
    const run = runOnce(name, SUITES[name] as string[], round);
    runs[name]?.push(run);
    console.log(`vòng ${round} ${name}: ${run.wallSeconds}s, ${run.tests} test, tổng thời gian test ${run.sumTestMs} ms`);
  }
}

const summary = Object.fromEntries(
  names.map((n) => {
    const list = runs[n] as Run[];
    const wall = list.map((r) => r.wallSeconds);
    const sum = list.map((r) => r.sumTestMs);
    return [
      n,
      {
        args: SUITES[n],
        tests: list[0]?.tests,
        wallSeconds: { median: median(wall), min: Math.min(...wall), max: Math.max(...wall) },
        sumTestMs: { median: median(sum), min: Math.min(...sum), max: Math.max(...sum) },
      },
    ];
  }),
);
writeFileSync(join(OUT, 'test-time.json'), JSON.stringify({ rounds: ROUNDS, summary, runs }, null, 2));
console.log(JSON.stringify(summary, null, 1));
