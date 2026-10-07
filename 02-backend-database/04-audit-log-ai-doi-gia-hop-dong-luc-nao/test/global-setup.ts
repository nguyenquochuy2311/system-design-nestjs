import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { ADMIN_URL } from '../src/shared/config';

/** Áp dụng db/migrations/*.sql (chạy lại được) để `pnpm test` đúng dù đã chạy `pnpm db:migrate` hay chưa. */
export default async function setup(): Promise<void> {
  const dir = new URL('../db/migrations/', import.meta.url);
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await client.query('SET client_min_messages = warning'); // bỏ NOTICE "already exists, skipping"
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await client.query(readFileSync(new URL(file, dir), 'utf8'));
    }
  } finally {
    await client.end();
  }
}
