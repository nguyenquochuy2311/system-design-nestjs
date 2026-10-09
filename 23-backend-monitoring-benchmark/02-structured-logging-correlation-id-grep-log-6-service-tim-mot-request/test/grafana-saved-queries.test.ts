// Grafana: không cho xem ẩn danh, datasource Loki khỏe, mọi truy vấn lưu sẵn của dashboard chạy được trên Loki thật
// (thay biến $topup_id/$trace_id bằng giá trị của một lần nạp thật) và trả đúng hành trình.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANK_TIMEOUT, fakePhone, grafanaAuth, lokiInstantSum, lokiRange, sendTopup, SERVICES, URLS, waitForJourney } from './support/stack.js';

interface Panel { title: string; type: string; targets?: { expr: string }[] }
const dashboard = JSON.parse(readFileSync('infra/grafana/dashboards/topup-journey.json', 'utf8')) as { uid: string; panels: Panel[] };

describe('Grafana và truy vấn lưu sẵn', () => {
  it('ẩn danh bị từ chối (401), admin đọc được dashboard đã provision', async () => {
    expect((await fetch(`${URLS.grafana}/api/dashboards/uid/${dashboard.uid}`)).status).toBe(401);
    const res = await fetch(`${URLS.grafana}/api/dashboards/uid/${dashboard.uid}`, { headers: { authorization: grafanaAuth() } });
    expect(res.status).toBe(200);
  });

  it('datasource Loki khỏe', async () => {
    const res = await fetch(`${URLS.grafana}/api/datasources/uid/loki/health`, { headers: { authorization: grafanaAuth() } });
    expect(((await res.json()) as { status: string }).status).toBe('OK');
  });

  it('mọi truy vấn của dashboard chạy được; truy vấn theo topup_id và trace_id ra đúng hành trình 4 service', async () => {
    const start = Date.now() - 2000;
    const { topup_id } = await sendTopup({ phone: fakePhone(71), amount: 2_071_000, bank: BANK_TIMEOUT });
    const j = await waitForJourney(topup_id, start);
    const fill = (expr: string) =>
      expr.replaceAll('$topup_id', topup_id).replaceAll('$trace_id', j.traceId!).replaceAll('$__auto', '1m').replaceAll('$__range', '10m');
    for (const p of dashboard.panels) {
      for (const t of p.targets ?? []) {
        const expr = fill(t.expr);
        if (p.type === 'logs') {
          const lines = await lokiRange(expr, start);
          if (p.title.includes('trace_id')) expect(new Set(lines.map((l) => l.service)), p.title).toEqual(new Set(SERVICES));
          if (p.title.includes('topup_id')) expect(lines.length, p.title).toBeGreaterThanOrEqual(3);
        } else {
          await expect(lokiInstantSum(expr), p.title).resolves.toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
