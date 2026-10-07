import { Test } from '@nestjs/testing';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { sql, type Kysely } from 'kysely';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { ExportWorker } from '../../src/sau/exports/export.worker';
import { APP_CONFIG, loadConfig, type AppConfig } from '../../src/shared/config';
import { createDb, type Database } from '../../src/shared/db';
import { OBJECT_STORAGE, type ObjectStorage } from '../../src/shared/object-storage';
import { WebModule } from '../../src/web.module';
import { WorkerModule } from '../../src/worker.module';

export type ExportsConfig = Partial<AppConfig['exports']>;
export const MONTH = '2026-09';

/** Cấu hình mặc định + ghi đè phần `exports`; mỗi file test dùng hàng đợi PGMQ riêng để không lẫn message. */
export function testConfig(exportsOverrides: ExportsConfig = {}, worker: Partial<AppConfig['worker']> = {}): AppConfig {
  const base = loadConfig();
  return { ...base, exports: { ...base.exports, ...exportsOverrides }, worker: { ...base.worker, pollMs: 100, ...worker } };
}

export const openDb = () => createDb(loadConfig().databaseUrl, 5);

export async function createQueue(db: Kysely<Database>): Promise<string> {
  const name = `t_${randomBytes(4).toString('hex')}`;
  await sql`SELECT pgmq.create(${name})`.execute(db);
  return name;
}

export async function dropQueue(db: Kysely<Database>, name: string): Promise<void> {
  await sql`SELECT pgmq.drop_queue(${name})`.execute(db);
}

/** Số message trong hàng đợi: tổng và số đang hiện (vt đã qua), đọc từ pgmq.metrics, không lấy message ra. */
export async function queueCounts(db: Kysely<Database>, queue: string): Promise<{ total: number; visible: number }> {
  const { rows } = await sql<{ queue_length: number; queue_visible_length: number }>`
    SELECT queue_length, queue_visible_length FROM pgmq.metrics(${queue})`.execute(db);
  return { total: Number(rows[0]?.queue_length ?? 0), visible: Number(rows[0]?.queue_visible_length ?? 0) };
}

export async function archivedMessages(db: Kysely<Database>, queue: string): Promise<{ msg_id: number; read_ct: number; message: unknown }[]> {
  const { rows } = await sql<{ msg_id: number; read_ct: number; message: unknown }>`
    SELECT msg_id, read_ct, message FROM ${sql.table(`pgmq.a_${queue}`)} ORDER BY msg_id`.execute(db);
  return rows;
}

/** Tenant mới có `rows` đơn trong tháng 9/2026 và `users` kế toán; test không dùng chung dữ liệu seed. */
export async function createTenant(db: Kysely<Database>, rows: number, users = 2): Promise<{ tenantId: number; userIds: number[] }> {
  const { id: tenantId } = await db.insertInto('tenants').values({ name: `Tenant test ${randomBytes(3).toString('hex')}` }).returning('id').executeTakeFirstOrThrow();
  const created = await db
    .insertInto('users')
    .values(Array.from({ length: users }, (_, i) => ({ tenant_id: tenantId, name: `Kế toán ${i + 1}`, role: 'accountant' })))
    .returning('id')
    .execute();
  await sql`
    INSERT INTO orders (tenant_id, code, store_name, customer_name, customer_phone, status, item_count, subtotal, discount, total, created_at)
    SELECT ${tenantId}, 'T' || ${tenantId} || '-' || g, 'Cửa hàng ' || (g % 10), 'Khách ' || g, '0900000000', 'paid', 1 + g % 5,
           100000 + g, 0, 100000 + g,
           timestamptz '2026-09-01 00:00:00+07' + ((g - 1)::double precision / ${rows}) * interval '30 days'
    FROM generate_series(1, ${rows}::int) g`.execute(db);
  return { tenantId, userIds: created.map((u) => u.id) };
}

export interface WebApp {
  app: INestApplication;
  baseUrl: string;
  close: () => Promise<void>;
}

/** Web process trong cùng tiến trình test, lắng nghe cổng ngẫu nhiên, gọi bằng fetch thật. */
export async function startWeb(config: AppConfig): Promise<WebApp> {
  const moduleRef = await Test.createTestingModule({ imports: [WebModule] }).overrideProvider(APP_CONFIG).useValue(config).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}`, close: () => app.close() };
}

/** Worker trong cùng tiến trình test (dùng khi cần thay object storage bằng bản lỗi). */
export async function startWorkerInProcess(config: AppConfig, storage?: ObjectStorage): Promise<{ ctx: INestApplicationContext; worker: ExportWorker; close: () => Promise<void> }> {
  let builder = Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(APP_CONFIG).useValue(config);
  if (storage) builder = builder.overrideProvider(OBJECT_STORAGE).useValue(storage);
  const moduleRef = await builder.compile();
  const ctx = await moduleRef.init(); // gọi onApplicationBootstrap (tạo bucket) như khi chạy thật
  const worker = ctx.get(ExportWorker);
  return {
    ctx,
    worker,
    close: async () => {
      await worker.stop();
      await ctx.close();
    },
  };
}

/** Worker là một tiến trình Node thật (`src/main.worker.ts`) để có thể SIGKILL giữa chừng như `docker kill`. */
export async function spawnWorker(env: Record<string, string>): Promise<ChildProcess & { output: () => string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.worker.ts'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (d) => (output += d));
  child.stderr?.on('data', (d) => (output += d));
  const proc = Object.assign(child, { output: () => output });
  for (let i = 0; !output.includes('worker sẵn sàng'); i++) {
    if (child.exitCode !== null || i > 150) throw new Error(`worker không khởi động được:\n${output}`);
    await sleep(100);
  }
  return proc;
}

/** Web là một tiến trình Node thật (`src/main.web.ts`): client đo ở tiến trình khác thì mới thấy được event loop bị chặn. */
export async function spawnWeb(env: Record<string, string>): Promise<ChildProcess & { baseUrl: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.web.ts'], {
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (d) => (output += d));
  child.stderr?.on('data', (d) => (output += d));
  let match: RegExpExecArray | null = null;
  for (let i = 0; !(match = /web ở (http:\/\/127\.0\.0\.1:\d+)/.exec(output)); i++) {
    if (child.exitCode !== null || i > 150) throw new Error(`web không khởi động được:\n${output}`);
    await sleep(100);
  }
  return Object.assign(child, { baseUrl: match[1]! });
}

export async function stopProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill(signal);
  await exited;
}

export async function waitFor<T>(what: string, fn: () => Promise<T | undefined | null | false>, timeoutMs = 30_000, everyMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`hết ${timeoutMs} ms vẫn chưa: ${what}`);
    await sleep(everyMs);
  }
}

export const jobRow = (db: Kysely<Database>, id: number) => db.selectFrom('export_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

export async function postExport(baseUrl: string, userId: number, month = MONTH) {
  const res = await fetch(`${baseUrl}/exports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': String(userId) },
    body: JSON.stringify({ month }),
  });
  return { status: res.status, location: res.headers.get('location'), body: (await res.json()) as { id: number; status: string; created: boolean } };
}

export async function getExport(baseUrl: string, userId: number, id: number) {
  const res = await fetch(`${baseUrl}/exports/${id}`, { headers: { 'x-user-id': String(userId) } });
  return { status: res.status, retryAfter: res.headers.get('retry-after'), body: (await res.json()) as Record<string, unknown> };
}

/** Đọc file xlsx và trả các dòng (bỏ cột rỗng đầu của ExcelJS). */
export async function readXlsx(buffer: ArrayBuffer): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const rows: unknown[][] = [];
  wb.worksheets[0]!.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}
