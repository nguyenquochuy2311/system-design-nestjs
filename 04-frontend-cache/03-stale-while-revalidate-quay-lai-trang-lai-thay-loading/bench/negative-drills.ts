/**
 * Phép thử âm: gỡ từng phần của pattern khỏi mã nguồn (sửa tạm), chạy các file test liên quan, ghi số test đỏ, rồi
 * khôi phục và so lại nội dung file (mẫu bài 04/02). Mỗi chuỗi cần sửa phải xuất hiện đúng một lần; tổng số test của
 * lượt đã gỡ phải > 0 (nhật ký quyết định, bài 03/01). Sửa web/ thì hash mã nguồn đổi và globalSetup tự build lại Next.
 *   RUN=main pnpm bench:drills      (DRILLS=ten1,ten2 để chạy một phần)
 * Cần cổng 3100, 3200 trống. Đừng sửa code khi script đang chạy.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { powerState, resultsDir, startSleepDetector, writeJson } from './lib';

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

const Q = 'web/orders/sau/order-queries.ts';
const BACK = 'test/back-navigation-no-spinner.test.ts';
const STALE = 'test/stale-limit-while-viewing.test.ts';
const drills: Drill[] = [
  {
    name: 'query-client-trong-than-component',
    removes: 'QueryClient tạo một lần (useState): tạo mới trong thân component mỗi lần render',
    edits: [{ file: 'web/app/sau/providers.tsx', find: '  const [queryClient] = useState(() => makeQueryClient());', replace: '  const queryClient = makeQueryClient();\n  void useState;' }],
    testFiles: [BACK],
  },
  {
    name: 'gc-time-0',
    removes: 'gcTime 10 phút: truy vấn bị dọn ngay khi không còn màn hình nào dùng (gcTime 0)',
    edits: [{ file: Q, find: 'export const GC_TIME = 10 * 60_000;', replace: 'export const GC_TIME = 0;' }],
    testFiles: [BACK],
  },
  {
    name: 'stale-time-0',
    removes: 'staleTime 15 s của danh sách: về mặc định 0 (mọi lần mount đều làm mới)',
    edits: [{ file: Q, find: '  orderList: 15_000,', replace: '  orderList: 0,' }],
    testFiles: [BACK],
  },
  {
    name: 'khoa-thieu-bo-loc',
    removes: 'bộ lọc trong khóa truy vấn: mọi bộ lọc dùng chung khóa [orders, list]',
    edits: [{ file: Q, find: '  list: (f: OrderFilters) => [...orderKeys.lists(), { status: f.status, warehouse: f.warehouse, page: f.page }] as const,', replace: '  list: (f: OrderFilters) => [...orderKeys.lists()] as const,' }],
    testFiles: ['test/filter-change-never-shows-other-filter.test.ts'],
  },
  {
    name: 'giu-du-lieu-ca-khi-doi-bo-loc',
    removes: 'chỉ giữ chỗ khi đổi trang: giữ dữ liệu cũ cả khi đổi trạng thái/kho (như keepPreviousData)',
    edits: [{ file: Q, find: '  previous && previous.filters.status === f.status && previous.filters.warehouse === f.warehouse ? previous : undefined;', replace: '  previous;' }],
    testFiles: ['test/filter-change-never-shows-other-filter.test.ts'],
  },
  {
    name: 'khong-invalidate-sau-phan-don',
    removes: 'invalidateQueries mọi danh sách đơn sau khi phân đơn',
    edits: [{ file: 'web/orders/sau/order-detail.tsx', find: '      await queryClient.invalidateQueries({ queryKey: orderKeys.lists() });\n', replace: '' }],
    testFiles: ['test/assign-invalidates-list.test.ts'],
  },
  {
    name: 'khong-xoa-cache-khi-dang-xuat',
    removes: 'queryClient.clear() khi đăng xuất',
    edits: [{ file: 'web/orders/sau/header.tsx', find: '            queryClient.clear();\n', replace: '            void queryClient;\n' }],
    testFiles: ['test/logout-clears-cache.test.ts'],
  },
  {
    name: 'refetch-interval-co-dinh-30s',
    removes: 'làm mới theo tuổi dữ liệu: refetchInterval cố định 30 000 ms như kế hoạch ban đầu của README',
    edits: [{ file: Q, find: '    refetchInterval: pollOverride() ?? refetchByAge,', replace: '    refetchInterval: pollOverride() ?? 30_000,' }],
    testFiles: [STALE],
  },
  {
    name: 'refetch-interval-co-dinh-28s',
    removes: 'làm mới theo tuổi dữ liệu: refetchInterval cố định 28 000 ms (đã trừ độ trễ, nhưng đếm từ lúc mount)',
    edits: [{ file: Q, find: '    refetchInterval: pollOverride() ?? refetchByAge,', replace: '    refetchInterval: pollOverride() ?? 28_000,' }],
    testFiles: [STALE],
  },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function runVitest(files: string[], label: string) {
  const report = join(OUT, `${label}.json`);
  const started = Date.now();
  const res = spawnSync('pnpm', ['vitest', 'run', ...files, '--reporter=json', `--outputFile=${report}`], { encoding: 'utf8' });
  writeFileSync(join(OUT, `${label}.log`), `${res.stdout}\n${res.stderr}`);
  if (!existsSync(report)) return { total: 0, passed: 0, failed: 0, seconds: Number(((Date.now() - started) / 1000).toFixed(1)), failedTests: [{ file: '', title: 'không có báo cáo', reason: res.stderr.slice(0, 300) }] };
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
    failedTests: failed.map((a) => ({ file: a.file, title: a.title, reason: (a.failureMessages[0] ?? '').split('\n')[0]?.slice(0, 240) })),
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
  const power = powerState();
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
  if (mutated.total === 0) throw new Error(`${d.name}: lượt đã gỡ có 0 test — mã nguồn sau khi sửa có lẽ không build được (xem ${d.name}-mutated.log)`);
  const asExpected = mutated.failed > 0 && baseline.failed === 0 && after.failed === 0;
  const machineSleep = sleep.stop();
  keep({ name: d.name, removes: d.removes, files, testFiles: d.testFiles, asExpected, machineSleep, power, at: new Date().toISOString(), baseline, mutated, restoredMatches: restored, afterRestore: after } as { name: string });
  console.log(`${d.name}: trước ${baseline.passed}/${baseline.total} xanh · gỡ ${mutated.failed}/${mutated.total} đỏ · khôi phục ${after.passed}/${after.total} xanh · ${asExpected ? 'đúng kỳ vọng' : 'SAI KỲ VỌNG'} · máy ngủ ${machineSleep.length} lần`);
  for (const f of mutated.failedTests) console.log(`   ✗ ${f.file} › ${f.title} — ${f.reason}`);
}
writeJson(summaryFile, results);
