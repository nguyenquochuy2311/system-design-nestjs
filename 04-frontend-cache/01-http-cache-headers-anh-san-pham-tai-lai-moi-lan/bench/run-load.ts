/**
 * Một lượt tải: bật máy gốc của một bản (có log truy cập), làm trống CDN, chạy k6 (bench/repeat-visit.k6.js) qua CDN,
 * lấy mẫu tải của máy mỗi 10 giây và CPU của hai tiến trình máy gốc, rồi tính chỉ số (bench/analyze-load.ts).
 *   RUN=main NAME=truoc MODE=truoc VIEWS_PER_S=20 DURATION_S=360 pnpm bench:load
 * File thô: <NAME>-cdn.log, <NAME>-origin-api.log, <NAME>-origin-web.log, <NAME>-k6-summary.json, <NAME>-k6.out.
 */
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';
import type { CacheMode } from '../src/shared/config';
import { SECRET } from '../test/support/lab';
import { analyze } from './analyze-load';
import { collectCdnLog, environment, processCpuSeconds, resetCdn, resultsDir, startLoadSampler, startOrigins, writeJson } from './lib';

const mode = (process.env.MODE ?? 'sau') as CacheMode;
const name = process.env.NAME ?? mode;
const viewsPerS = Number(process.env.VIEWS_PER_S ?? 20);
const durationS = Number(process.env.DURATION_S ?? 360);
const vus = Number(process.env.VUS ?? 300);
const dir = resultsDir();

const env = await environment();
const origins = await startOrigins(mode, dir, name, true);
let analysis;
try {
  await resetCdn();
  const sampler = startLoadSampler();
  const cpu0 = { api: await processCpuSeconds(origins.api.pid), web: await processCpuSeconds(origins.web.pid) };
  const started = Date.now();
  const k6Out = openSync(join(dir, `${name}-k6.out`), 'w');
  const code = await new Promise<number>((resolve) => {
    const k6 = spawn('k6', ['run', 'bench/repeat-visit.k6.js'], {
      env: {
        ...process.env,
        VIEWS_PER_S: String(viewsPerS),
        DURATION: `${durationS}s`,
        VUS: String(vus),
        SESSION_SECRET: SECRET,
        SUMMARY_FILE: join(dir, `${name}-k6-summary.json`),
      },
      stdio: ['ignore', k6Out, k6Out],
    });
    k6.on('exit', (c) => resolve(c ?? 1));
  });
  const elapsedS = (Date.now() - started) / 1000;
  const cpu1 = { api: await processCpuSeconds(origins.api.pid), web: await processCpuSeconds(origins.web.pid) };
  const load = await sampler.stop();
  await collectCdnLog(join(dir, `${name}-cdn.log`));
  analysis = {
    mode,
    viewsPerS,
    durationS,
    vus,
    k6ExitCode: code,
    environment: env,
    originCpuPct: {
      api: cpu0.api !== null && cpu1.api !== null ? Number(((100 * (cpu1.api - cpu0.api)) / elapsedS).toFixed(1)) : null,
      web: cpu0.web !== null && cpu1.web !== null ? Number(((100 * (cpu1.web - cpu0.web)) / elapsedS).toFixed(1)) : null,
    },
    load: {
      hostLoad1: [Math.min(...load.map((l) => l.hostLoad1)), Math.max(...load.map((l) => l.hostLoad1))],
      dockerLoad1: [Math.min(...load.map((l) => l.dockerLoad1)), Math.max(...load.map((l) => l.dockerLoad1))],
      dockerBusyPct: [
        Math.min(...load.flatMap((l) => (l.dockerBusyPct === null ? [] : [l.dockerBusyPct]))),
        Math.max(...load.flatMap((l) => (l.dockerBusyPct === null ? [] : [l.dockerBusyPct]))),
      ],
      samples: load,
    },
    ...analyze(dir, name),
  };
} finally {
  await origins.stop();
}
writeJson(join(dir, `${name}.json`), analysis);
const a = analysis;
console.log(
  `${name}: ${a.k6?.pageViews} lượt xem, bỏ ${a.k6?.droppedIterations}, lỗi ${a.k6?.badStatus} · máy gốc ${a.origin.steadyAvgPerMinute}/phút (từ phút 2) · ` +
    `HIT ảnh+tĩnh ${a.cdn.assetsHitRatioPct} % · 304 JSON công khai ${a.cdn.publicJson304Pct} % (lặp lại ${a.cdn.publicJson304RepeatPct} %) · lộ giỏ ${a.k6?.cartLeak} · load host ${a.load.hostLoad1.join('–')}`,
);
