import { sql, type Kysely } from 'kysely';
import type { Database } from '../shared/db';
import {
  CONTRACT_COLUMNS,
  ContractNotFoundError,
  newContractColumns,
  patchColumns,
  toContract,
  type Contract,
  type ContractPatch,
  type NewContract,
} from '../shared/contract';

/**
 * PHIÊN BẢN "TRƯỚC" (schema truoc): chỉ lưu trạng thái hiện tại.
 * UPDATE ghi đè giá trị cũ; updated_by / updated_at chỉ kể lần sửa cuối, và chỉ khi đường ghi nhớ đặt chúng.
 * DELETE xóa vĩnh viễn và, qua ON DELETE CASCADE, kéo theo hồ sơ bồi thường.
 */
const truoc = (db: Kysely<Database>) => db.withSchema('truoc');

export async function createContractTruoc(db: Kysely<Database>, userId: string, input: NewContract): Promise<Contract> {
  return toContract(
    await truoc(db).insertInto('contracts').values(newContractColumns(input, userId)).returning(CONTRACT_COLUMNS).executeTakeFirstOrThrow(),
  );
}

export async function updateContractTruoc(db: Kysely<Database>, userId: string, id: number, patch: ContractPatch): Promise<Contract> {
  const row = await truoc(db)
    .updateTable('contracts')
    .set({ ...patchColumns(patch, userId), updated_at: sql`now()` })
    .where('id', '=', id)
    .returning(CONTRACT_COLUMNS)
    .executeTakeFirst();
  if (!row) throw new ContractNotFoundError(id);
  return toContract(row);
}

export async function renewContractTruoc(db: Kysely<Database>, userId: string, id: number): Promise<Contract> {
  const row = await truoc(db)
    .updateTable('contracts')
    .set({ end_date: sql`end_date + interval '1 year'`, premium: sql`round(premium * 1.05)`, updated_by: userId, updated_at: sql`now()` })
    .where('id', '=', id)
    .returning(CONTRACT_COLUMNS)
    .executeTakeFirst();
  if (!row) throw new ContractNotFoundError(id);
  return toContract(row);
}

/** Xóa cứng: dòng biến mất, hồ sơ bồi thường bị xóa theo; muốn lấy lại chỉ còn bản sao lưu. */
export async function deleteContractTruoc(db: Kysely<Database>, id: number): Promise<void> {
  const res = await truoc(db).deleteFrom('contracts').where('id', '=', id).executeTakeFirst();
  if (res.numDeletedRows === 0n) throw new ContractNotFoundError(id);
}

export async function findContractTruoc(db: Kysely<Database>, id: number): Promise<Contract | undefined> {
  const row = await truoc(db).selectFrom('contracts').select(CONTRACT_COLUMNS).where('id', '=', id).executeTakeFirst();
  return row ? toContract(row) : undefined;
}
