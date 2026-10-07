// Fixture cho phép thử âm: controller "tiện tay" gọi thẳng repository Kysely — dependency-cruiser phải chặn.
import type { Kysely } from 'kysely';
import type { Database } from '../../../../../src/shared/db';
import { outstandingDebt } from '../infrastructure/kysely-order-repository';

export function debtOf(db: Kysely<Database>, customerId: number): Promise<number> {
  return outstandingDebt(db, customerId);
}
