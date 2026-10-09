// Grafana: không cho xem khi chưa đăng nhập; datasource và hai dashboard được nạp từ file; mọi truy vấn trong
// dashboard chạy được trên Prometheus thật (biến $service thay bằng từng service).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVICES, URLS, promQuery } from './support/stack.js';

const auth = { authorization: `Basic ${Buffer.from(`admin:${process.env.GRAFANA_ADMIN_PASSWORD}`).toString('base64')}` };
const DASHBOARDS = ['red-overview', 'red-service'];

interface Panel {
  title: string;
  type: string;
  targets?: { expr: string }[];
}
const panelsOf = (uid: string) =>
  (JSON.parse(readFileSync(`infra/grafana/dashboards/${uid}.json`, 'utf8')) as { panels: Panel[] }).panels.filter(
    (p) => p.type !== 'row',
  );

describe('Grafana dashboard tổng quan và dashboard mẫu theo service', () => {
  it('chưa đăng nhập thì không đọc được dashboard (ẩn danh tắt)', async () => {
    const res = await fetch(`${URLS.grafana}/api/search`);
    expect(res.status).toBe(401);
  });

  it('datasource Prometheus khỏe và hai dashboard đã được nạp', async () => {
    const health = await fetch(`${URLS.grafana}/api/datasources/uid/prometheus/health`, { headers: auth });
    expect(((await health.json()) as { status: string }).status).toBe('OK');
    const search = (await (await fetch(`${URLS.grafana}/api/search?type=dash-db`, { headers: auth })).json()) as { uid: string }[];
    expect(search.map((d) => d.uid).sort()).toEqual(expect.arrayContaining(DASHBOARDS));
  });

  it.each(SERVICES)('mọi truy vấn của dashboard theo service chạy được với $service=%s', async (service) => {
    for (const panel of panelsOf('red-service')) {
      for (const t of panel.targets ?? []) {
        const expr = t.expr.replaceAll('$service', service);
        const result = await promQuery(expr); // ném lỗi nếu PromQL sai
        // Panel RED phải có dữ liệu cho mọi service; panel USE của pool DB chỉ có ở checkout.
        if (expr.includes('http_server_')) expect(result.length, `${panel.title}: ${expr}`).toBeGreaterThan(0);
        if (service === 'checkout' && expr.includes('db_client_connection')) expect(result.length, panel.title).toBeGreaterThan(0);
      }
    }
  });

  it('mọi truy vấn của dashboard tổng quan chạy được', async () => {
    for (const panel of panelsOf('red-overview')) {
      for (const t of panel.targets ?? []) await promQuery(t.expr);
    }
  });
});
