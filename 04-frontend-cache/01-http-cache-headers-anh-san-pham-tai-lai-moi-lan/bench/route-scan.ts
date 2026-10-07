/**
 * Chỉ số "số route có xác thực trả public" của mục 5, cho cả hai bản: quét mọi route có guard (test/support/route-scan.ts,
 * cùng hàm mà test authenticated-routes-are-private dùng), gọi khi đã đăng nhập và khi chưa.
 *   RUN=main pnpm bench:routes   → bench/results/<RUN>/route-scan.json
 */
import 'reflect-metadata';
import { join } from 'node:path';
import type { CacheMode } from '../src/shared/config';
import { inProcessApi } from '../test/support/lab';
import { listRoutes, scanGuardedRoutes } from '../test/support/route-scan';
import { resultsDir, writeJson } from './lib';

const out: Record<string, unknown> = {};
for (const mode of ['truoc', 'sau'] as CacheMode[]) {
  const app = await inProcessApi(mode);
  const routes = listRoutes(app);
  const results = await scanGuardedRoutes(app);
  await app.close();
  const violating = [...new Set(results.filter((r) => r.violation).map((r) => r.route))];
  out[mode] = {
    routes: routes.length,
    guardedRoutes: routes.filter((r) => r.guards.length > 0).length,
    callsChecked: results.length,
    guardedRoutesReturningShareable: violating.length,
    violating,
    results,
  };
  console.log(`${mode}: ${routes.length} route, ${routes.filter((r) => r.guards.length > 0).length} có guard, ${violating.length} trả public: ${violating.join(', ') || '—'}`);
}
writeJson(join(resultsDir(), 'route-scan.json'), out);
