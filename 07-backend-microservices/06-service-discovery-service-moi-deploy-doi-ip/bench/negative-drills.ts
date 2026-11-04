/**
 * Phép thử âm: gỡ từng phần của pattern bằng cách sửa mã nguồn hoặc manifest thật, chạy đúng test bảo vệ phần đó.
 * Mỗi chuỗi cần sửa phải xuất hiện đúng một lần. Test phải xanh trước khi sửa, và có test đỏ sau khi sửa.
 * Hai phép thử về lan truyền cần quy tắc mạng cập nhật chậm: một node không có khoảng trễ của cụm nhiều node, nên script tự
 * tạo lại k3s với KUBE_PROXY_MIN_SYNC=5s rồi trả về mặc định.
 *   docker compose up -d --wait
 *   RUN=main pnpm bench:drills     # kết quả: bench/results/<RUN>/drills.json
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Edit {
  file: string;
  from: string;
  to: string;
}

interface Drill {
  name: string;
  edits: Edit[];
  /** Tên test cần chạy. */
  test: string;
  testFile?: string;
  /** Giá trị KUBE_PROXY_MIN_SYNC của k3s khi chạy phép thử này. */
  lag?: string;
}

const PRICING_YAML = 'k8s/pricing.yaml';
const ORDER_YAML = 'k8s/order.yaml';
const CLIENT = 'src/order/pricing-client.ts';
const CLIENT_TESTS = 'test/pricing-client.test.ts';
const CLUSTER_TESTS = 'test/cluster/discovery.test.ts';

const NO_PRESTOP: Edit = {
  file: PRICING_YAML,
  from: `          lifecycle:
            # [PATTERN] Chờ EndpointSlice lan đi trước khi nhận SIGTERM, để không có request rơi vào pod đã tắt.
            preStop:
              exec:
                command: ["sleep", "5"]
`,
  to: '',
};
const NO_RETRY: Edit = {
  file: ORDER_YAML,
  from: `            - name: PRICING_RETRIES
              value: "1"
`,
  to: `            - name: PRICING_RETRIES
              value: "0"
`,
};
const NO_READINESS: Edit = {
  file: PRICING_YAML,
  from: `          readinessProbe:
            httpGet:
              path: /ready
              port: 3000
            periodSeconds: 2
            failureThreshold: 2
`,
  to: '',
};

const DRILLS: Drill[] = [
  { name: 'Bỏ preStop', edits: [NO_PRESTOP], test: 'rollout restart', lag: '5s' },
  { name: 'Bỏ cả preStop lẫn gửi lại', edits: [NO_PRESTOP, NO_RETRY], test: 'rollout restart', lag: '5s' },
  {
    name: 'Không gửi lại khi kết nối hỏng',
    edits: [{ file: CLIENT, from: '        if (attempt >= this.options.retries) {\n', to: '        if (attempt >= 0) {\n' }],
    test: 'gửi lại một lần',
    testFile: CLIENT_TESTS,
  },
  {
    name: 'Không đặt connect timeout',
    edits: [{ file: CLIENT, from: 'connect: { timeout: options.connectTimeoutMs },', to: 'connect: { timeout: 10_000 },' }],
    test: 'connect timeout',
    testFile: CLIENT_TESTS,
  },
  { name: 'Bỏ readiness probe', edits: [NO_READINESS], test: 'rollout restart' },
  {
    name: '/ready luôn trả 200',
    edits: [
      {
        file: 'src/pricing/server.ts',
        from: "    dependenciesReady && !forcedNotReady ? 'ok' : reply.code(503).send('chưa sẵn sàng'),\n",
        to: "    dependenciesReady || !forcedNotReady || true ? 'ok' : reply.code(503).send('chưa sẵn sàng'),\n",
      },
    ],
    test: 'pod chưa Ready',
  },
  {
    name: 'Liveness kiểm nhầm /ready',
    edits: [{ file: PRICING_YAML, from: '              path: /live\n', to: '              path: /ready\n' }],
    test: 'pod chưa Ready',
  },
  {
    name: 'Không giới hạn tuổi kết nối',
    edits: [
      {
        file: ORDER_YAML,
        from: `            - name: CONNECTION_MAX_AGE_MS
              value: "1000"
`,
        to: `            - name: CONNECTION_MAX_AGE_MS
              value: "0"
`,
      },
    ],
    test: 'pod mới scale ra',
  },
  {
    name: 'Service headless thành ClusterIP',
    edits: [{ file: PRICING_YAML, from: '  clusterIP: None\n', to: '' }],
    test: 'headless Service',
  },
];

