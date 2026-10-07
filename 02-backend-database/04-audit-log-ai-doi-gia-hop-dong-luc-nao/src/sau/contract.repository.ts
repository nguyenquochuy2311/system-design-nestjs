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
import { withActor, type Actor } from './with-actor';

/**
 * PHIÊN BẢN "SAU". Hàm ghi nào cũng nhận `actor` và chạy trong withActor, nên không có cách gọi hàm ghi mà quên
 * người thực hiện; nếu có đường ghi lách repository bằng tài khoản ứng dụng, trigger từ chối (fail closed).
 * Nhật ký do trigger ghi, repository không tự chèn dòng nào vào audit.audit_log.
 */

export async function createContract(db: Kysely<Database>, actor: Actor, input: NewContract): Promise<Contract> {
  return withActor(db, actor, async (trx) =>
    toContract(
      await trx.insertInto('contracts').values(newContractColumns(input, actor.userId)).returning(CONTRACT_COLUMNS).executeTakeFirstOrThrow(),
    ),
  );
}

export async function updateContract(db: Kysely<Database>, actor: Actor, id: number, patch: ContractPatch): Promise<Contract> {
  return withActor(db, actor, async (trx) => {
    const row = await trx
      .updateTable('contracts')
      .set({ ...patchColumns(patch, actor.userId), updated_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null) // hợp đồng đã xóa mềm thì không sửa được, phải khôi phục trước
      .returning(CONTRACT_COLUMNS)
      .executeTakeFirst();
    if (!row) throw new ContractNotFoundError(id);
    return toContract(row);
  });
}

/** Gia hạn thêm một năm, phí tăng 5 %: tính trong chính câu UPDATE để không đọc rồi ghi đè thay đổi của người khác. */
export async function renewContract(db: Kysely<Database>, actor: Actor, id: number): Promise<Contract> {
  return withActor(db, actor, async (trx) => {
    const row = await trx
      .updateTable('contracts')
      .set({
        end_date: sql`end_date + interval '1 year'`,
        premium: sql`round(premium * 1.05)`,
        updated_by: actor.userId,
        updated_at: sql`now()`,
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning(CONTRACT_COLUMNS)
      .executeTakeFirst();
    if (!row) throw new ContractNotFoundError(id);
    return toContract(row);
  });
}

/** [PATTERN] Soft Delete: đánh dấu, không xóa. Trigger nhận ra deleted_at đổi từ NULL sang có giá trị và ghi SOFT_DELETE. */
export async function softDeleteContract(db: Kysely<Database>, actor: Actor, id: number): Promise<void> {
  await withActor(db, actor, async (trx) => {
    const row = await trx
      .updateTable('contracts')
      .set({ deleted_at: sql`now()`, deleted_by: actor.userId, updated_by: actor.userId, updated_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!row) throw new ContractNotFoundError(id);
  });
}

/** Khôi phục bản xóa nhầm: một câu UPDATE trên đúng dòng đó, các thay đổi khác trong DB không bị đụng tới. */
export async function restoreContract(db: Kysely<Database>, actor: Actor, id: number): Promise<Contract> {
  return withActor(db, actor, async (trx) => {
    const row = await trx
      .updateTable('contracts')
      .set({ deleted_at: null, deleted_by: null, updated_by: actor.userId, updated_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is not', null)
      .returning(CONTRACT_COLUMNS)
      .executeTakeFirst();
    if (!row) throw new ContractNotFoundError(id);
    return toContract(row);
  });
}

export async function addClaim(db: Kysely<Database>, actor: Actor, contractId: number, amount: number): Promise<number> {
  return withActor(db, actor, async (trx) => {
    const { id } = await trx.insertInto('claims').values({ contract_id: contractId, amount }).returning('id').executeTakeFirstOrThrow();
    return id;
  });
}

// ---- Đọc: luôn qua view active_contracts, bản xóa mềm không bao giờ hiện trong truy vấn thường. ----

export async function findContract(db: Kysely<Database>, id: number): Promise<Contract | undefined> {
  const row = await db.selectFrom('active_contracts').select(CONTRACT_COLUMNS).where('id', '=', id).executeTakeFirst();
  return row ? toContract(row) : undefined;
}

export async function findContractByCode(db: Kysely<Database>, code: string): Promise<Contract | undefined> {
  const row = await db.selectFrom('active_contracts').select(CONTRACT_COLUMNS).where('code', '=', code).executeTakeFirst();
  return row ? toContract(row) : undefined;
}

/** Báo cáo tổng phí theo sản phẩm: kiểu truy vấn dễ "quên lọc" nhất nếu viết thẳng trên bảng. */
export async function premiumReport(db: Kysely<Database>, product: string): Promise<{ contracts: number; totalPremium: number }> {
  const row = await db
    .selectFrom('active_contracts')
    .select((eb) => [eb.fn.countAll<number>().as('contracts'), eb.fn.coalesce(eb.fn.sum<number>('premium'), sql<number>`0`).as('total')])
    .where('product', '=', product)
    .executeTakeFirstOrThrow();
  return { contracts: Number(row.contracts), totalPremium: Number(row.total) };
}
