/** Báo cáo sức khỏe dùng chung cho mọi service trong monorepo. */
export interface HealthReport {
  status: 'ok';
  service: string;
  uptimeSeconds: number;
  runtime: string;
}

export function buildHealthReport(service: string, startedAt: number, runtime: string, now: number = Date.now()): HealthReport {
  return { status: 'ok', service, uptimeSeconds: Math.round((now - startedAt) / 1000), runtime };
}
