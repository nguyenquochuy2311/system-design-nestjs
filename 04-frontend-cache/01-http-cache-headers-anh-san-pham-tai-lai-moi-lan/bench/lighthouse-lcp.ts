/**
 * LCP của trang danh mục bằng Lighthouse (cấu hình mặc định: mobile, throttling "simulate" 4G chậm, CPU chậm 4 lần),
 * chạy trên Google Chrome đã cài (chrome-launcher trỏ vào Chrome hệ thống, headless, profile tạm do chrome-launcher tạo).
 * Mỗi vòng: một lượt "lạnh" (Lighthouse xóa cache trước khi tải) rồi một lượt "lặp lại" (disableStorageReset: giữ
 * cache của lượt lạnh, như khách quay lại). ROUNDS vòng mỗi bản, trung vị; mọi LHR thô lưu cạnh kết quả.
 *   RUN=main pnpm bench:lcp      (MODES=truoc,sau ROUNDS=5 PAGE=/danh-muc/dien-thoai)
 */
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { join } from 'node:path';
import type { CacheMode } from '../src/shared/config';
import { sessionCookie } from '../test/support/lab';
import { CHROME_PATH, collectCdnLog, environment, median, resetCdn, resultsDir, startOrigins, writeJson } from './lib';

const MODES = (process.env.MODES ?? 'truoc,sau').split(',') as CacheMode[];
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const PAGE = process.env.PAGE ?? '/danh-muc/dien-thoai';
const URL = `http://127.0.0.1:58088${PAGE}`;
const dir = resultsDir();

interface Row {
  round: number;
  kind: 'cold' | 'repeat';
  lcpMs: number | undefined;
  fcpMs: number | undefined;
  totalByteWeight: number | undefined;
  requests: number;
  transferSizeSum: number;
  requestsWithZeroTransfer: number;
  runWarnings: unknown;
  file: string;
}

interface Audit {
  numericValue?: number;
  details?: { items?: { transferSize?: number; resourceSize?: number; url?: string; statusCode?: number }[] };
}

const env = await environment();
const out: Record<string, unknown> = {};
for (const mode of MODES) {
  const origins = await startOrigins(mode, dir, `lcp-${mode}`, false);
  await resetCdn();
  const chrome = await chromeLauncher.launch({ chromePath: CHROME_PATH, chromeFlags: ['--headless=new'] });
  const runs: Row[] = [];
  try {
    for (let round = 1; round <= ROUNDS; round++) {
      for (const kind of ['cold', 'repeat'] as const) {
        const result = await lighthouse(URL, {
          port: chrome.port,
          output: 'json',
          logLevel: 'error',
          onlyCategories: ['performance'],
          disableStorageReset: kind === 'repeat',
          extraHeaders: { Cookie: sessionCookie(77) },
        });
        if (!result) throw new Error('Lighthouse không trả kết quả');
        const lhr = result.lhr;
        const file = join(dir, `lcp-${mode}-r${round}-${kind}.lhr.json`);
        writeJson(file, lhr);
        const a = lhr.audits as Record<string, Audit>;
        const items = a['network-requests']?.details?.items ?? [];
        const row: Row = {
          round,
          kind,
          lcpMs: a['largest-contentful-paint']?.numericValue,
          fcpMs: a['first-contentful-paint']?.numericValue,
          totalByteWeight: a['total-byte-weight']?.numericValue,
          requests: items.length,
          transferSizeSum: items.reduce((s, i) => s + (i.transferSize ?? 0), 0),
          requestsWithZeroTransfer: items.filter((i) => (i.transferSize ?? 0) === 0).length,
          runWarnings: lhr.runWarnings,
          file,
        };
        runs.push(row);
        console.log(`${mode} vòng ${round} ${kind}: LCP ${row.lcpMs?.toFixed(0)} ms, ${row.requests} request, transfer ${row.transferSizeSum} B`);
      }
    }
    const first = runs[0] && (await import(`../${runs[0].file}`, { with: { type: 'json' } })).default;
    const pick = (kind: string) => runs.filter((r) => r.kind === kind).map((r) => r.lcpMs ?? NaN);
    out[mode] = {
      lcpRepeat: { medianMs: median(pick('repeat')), values: pick('repeat') },
      lcpCold: { medianMs: median(pick('cold')), values: pick('cold') },
      lighthouseVersion: first?.lighthouseVersion,
      userAgent: first?.environment?.hostUserAgent,
      configSettings: first && {
        formFactor: first.configSettings.formFactor,
        throttlingMethod: first.configSettings.throttlingMethod,
        throttling: first.configSettings.throttling,
        screenEmulation: first.configSettings.screenEmulation,
      },
      runs,
    };
  } finally {
    await chrome.kill();
    await origins.stop();
    await collectCdnLog(join(dir, `lcp-${mode}-cdn.log`));
  }
}
writeJson(join(dir, 'lcp.json'), { page: PAGE, rounds: ROUNDS, environment: env, ...out });
