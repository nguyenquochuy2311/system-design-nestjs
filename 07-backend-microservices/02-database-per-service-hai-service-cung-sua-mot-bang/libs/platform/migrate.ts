import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export interface MigrationTarget {
  connectionString: string;
  schema: string;
  directory: string;
}

/** Chạy các file SQL chưa áp dụng, theo thứ tự tên file. `upTo` dừng ở file có tiền tố đó, ví dụ '001'. */
export async function applyMigrations(target: MigrationTarget, upTo?: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: target.connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ${target.schema}.schema_migrations (version text PRIMARY KEY)`);
    const { rows } = await client.query<{ version: string }>(`SELECT version FROM ${target.schema}.schema_migrations`);
    const applied = new Set(rows.map((row) => row.version));
    const files = readdirSync(target.directory)
      .filter((file) => file.endsWith('.sql') && !applied.has(file))
      .filter((file) => upTo === undefined || file.slice(0, upTo.length) <= upTo)
      .sort();
    for (const file of files) {
      await client.query('BEGIN');
      await client.query(readFileSync(join(target.directory, file), 'utf8'));
      await client.query(`INSERT INTO ${target.schema}.schema_migrations (version) VALUES ($1)`, [file]);
      await client.query('COMMIT');
    }
    return files;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
