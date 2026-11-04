import type pg from 'pg';

export interface ReconcileReport {
  orders: number;
  confirmed: number;
  cancelled: number;
  unfinished: number;
  /** Đơn hủy mà kho còn giữ hàng. */
  cancelledHoldingStock: number;
  /** Đơn chưa kết thúc mà kho còn giữ hàng: đơn "treo". */
  unfinishedHoldingStock: number;
  /** Đơn hủy mà cổng vẫn giữ tiền của khách. */
  cancelledButCharged: number;
  /** Đơn xác nhận mà cổng không có tiền. */
  confirmedNotCharged: number;
  /** Đơn hủy đã được hoàn tiền. */
  refunded: number;
  /** Tổng đơn lệch giữa ba nơi. */
  mismatched: number;
}

const SCHEMAS = {
  truoc: { orders: 'truoc.orders', reservations: 'truoc.reservations', key: 'order_id' },
  sau: { orders: 'ordering.orders', reservations: 'inventory.reservations', key: 'saga_id' },
};

/** Đối soát độc lập với code của lab: đọc thẳng ba nơi giữ dữ liệu là đơn, kho và sổ cái của cổng. */
export async function reconcile(admin: pg.Pool, gatewayUrl: string, variant: keyof typeof SCHEMAS): Promise<ReconcileReport> {
  const { orders, reservations, key } = SCHEMAS[variant];
  const ledger = (await (await fetch(`${gatewayUrl}/ledger`)).json()) as Record<string, string>;
  const { rows } = await admin.query<{ id: string; status: string; held: boolean }>(
    `SELECT o.id, o.status, COALESCE(r.status = 'RESERVED', false) AS held
     FROM ${orders} o LEFT JOIN ${reservations} r ON r.${key} = o.id`,
  );
  const count = (test: (row: { id: string; status: string; held: boolean }) => boolean) => rows.filter(test).length;
  const report = {
    orders: rows.length,
    confirmed: count((row) => row.status === 'CONFIRMED'),
    cancelled: count((row) => row.status === 'CANCELLED'),
    unfinished: count((row) => row.status === 'PENDING'),
    cancelledHoldingStock: count((row) => row.status === 'CANCELLED' && row.held),
    unfinishedHoldingStock: count((row) => row.status === 'PENDING' && row.held),
    cancelledButCharged: count((row) => row.status === 'CANCELLED' && ledger[row.id] === 'CAPTURED'),
    confirmedNotCharged: count((row) => row.status === 'CONFIRMED' && ledger[row.id] !== 'CAPTURED'),
    refunded: count((row) => row.status === 'CANCELLED' && ledger[row.id] === 'REFUNDED'),
  };
  const mismatched =
    report.cancelledHoldingStock + report.unfinishedHoldingStock + report.cancelledButCharged + report.confirmedNotCharged;
  return { ...report, mismatched };
}
