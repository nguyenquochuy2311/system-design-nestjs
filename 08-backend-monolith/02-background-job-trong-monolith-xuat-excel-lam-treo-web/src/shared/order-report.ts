import type { Kysely } from 'kysely';
import type { Database } from './db';

/** Cột của báo cáo đơn hàng tháng; bản "trước" và bản "sau" xuất cùng nội dung để so được. */
export const REPORT_COLUMNS = [
  { header: 'Mã đơn', key: 'code', width: 16 },
  { header: 'Ngày tạo', key: 'created_at', width: 20 },
  { header: 'Cửa hàng', key: 'store_name', width: 24 },
  { header: 'Khách hàng', key: 'customer_name', width: 24 },
  { header: 'Điện thoại', key: 'customer_phone', width: 14 },
  { header: 'Trạng thái', key: 'status', width: 12 },
  { header: 'Số món', key: 'item_count', width: 8 },
  { header: 'Tạm tính', key: 'subtotal', width: 14 },
  { header: 'Giảm giá', key: 'discount', width: 12 },
  { header: 'Tổng tiền', key: 'total', width: 14 },
] as const;

export type ReportRow = Awaited<ReturnType<ReturnType<typeof reportQuery>['execute']>>[number];

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Khoảng [đầu tháng, đầu tháng sau) theo giờ Việt Nam. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${month}-01T00:00:00+07:00`, to: `${next}-01T00:00:00+07:00` };
}

export function reportQuery(db: Kysely<Database>, tenantId: number, month: string) {
  const { from, to } = monthRange(month);
  return db
    .selectFrom('orders')
    .select(['code', 'created_at', 'store_name', 'customer_name', 'customer_phone', 'status', 'item_count', 'subtotal', 'discount', 'total'])
    .where('tenant_id', '=', tenantId)
    .where('created_at', '>=', new Date(from))
    .where('created_at', '<', new Date(to))
    .orderBy('created_at')
    .orderBy('id');
}

export const reportFilename = (month: string) => `don-hang-${month}.xlsx`;
