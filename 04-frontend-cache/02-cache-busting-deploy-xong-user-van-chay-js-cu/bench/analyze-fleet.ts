/**
 * Tính chỉ số của một lượt bench/fleet.ts từ dữ liệu thô (quan sát, mẫu phiên bản, log API, log CDN).
 * Chạy lại được trên file đã ghi:   RUN=main NAME=sau pnpm tsx bench/analyze-fleet.ts
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CdnLine } from './lib';
import { median, readJsonLines, resultsDir, writeJson } from './lib';

const TO = '42';

interface ApiLine {
  t: number;
  m: string;
  u: string;
  s: number;
  v: string | null;
  uid: string | null;
  note?: { id: number; lost: boolean; fields: string[] };
  clientError?: { kind: string; message: string; version: string | null; path: string };
}
interface RawFleet {
  name: string;
  site: string;
  config: { POST_S: number; SAMPLE_MS: number; USERS: number };
  deployAt: number;
  users: { uid: string; kind: string }[];
  observations: { t: number; uid: string; action: string; ok: boolean; version: string | null; blank: boolean; banner: boolean; note?: string }[];
  samples: { t: number; k?: number; uid: string; version: string | null; blank: boolean }[];
  pageErrors: { t: number; uid: string; message: string }[];
  failedResponses: { t: number; uid: string; status: number; url: string }[];
  load: { hostLoad1: number; dockerLoad1: number; dockerBusyPct: number | null }[];
  machineSleep?: { from: number; to: number; seconds: number }[];
}

const category = (m: string) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/.test(m)
    ? 'loi-tai-chunk'
    : /Cannot read properties of undefined|is not a function|undefined is not/.test(m)
      ? 'TypeError'
      : 'khac';

const countBy = <T>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((acc, x) => ((acc[key(x)] = (acc[key(x)] ?? 0) + 1), acc), {});
const pct = (a: number, b: number) => (b === 0 ? null : Number(((100 * a) / b).toFixed(2)));
const minMax = (xs: number[]) => (xs.length ? [Math.min(...xs), Math.max(...xs)] : null);

export function analyzeFleet(raw: RawFleet, apiLogFile: string, cdn: CdnLine[]) {
  const T0 = raw.deployAt;
  const api = readJsonLines<ApiLine>(apiLogFile);
  const postApi = api.filter((l) => l.t >= T0);
  const minutes = Math.ceil(raw.config.POST_S / 60);

  // 1. Tỉ lệ người dùng còn chạy bản cũ tại mốc mỗi phút (mẫu đọc window.__APP__.version của tab đang mở).
  const sweeps = new Map<number, typeof raw.samples>();
  for (const s of raw.samples) {
    const k = s.k ?? Math.round(s.t / raw.config.SAMPLE_MS);
    sweeps.set(k, [...(sweeps.get(k) ?? []), s]);
  }
  const oldShareByMinute = Array.from({ length: minutes + 1 }, (_, m) => {
    const k = Math.round((m * 60_000) / raw.config.SAMPLE_MS);
    const xs = sweeps.get(k) ?? [];
    const known = xs.filter((s) => s.version !== null);
    const old = known.filter((s) => s.version !== TO);
    return {
      minute: m,
      users: xs.length,
      old: old.length,
      // Tỉ lệ trên số tab đọc được phiên bản; tab đang chuyển trang (không đọc được) ghi riêng ở `unknown`.
      oldPct: pct(old.length, known.length),
      unknown: xs.length - known.length,
      blank: xs.filter((s) => s.blank).length,
    };
  });

  // 2. Thời điểm (và số thao tác) từ lúc deploy tới khi mỗi người dùng chạy bản 42.
  const perUser = raw.users.map((u) => {
    const seen = [...raw.observations.filter((o) => o.uid === u.uid && o.t >= 0), ...raw.samples.filter((s) => s.uid === u.uid && s.t >= 0)]
      .filter((x) => x.version === TO)
      .map((x) => x.t);
    const firstNew = seen.length ? Math.min(...seen) : null;
    const actions = raw.observations.filter((o) => o.uid === u.uid && o.t >= 0 && (firstNew === null || o.t <= firstNew)).length;
    return { uid: u.uid, kind: u.kind, firstNewMs: firstNew, actionsUntilNew: firstNew === null ? null : actions };
  });
  const converted = perUser.filter((u) => u.firstNewMs !== null);
  const openers = perUser.filter((u) => u.kind === 'mo-san');
  const openersConverted = openers.filter((u) => u.firstNewMs !== null);
  const allNewFrom = () => {
    const keys = [...sweeps.keys()].filter((k) => k >= 0).sort((x, y) => x - y);
    let from: number | null = null;
    for (const k of keys) {
      const xs = sweeps.get(k)!;
      if (xs.some((s) => s.version !== null && s.version !== TO)) from = null;
      else from ??= Math.min(...xs.map((s) => s.t));
    }
    return from;
  };

  // 3. Lỗi phía trình duyệt sau deploy: bộ đo inline gửi về API, đối chiếu với pageerror của Playwright.
  const clientErrors = postApi.filter((l) => l.clientError).map((l) => ({ ...l.clientError!, uid: l.uid }));
  const jsErrors = clientErrors.filter((e) => e.kind === 'error' || e.kind === 'rejection');
  const postPageErrors = raw.pageErrors.filter((e) => e.t >= 0);

  // 4. Ghi chú lưu sau deploy, ghi chú bị mất (API lưu rỗng trong khi client gửi chữ ở trường khác).
  const notes = postApi.filter((l) => l.note);
  const prePageErrors = raw.pageErrors.filter((e) => e.t < 0);

  // 5. Request API (không tính /api/client-errors) từ bản cũ, theo phút sau deploy.
  const calls = postApi.filter((l) => l.u.startsWith('/api/') && !l.u.startsWith('/api/client-errors'));
  const apiOldByMinute = Array.from({ length: minutes }, (_, m) => {
    const xs = calls.filter((l) => l.t - T0 >= m * 60_000 && l.t - T0 < (m + 1) * 60_000);
    const old = xs.filter((l) => l.v !== TO);
    return { minute: m + 1, requests: xs.length, old: old.length, oldPct: pct(old.length, xs.length) };
  });

  // 6. CDN: file tĩnh sau deploy — lỗi 404, byte theo người dùng, trạng thái cache.
  const staticPost = cdn.filter((l) => l.ts * 1000 >= T0 && !l.u.startsWith('/api/'));
  const notFound = staticPost.filter((l) => l.s === 404);
  const bytesByUser = raw.users.map((u) => staticPost.filter((l) => l.uid === u.uid).reduce((a, l) => a + l.bytes, 0));
  const obsPost = raw.observations.filter((o) => o.t >= 0);
  const blankObs = obsPost.filter((o) => o.blank);

  return {
    name: raw.name,
    site: raw.site,
    users: raw.users.length,
    actionsAfterDeploy: obsPost.length,
    actionsByType: countBy(obsPost, (o) => o.action),
    failedActions: obsPost.filter((o) => !o.ok).length,
    oldShareByMinute,
    convertedUsers: converted.length,
    openTabsConverted: `${openersConverted.length}/${openers.length}`,
    // Mốc đầu tiên mà từ đó mọi phiên đang mở (mọi mẫu) đều chạy bản 42; null = tới hết lượt vẫn còn phiên bản cũ.
    allSessionsNewFromMs: allNewFrom(),
    openTabsAllNewMs: openersConverted.length === openers.length ? Math.max(...openers.map((u) => u.firstNewMs!)) : null,
    openTabFirstNewMs: { median: median(openersConverted.map((u) => u.firstNewMs!)), minMax: minMax(openersConverted.map((u) => u.firstNewMs!)) },
    openTabActionsUntilNew: { median: median(openersConverted.map((u) => u.actionsUntilNew!)), minMax: minMax(openersConverted.map((u) => u.actionsUntilNew!)) },
    perUser,
    jsErrors: {
      count: jsErrors.length,
      users: new Set(jsErrors.map((e) => e.uid)).size,
      byCategory: countBy(jsErrors, (e) => category(e.message)),
      byVersion: countBy(jsErrors, (e) => String(e.version)),
      samples: [...new Set(jsErrors.map((e) => e.message))].slice(0, 5),
    },
    resourceErrors: { count: clientErrors.filter((e) => e.kind === 'resource').length, users: new Set(clientErrors.filter((e) => e.kind === 'resource').map((e) => e.uid)).size },
    chunkReloads: { count: clientErrors.filter((e) => e.kind === 'chunk-reload').length, users: new Set(clientErrors.filter((e) => e.kind === 'chunk-reload').map((e) => e.uid)).size },
    playwrightPageErrors: { count: postPageErrors.length, users: new Set(postPageErrors.map((e) => e.uid)).size, byCategory: countBy(postPageErrors, (e) => category(e.message)), beforeDeploy: prePageErrors.length },
    blankScreens: { observations: blankObs.length, users: new Set(blankObs.map((o) => o.uid)).size },
    reloads: { f5: obsPost.filter((o) => o.action === 'f5').length, ctrlF5: obsPost.filter((o) => o.action === 'ctrl-f5').length },
    notes: { saved: notes.length, lost: notes.filter((l) => l.note!.lost).length, byClientVersion: countBy(notes, (l) => String(l.v)), lostByClientVersion: countBy(notes.filter((l) => l.note!.lost), (l) => String(l.v)) },
    apiOldByMinute,
    apiOldTotal: { requests: calls.length, old: calls.filter((l) => l.v !== TO).length, oldPct: pct(calls.filter((l) => l.v !== TO).length, calls.length) },
    apiErrors: countBy(calls.filter((l) => l.s >= 400), (l) => String(l.s)),
    cdn: {
      staticRequests: staticPost.length,
      notFound: notFound.length,
      notFoundUrls: countBy(notFound, (l) => l.u),
      byCache: countBy(staticPost, (l) => l.cache || '-'),
      bytesPerUser: { median: median(bytesByUser), minMax: minMax(bytesByUser), total: bytesByUser.reduce((a, b) => a + b, 0) },
    },
    machineSleep: raw.machineSleep
      ? { gaps: raw.machineSleep.length, totalSeconds: Number(raw.machineSleep.reduce((a, g) => a + g.seconds, 0).toFixed(1)), clean: raw.machineSleep.length === 0 }
      : 'không ghi (lượt chạy trước khi có bộ phát hiện; xem bench/results/main/pmset-sleep.log)',
    load: {
      hostLoad1: minMax(raw.load.map((l) => l.hostLoad1)),
      dockerLoad1: minMax(raw.load.map((l) => l.dockerLoad1)),
      dockerBusyPct: minMax(raw.load.map((l) => l.dockerBusyPct).filter((x): x is number => x !== null)),
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const dir = resultsDir();
  const name = process.env.NAME ?? 'sau';
  const raw = JSON.parse(readFileSync(join(dir, `fleet-${name}.json`), 'utf8')) as RawFleet;
  const cdn = JSON.parse(readFileSync(join(dir, `fleet-${name}-cdn.json`), 'utf8')) as CdnLine[];
  writeJson(join(dir, `fleet-${name}-summary.json`), analyzeFleet(raw, join(dir, `fleet-${name}-api.log`), cdn));
}
