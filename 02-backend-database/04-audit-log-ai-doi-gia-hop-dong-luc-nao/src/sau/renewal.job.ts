import type { Kysely } from 'kysely';
import type { Database } from '../shared/db';
import { renewContract } from './contract.repository';

export const RENEWAL_ACTOR = 'job:auto-renewal';

/**
 * Job nền "gia hạn tự động": đường ghi thứ hai ở mục 1 README. Job cũng là "người thực hiện" và có tên riêng,
 * nên nhật ký phân biệt được thay đổi do người và do máy. Ghi qua repository như API.
 */
export async function runRenewalJob(db: Kysely<Database>, contractIds: number[], runId: string): Promise<number> {
  let renewed = 0;
  for (const id of contractIds) {
    await renewContract(db, { userId: RENEWAL_ACTOR, reason: `Gia hạn tự động, lượt ${runId}`, requestId: runId }, id);
    renewed++;
  }
  return renewed;
}
