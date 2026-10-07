/**
 * Tính chỉ số của một lượt tải từ file thô (log Nginx, log truy cập của hai máy gốc, summary của k6). Chạy riêng được để
 * tính lại từ file thô:  RUN=main NAME=truoc pnpm tsx bench/analyze-load.ts
 *   - request tới máy gốc mỗi phút (log truy cập của API + trang), phút tính từ request đầu tiên CDN nhận;
 *   - trạng thái cache của CDN ($upstream_cache_status) theo loại tài nguyên; tỉ lệ HIT của ảnh + file tĩnh;
 *   - tỉ lệ 304 của JSON công khai (mọi lượt và chỉ lượt xem lặp lại, theo header X-Visit do k6 gắn).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJsonLines, resultsDir, writeJson } from './lib';

interface CdnLine {
  ts: number;
  m: string;
  u: string;
  s: number;
  cache: string;
  us: string;
  bytes: number;
  inm: string;
  visit: string;
}
interface OriginLine {
  t: number;
  m: string;
  u: string;
  s: number;
  inm: string | null;
}

export function category(u: string): string {
  if (u.startsWith('/_next/static/')) return 'static';
  if (u.startsWith('/media/')) return 'media';
  if (u.startsWith('/api/products')) return 'public-json';
  if (u.startsWith('/api/cart')) return 'private-json';
  if (u.startsWith('/api/') || u.startsWith('/ops/') || u.startsWith('/__')) return 'other';
  return 'html';
}

const count = <T>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((acc, x) => ((acc[key(x)] = (acc[key(x)] ?? 0) + 1), acc), {});
const pct = (a: number, b: number) => (b ? Number(((100 * a) / b).toFixed(2)) : null);

export function analyze(dir: string, name: string) {
  const cdn = readJsonLines<CdnLine>(join(dir, `${name}-cdn.log`)).filter((l) => !l.u.startsWith('/__'));
  const origin = [...readJsonLines<OriginLine>(join(dir, `${name}-origin-api.log`)), ...readJsonLines<OriginLine>(join(dir, `${name}-origin-web.log`))].filter(
    (l) => !l.u.startsWith('/ops/') && !l.u.startsWith('/__ops'),
  );
  // reduce thay vì Math.min(...): log có hàng trăm nghìn dòng, spread vượt giới hạn tham số.
  const t0 = cdn.reduce((m, l) => Math.min(m, l.ts * 1000), Infinity);
  const tEnd = cdn.reduce((m, l) => Math.max(m, l.ts * 1000), -Infinity);
  // số phút đủ (cho phép thiếu 1 giây: lượt 360 giây có request cuối ở giây 359,9)
  const minutes = Math.floor((tEnd - t0 + 1_000) / 60_000);

  // request tới máy gốc theo phút (chỉ các phút đủ 60 giây)
  const perMinute = Array.from({ length: minutes }, (_, i) => {
    const inMin = origin.filter((l) => l.t >= t0 + i * 60_000 && l.t < t0 + (i + 1) * 60_000);
    return { minute: i + 1, originRequests: inMin.length, byCategory: count(inMin, (l) => category(l.u)) };
  });
  const steady = perMinute.slice(1);

  const byCat = (cat: string) => cdn.filter((l) => category(l.u) === cat);
  const cdnByCategory = Object.fromEntries(
    ['html', 'static', 'media', 'public-json', 'private-json'].map((cat) => {
      const ls = byCat(cat);
      return [cat, { requests: ls.length, cacheStatus: count(ls, (l) => l.cache || '-'), status: count(ls, (l) => String(l.s)), toOrigin: ls.filter((l) => l.us !== '').length }];
    }),
  );
  const assets = cdn.filter((l) => ['static', 'media'].includes(category(l.u)));
  const assetsHit = assets.filter((l) => l.cache === 'HIT').length;
  const pub = byCat('public-json');
  const pubRepeat = pub.filter((l) => l.visit === 'repeat');
  const steadyCdn = cdn.filter((l) => l.ts * 1000 >= t0 + 60_000);
  const steadyAssets = steadyCdn.filter((l) => ['static', 'media'].includes(category(l.u)));

  const k6File = join(dir, `${name}-k6-summary.json`);
  const k6 = existsSync(k6File) ? (JSON.parse(readFileSync(k6File, 'utf8')) as { metrics: Record<string, { values: Record<string, number> }> }) : null;
  const metric = (m: string, v = 'count') => k6?.metrics[m]?.values[v] ?? 0;

  return {
    name,
    windowSeconds: Number(((tEnd - t0) / 1000).toFixed(1)),
    k6: k6 && {
      pageViews: metric('page_views'),
      repeatPageViews: metric('repeat_page_views'),
      iterations: metric('iterations'),
      droppedIterations: metric('dropped_iterations'),
      httpReqs: metric('http_reqs'),
      httpReqFailedRate: metric('http_req_failed', 'rate'),
      badStatus: metric('bad_status'),
      browserCacheUse: metric('browser_cache_use'),
      conditionalRequests: metric('conditional_requests'),
      responses304: metric('responses_304'),
      cartLeak: metric('cart_leak'),
      reqDurationMs: k6.metrics.http_req_duration?.values,
    },
    origin: {
      total: origin.length,
      perMinute,
      steadyPerMinute: steady.map((m) => m.originRequests),
      steadyAvgPerMinute: steady.length ? Math.round(steady.reduce((s, m) => s + m.originRequests, 0) / steady.length) : null,
      byCategory: count(origin, (l) => category(l.u)),
      status: count(origin, (l) => String(l.s)),
    },
    cdn: {
      requests: cdn.length,
      toOrigin: cdn.filter((l) => l.us !== '').length,
      byCategory: cdnByCategory,
      assetsHitRatioPct: pct(assetsHit, assets.length),
      assetsHitRatioSteadyPct: pct(steadyAssets.filter((l) => l.cache === 'HIT').length, steadyAssets.length),
      staticHitRatioPct: pct(byCat('static').filter((l) => l.cache === 'HIT').length, byCat('static').length),
      mediaHitRatioPct: pct(byCat('media').filter((l) => l.cache === 'HIT').length, byCat('media').length),
      publicJson304Pct: pct(pub.filter((l) => l.s === 304).length, pub.length),
      publicJson304RepeatPct: pct(pubRepeat.filter((l) => l.s === 304).length, pubRepeat.length),
      publicJsonRepeatRequests: pubRepeat.length,
      publicJsonRepeatConditional: pubRepeat.filter((l) => l.inm !== '').length,
      htmlRepeat: count(byCat('html').filter((l) => l.visit === 'repeat'), (l) => `${l.s} ${l.cache}`),
      allHitRatioPct: pct(cdn.filter((l) => l.cache === 'HIT').length, cdn.length),
      bytesSent: cdn.reduce((s, l) => s + l.bytes, 0),
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const name = process.env.NAME;
  if (!name) throw new Error('đặt NAME=<tên lượt>');
  const dir = resultsDir();
  writeJson(join(dir, `${name}-analysis.json`), analyze(dir, name));
}
