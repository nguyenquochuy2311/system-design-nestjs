import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import pg from 'pg';
import type { Database } from '../src/shared/db';
import type { Contract, NewContract } from '../src/shared/contract';
import type { Variant } from '../src/shared/write-paths';
import { createContract } from '../src/sau/contract.repository';
import { createContractTruoc } from '../src/truoc/contract.repository';

export const SALES = 'nv-ban-hang';

/** Mỗi test tự tạo hợp đồng riêng: không phụ thuộc seed, không đụng dữ liệu của test khác hay của lượt đo. */
export function newContractInput(overrides: Partial<NewContract> = {}): NewContract {
  return {
    code: `TEST-${randomUUID()}`,
    customerName: 'Công ty Cổ phần Thép Phương Nam',
    product: 'Tài sản',
    premium: 120_000_000,
    sumInsured: 80_000_000_000,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    ...overrides,
  };
}

export async function createTestContract(db: Kysely<Database>, variant: Variant, overrides: Partial<NewContract> = {}): Promise<Contract> {
  const input = newContractInput(overrides);
  return variant === 'sau' ? createContract(db, { userId: SALES, reason: 'Ký hợp đồng mới' }, input) : createContractTruoc(db, SALES, input);
}

export async function connect(url: string, name = 'test'): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url, application_name: name });
  await c.connect();
  return c;
}

/** Đợi một promise và trả về kết quả hoặc lỗi, để kiểm tra mã lỗi PostgreSQL. */
export async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: Error & { code?: string } }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error: error as Error & { code?: string } };
  }
}

/** Mã SQLSTATE của lần chạy thất bại; ném lỗi nếu lần chạy lại thành công. */
export async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  const r = await settle(p);
  if (r.ok) throw new Error('Mong đợi câu lệnh bị từ chối nhưng nó chạy thành công');
  return r.error.code;
}