interface VitestReport {
  numTotalTests: number;
  numFailedTests: number;
  numPassedTests: number;
  testResults: { assertionResults: { fullName: string; status: string }[] }[];
}

const outDir = join('bench/results', process.env.RUN ?? 'trial');
mkdirSync(outDir, { recursive: true });
const reportFile = join(outDir, 'drill-vitest.json');

function useLag(lag: string): void {
  const env = { ...process.env, PATH: `${process.env.HOME}/.docker/bin:${process.env.PATH}`, KUBE_PROXY_MIN_SYNC: lag };
  // down -v: dữ liệu k3s nằm trong volume, giữ lại thì pod cũ bị gắn vào node của container đã xóa.
  spawnSync('docker', ['compose', 'down', '-v'], { encoding: 'utf8', env });
  spawnSync('docker', ['compose', 'up', '-d', '--wait'], { encoding: 'utf8', env });
}

function runTests({ test, testFile = CLUSTER_TESTS }: Drill): VitestReport {
  rmSync(reportFile, { force: true });
  spawnSync('pnpm', ['-s', 'build'], { encoding: 'utf8' });
  spawnSync('npx', ['vitest', 'run', testFile, '-t', test, '--reporter=json', `--outputFile=${reportFile}`], {
    encoding: 'utf8',
  });
  return JSON.parse(readFileSync(reportFile, 'utf8')) as VitestReport;
}

const results = [];
// Các phép thử cùng độ trễ đứng liền nhau để chỉ tạo lại k3s khi cần.
let lag = DRILLS[0]?.lag ?? '1s';
useLag(lag);
for (const drill of DRILLS) {
  if ((drill.lag ?? '1s') !== lag) {
    lag = drill.lag ?? '1s';
    useLag(lag);
  }
  const originals = new Map(drill.edits.map((edit) => [edit.file, readFileSync(edit.file, 'utf8')]));
  for (const edit of drill.edits) {
    if ((originals.get(edit.file) as string).split(edit.from).length !== 2) {
      throw new Error(`"${drill.name}": chuỗi cần sửa phải xuất hiện đúng một lần trong ${edit.file}`);
    }
  }
  // Nền phải xanh trước khi sửa, nếu không test đỏ vì lý do khác và phép thử âm "đạt" giả.
  const baseline = runTests(drill);
  if (baseline.numPassedTests === 0 || baseline.numFailedTests > 0) {
    throw new Error(`"${drill.name}": test "${drill.test}" chưa xanh trước khi sửa (${baseline.numFailedTests} đỏ)`);
  }
  try {
    for (const edit of drill.edits) {
      writeFileSync(edit.file, readFileSync(edit.file, 'utf8').replace(edit.from, () => edit.to));
    }
    const report = runTests(drill);
    const failed = report.testResults
      .flatMap((file) => file.assertionResults)
      .filter((test) => test.status === 'failed')
      .map((test) => test.fullName);
    results.push({ name: drill.name, ran: report.numPassedTests + report.numFailedTests, failed: report.numFailedTests, failedTests: failed });
    console.log(`${report.numFailedTests > 0 ? 'đạt ' : 'KHÔNG ĐẠT'} ${drill.name}: ${report.numFailedTests} test đỏ`);
  } finally {
    for (const [file, original] of originals) {
      writeFileSync(file, original);
    }
  }
}
rmSync(reportFile, { force: true });
spawnSync('pnpm', ['-s', 'build'], { encoding: 'utf8' });

writeFileSync(join(outDir, 'drills.json'), JSON.stringify(results, null, 2));
if (results.some((result) => result.ran === 0 || result.failed === 0)) {
  process.exit(1);
}
