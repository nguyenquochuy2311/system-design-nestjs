import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql, type Kysely } from 'kysely';
import type Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { createDb, KYSELY, type Database } from '../../src/shared/db';
import { createRedis, REDIS } from '../../src/shared/redis';
import { md5Hex } from '../../src/shared/md5';
import { LegacyHashAdapter } from '../../src/sau/legacy-hash-adapter';
import { PasswordHasher } from '../../src/sau/password-hasher';
import {
  HASHER_OPTIONS,
  LOGIN_OPTIONS,
  type HasherOptions,
  type LoginOptions,
} from '../../src/sau/password-hasher.options';

export const TEST_SCHEMA = 'lab_test';
const DB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../db');

// Tham số Argon2id NHỎ cho test (nhanh ~vài ms); hành vi pattern không phụ thuộc chi phí cụ thể.
export const TEST_PEPPER = Buffer.from('pepper-cho-test', 'utf8');
export const TEST_HASHER_OPTIONS: HasherOptions = { memoryCost: 8192, timeCost: 1, parallelism: 1, pepper: TEST_PEPPER };
export const TEST_LOGIN_OPTIONS: LoginOptions = { maxFailures: 10, windowSeconds: 900 };

/** Dựng lại schema `lab_test` từ db/schema.sql (file không ghi tên schema). */
export async function setupTestDb(): Promise<Kysely<Database>> {
  const admin = createDb({ max: 1 });
  await sql.raw(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE; CREATE SCHEMA ${TEST_SCHEMA}`).execute(admin);
  await admin.destroy();
  const db = createDb({ schema: TEST_SCHEMA, max: 10 });
  await sql.raw(readFileSync(resolve(DB_DIR, 'schema.sql'), 'utf8')).execute(db);
  return db;
}

export interface LoginReply {
  status: number;
  body: { ok?: boolean; userId?: string; hashVersion?: number; upgraded?: boolean; error?: string };
}

export interface TestApp {
  app: INestApplication;
  db: Kysely<Database>;
  redis: Redis;
  hasher: PasswordHasher;
  legacy: LegacyHashAdapter;
  url: string;
  login(path: '/truoc/login' | '/sau/login', email: string, password: string): Promise<LoginReply>;
  close(): Promise<void>;
}

export async function startTestApp(
  db: Kysely<Database>,
  options: { hasher?: Partial<HasherOptions>; login?: Partial<LoginOptions> } = {},
): Promise<TestApp> {
  const redis = createRedis();
  // enableOfflineQueue=false: lệnh gửi trước khi kết nối sẽ ném; chờ 'ready' để test gọi flushdb được ngay.
  await new Promise<void>((resolve) => (redis.status === 'ready' ? resolve() : redis.once('ready', () => resolve())));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(KYSELY)
    .useValue(db)
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(HASHER_OPTIONS)
    .useValue({ ...TEST_HASHER_OPTIONS, ...options.hasher })
    .overrideProvider(LOGIN_OPTIONS)
    .useValue({ ...TEST_LOGIN_OPTIONS, ...options.login })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  return {
    app,
    db,
    redis,
    hasher: app.get(PasswordHasher),
    legacy: app.get(LegacyHashAdapter),
    url,
    async login(path, email, password) {
      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return { status: res.status, body: (await res.json()) as LoginReply['body'] };
    },
    close: () => app.close(),
  };
}

/** Chèn một user ở trạng thái MD5 cũ (hash_version = 0). */
export async function insertMd5User(db: Kysely<Database>, email: string, password: string): Promise<string> {
  const row = await db
    .insertInto('users')
    .values({ email, password_md5: md5Hex(password), hash_version: 0 })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Chèn một user đã BỌC argon2id(md5) (hash_version = 1) — như sau migration: password_md5 đã xóa (NULL). */
export async function insertWrappedUser(t: TestApp, email: string, password: string): Promise<string> {
  const phc = await t.legacy.wrapMd5(md5Hex(password));
  const row = await t.db
    .insertInto('users')
    .values({ email, password_md5: null, password_hash: phc, hash_version: 1 })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function userById(db: Kysely<Database>, id: string) {
  return db
    .selectFrom('users')
    .select(['password_md5', 'password_hash', 'hash_version'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

/** Đếm số dòng còn giữ MD5 (password_md5 khác NULL) — sau migration/nâng cấp phải bằng 0. */
export async function countWithMd5(db: Kysely<Database>): Promise<number> {
  const r = await db
    .selectFrom('users')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('password_md5', 'is not', null)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}
