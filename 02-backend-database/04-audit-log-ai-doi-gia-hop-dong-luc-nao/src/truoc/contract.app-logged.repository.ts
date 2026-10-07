import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../shared/db';
import { CONTRACT_COLUMNS, ContractNotFoundError, patchColumns, toContract, type Contract, type ContractPatch } from '../shared/contract';

/**
 * PHƯƠNG ÁN SO SÁNH (mục 2 README): ứng dụng tự ghi nhật ký trong repository, vào truoc.app_audit_log.
 * Có ngữ cảnh nghiệp vụ đầy đủ, nhưng chỉ bắt được đường ghi đi qua repository này: script sửa dữ liệu và
 * psql của DBA ghi thẳng vào bảng nên lọt (test every-write-path-is-audited, bench/write-paths-coverage.ts).
 */
async function writeWithAppLog(
  db: Kysely<Database>,
  userId: string,
  id: number,
  write: (trx: Transaction<Database>) => Promise<Parameters<typeof toContract>[0] | undefined>,
): Promise<Contract> {
  return db.transaction().execute(async (trx) => {
    const t = trx.withSchema('truoc');
    // Đọc bản cũ dạng JSON và khóa dòng, để bản cũ trong nhật ký đúng là bản bị ghi đè.
    const old = await t
      .selectFrom('contracts')
      .select(sql<Record<string, unknown>>`to_jsonb(contracts)`.as('row'))
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!old) throw new ContractNotFoundError(id);
    const row = await write(trx);
    if (!row) throw new ContractNotFoundError(id);
    const fresh = await t.selectFrom('contracts').select(sql<Record<string, unknown>>`to_jsonb(contracts)`.as('row')).where('id', '=', id).executeTakeFirstOrThrow();
    await t.insertInto('app_audit_log').values({ contract_id: id, action: 'UPDATE', old_row: old.row, new_row: fresh.row, changed_by: userId }).execute();
    return toContract(row);
  });
}

export async function updateContractAppLogged(db: Kysely<Database>, userId: string, id: number, patch: ContractPatch): Promise<Contract> {
  return writeWithAppLog(db, userId, id, (trx) =>
    trx
      .withSchema('truoc')
      .updateTable('contracts')
      .set({ ...patchColumns(patch, userId), updated_at: sql`now()` })
      .where('id', '=', id)
      .returning(CONTRACT_COLUMNS)
      .executeTakeFirst(),
  );
}

export async function renewContractAppLogged(db: Kysely<Database>, userId: string, id: number): Promise<Contract> {
  return writeWithAppLog(db, userId, id, (trx) =>
    trx
      .withSchema('truoc')
      .updateTable('contracts')
      .set({ end_date: sql`end_date + interval '1 year'`, premium: sql`round(premium * 1.05)`, updated_by: userId, updated_at: sql`now()` })
      .where('id', '=', id)
      .returning(CONTRACT_COLUMNS)
      .executeTakeFirst(),
  );
}
