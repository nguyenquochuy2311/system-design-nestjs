import type { Selectable } from 'kysely';
import type { ContractTable } from './db';

/** Hợp đồng như API trả về. Tiền tính bằng đồng. */
export interface Contract {
  id: number;
  code: string;
  customerName: string;
  product: string;
  premium: number;
  sumInsured: number;
  startDate: string;
  endDate: string;
  updatedBy: string;
  updatedAt: string;
}

export interface NewContract {
  code: string;
  customerName: string;
  product: string;
  premium: number;
  sumInsured: number;
  startDate: string;
  endDate: string;
}

/** Các trường nhân viên được sửa. Chỉ trường có mặt mới được ghi. */
export interface ContractPatch {
  customerName?: string;
  product?: string;
  premium?: number;
  sumInsured?: number;
  endDate?: string;
}

/** Cột đọc ra, giống nhau ở truoc.contracts, public.contracts và view active_contracts. */
export const CONTRACT_COLUMNS = [
  'id',
  'code',
  'customer_name',
  'product',
  'premium',
  'sum_insured',
  'start_date',
  'end_date',
  'updated_by',
  'updated_at',
] as const;

type ContractRow = Pick<Selectable<ContractTable>, (typeof CONTRACT_COLUMNS)[number]>;

export function toContract(row: ContractRow): Contract {
  return {
    id: row.id,
    code: row.code,
    customerName: row.customer_name,
    product: row.product,
    premium: row.premium,
    sumInsured: row.sum_insured,
    startDate: row.start_date,
    endDate: row.end_date,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  };
}

export function newContractColumns(c: NewContract, userId: string) {
  return {
    code: c.code,
    customer_name: c.customerName,
    product: c.product,
    premium: c.premium,
    sum_insured: c.sumInsured,
    start_date: c.startDate,
    end_date: c.endDate,
    updated_by: userId,
  };
}

export function patchColumns(p: ContractPatch, userId: string) {
  return {
    ...(p.customerName !== undefined && { customer_name: p.customerName }),
    ...(p.product !== undefined && { product: p.product }),
    ...(p.premium !== undefined && { premium: p.premium }),
    ...(p.sumInsured !== undefined && { sum_insured: p.sumInsured }),
    ...(p.endDate !== undefined && { end_date: p.endDate }),
    updated_by: userId,
  };
}

export class ContractNotFoundError extends Error {
  constructor(readonly contractId: number) {
    super(`Không tìm thấy hợp đồng ${contractId} (hoặc hợp đồng đã bị xóa)`);
    this.name = 'ContractNotFoundError';
  }
}
