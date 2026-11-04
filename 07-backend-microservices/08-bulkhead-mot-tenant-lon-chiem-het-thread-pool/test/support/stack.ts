import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { createBulkhead, CrmModule, type CrmConfig } from '../../src/crm-api/crm.module';
import { startExportWorker, type ExportWorker } from '../../src/export-worker/worker';
import { setLogSink } from '../../src/shared/log';
import { createServiceApp } from '../../src/shared/service-app';

setLogSink(() => undefined);

export const REPORT_SECONDS = 0.4;

const url = (role: string) => `postgres://${role}:${role}@127.0.0.1:55432/lab`;
const DATABASE_URL = process.env.DATABASE_URL ?? url('crm_app');
export const connectAdmin = () => new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL ?? url('postgres'), max: 2 });

export async function resetData(admin: pg.Pool): Promise<void> {
  await admin.query(`
    TRUNCATE crm.notes, crm.exports;
    SELECT pgmq.purge_queue('exports');
    DELETE FROM pgmq.a_exports;`);
}

export interface Reply {
  status: number;
  ms: number;
  retryAfter: string | null;
  body: Record<string, unknown>;
}

export class Crm {
  readonly bulkhead;
  private app!: INestApplication;
  private worker: ExportWorker | undefined;
  url = '';

  constructor(private readonly config: Pick<CrmConfig, 'mode' | 'limits' | 'poolSizes'>) {
    this.bulkhead = createBulkhead({ limits: config.limits, reportSeconds: REPORT_SECONDS });
  }

  async start(): Promise<this> {
    this.app = await createServiceApp(
      'crm-api',
      CrmModule.register({ ...this.config, databaseUrl: DATABASE_URL, reportSeconds: REPORT_SECONDS }, this.bulkhead),
    );
    await this.app.listen(0, '127.0.0.1');
    const { port } = this.app.getHttpServer().address() as AddressInfo;
    this.url = `http://127.0.0.1:${port}`;
    return this;
  }

  startWorker(): void {
    this.worker = startExportWorker(DATABASE_URL, REPORT_SECONDS, 10);
  }

  async stop(): Promise<void> {
    await this.worker?.stop();
    await this.app.close();
  }

  private async send(method: string, path: string, tenantId: string, body?: unknown): Promise<Reply> {
    const startedAt = performance.now();
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await response.json()) as Record<string, unknown>;
    return { status: response.status, ms: performance.now() - startedAt, retryAfter: response.headers.get('retry-after'), body: parsed };
  }

  note = (tenantId: string) => this.send('POST', '/notes', tenantId, { body: 'Ghi chú' });
  report = (tenantId: string) => this.send('GET', '/reports/pipeline', tenantId);
  requestExport = (tenantId: string) => this.send('POST', '/exports', tenantId);
}

export async function waitUntil(condition: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(10);
  }
  throw new Error(`Hết giờ chờ: ${label}`);
}

export async function appConnections(admin: pg.Pool): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = 'crm_app'",
  );
  return rows[0]?.n ?? 0;
}

export { sleep };
