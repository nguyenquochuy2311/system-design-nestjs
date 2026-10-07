// Fixture cho phép thử âm của luật phụ thuộc: một "repository Kysely" tối giản.
import type { Kysely } from 'kysely';
import type { Database } from '../../../../../src/shared/db';

export async function outstandingDebt(db: Kysely<Database>, customerId: number): Promise<number> {
  const row = await db.selectFrom('orders').select('total').where('customer_id', '=', customerId).executeTakeFirst();
  return row?.total ?? 0;
}
