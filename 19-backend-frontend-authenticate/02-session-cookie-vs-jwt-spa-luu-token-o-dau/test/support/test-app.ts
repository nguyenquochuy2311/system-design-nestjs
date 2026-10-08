import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { CONFIG, type AppConfig } from '../../src/shared/config';
import { localhostSecureShim } from '../../src/shared/localhost-secure';
import { DB } from '../../src/shared/db';
import { hashPassword } from '../../src/shared/password';
import { REDIS, userSessionsKey } from '../../src/shared/redis';
import { createSessionMiddleware, SESS_PREFIX } from '../../src/sau/session.config';

export const TEST_SCHEMA = 'lab_test';
const DB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../db');
const DB_URL = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:55432/crm';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:56379';
export const ORIGIN = 'http://localhost:3200';

export const TEST_CONFIG: AppConfig = {
  databaseUrl: DB_URL,
  redisUrl: REDIS_URL,
  port: 0,
  sessionSecret: 'test-session-secret',
  csrfSecret: 'test-csrf-secret',
  jwtSecret: 'test-jwt-secret',
  allowedOrigins: [ORIGIN, 'http://127.0.0.1:3200'],
  cookieName: '__Host-sid',
  cookieSecure: true,
  sessionIdleSeconds: 1800,
  sessionAbsoluteSeconds: 43200,
  trustLocalhostSecure: true,
};

/** Dựng lại schema lab_test từ db/schema.sql (file không ghi tên schema). */
export async function setupTestDb(): Promise<Pool> {
  const admin = new Pool({ connectionString: DB_URL, max: 1 });
  await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE; CREATE SCHEMA ${TEST_SCHEMA}`);
  await admin.end();
  const pool = new Pool({ connectionString: DB_URL, max: 5, options: `-c search_path=${TEST_SCHEMA}` });
  await pool.query(readFileSync(resolve(DB_DIR, 'schema.sql'), 'utf8'));
  return pool;
}

export async function insertUser(
  db: Pool,
  u: { email: string; displayName: string; password: string; locked?: boolean },
): Promise<string> {
  const r = await db.query<{ id: string }>(
    'INSERT INTO users (email, display_name, password_hash, locked) VALUES ($1,$2,$3,$4) RETURNING id',
    [u.email, u.displayName, hashPassword(u.password), u.locked ?? false],
  );
  return r.rows[0]!.id;
}

export interface Reply {
  status: number;
  setCookies: string[];
  json: any;
}

export interface TestApp {
  app: INestApplication;
  db: Pool;
  redis: Redis;
  url: string;
  config: AppConfig;
  request(
    method: string,
    path: string,
    opts?: { cookie?: string; csrf?: string; origin?: string | null; bearer?: string; body?: unknown },
  ): Promise<Reply>;
  /** Đăng nhập /sau, trả cookie header (sid + csrf) và token CSRF để gắn vào request sau. */
  loginSau(email: string, password: string, origin?: string): Promise<{ cookie: string; csrf: string; reply: Reply }>;
  sessKeys(): Promise<string[]>;
  userSessions(userId: string): Promise<string[]>;
  close(): Promise<void>;
}

/** Đọc một cookie từ mảng Set-Cookie (name=value;...). */
export function cookieValue(setCookies: string[], name: string): string | undefined {
  for (const sc of setCookies) {
    const first = sc.split(';')[0]!;
    const eq = first.indexOf('=');
    if (first.slice(0, eq).trim() === name) return first.slice(eq + 1).trim();
  }
  return undefined;
}

/** Lấy session id THÔ (khóa Redis) từ giá trị cookie đã ký của express-session: `s:<id>.<chữ ký>` (đã URL-encode). */
export function rawSessionId(signedCookieValue: string): string {
  const decoded = decodeURIComponent(signedCookieValue);
  const body = decoded.startsWith('s:') ? decoded.slice(2) : decoded;
  const dot = body.lastIndexOf('.');
  return dot > 0 ? body.slice(0, dot) : body;
}

export async function startTestApp(db: Pool, overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const config: AppConfig = { ...TEST_CONFIG, ...overrides };
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
  redis.on('error', () => {});
  await new Promise<void>((r) => (redis.status === 'ready' ? r() : redis.once('ready', () => r())));

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG)
    .useValue(config)
    .overrideProvider(DB)
    .useValue(db)
    .overrideProvider(REDIS)
    .useValue(redis)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set('trust proxy', 1);
  if (config.trustLocalhostSecure) app.use(localhostSecureShim);
  app.use('/sau', createSessionMiddleware(config, redis));
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  async function request(method: string, path: string, opts: Parameters<TestApp['request']>[2] = {}): Promise<Reply> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.cookie) headers['cookie'] = opts.cookie;
    if (opts.csrf) headers['x-csrf-token'] = opts.csrf;
    if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
    if (opts.origin !== null) headers['origin'] = opts.origin ?? ORIGIN;
    const res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const setCookies = res.headers.getSetCookie();
    const text = await res.text();
    return { status: res.status, setCookies, json: text ? JSON.parse(text) : null };
  }

  return {
    app,
    db,
    redis,
    url,
    config,
    request,
    async loginSau(email, password, origin = ORIGIN) {
      const reply = await request('POST', '/sau/login', { body: { email, password }, origin });
      const sid = cookieValue(reply.setCookies, config.cookieName);
      const csrf = cookieValue(reply.setCookies, 'csrf') ?? '';
      const cookie = `${config.cookieName}=${sid}; csrf=${csrf}`;
      return { cookie, csrf, reply };
    },
    async sessKeys() {
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', `${SESS_PREFIX}*`, 'COUNT', 100);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== '0');
      return keys;
    },
    userSessions: (userId) => redis.smembers(userSessionsKey(userId)),
    async close() {
      await app.close();
      redis.disconnect();
    },
  };
}
