/**
 * Định dạng dữ liệu vào của ba đường đặt hàng. Phần đọc file/feed không phải quy tắc nghiệp vụ nên
 * bản "trước" và "sau" dùng chung, để phần khác nhau giữa hai bản chỉ là chỗ đặt quy tắc.
 */
export interface OrderItemInput {
  productId: number;
  quantity: number;
}

/** File CSV của đại lý: `order_ref,customer_id,product_id,quantity`; các dòng cùng order_ref là một đơn. */
export interface CsvOrder {
  ref: string;
  customerId: number;
  items: OrderItemInput[];
}

/** Đơn kéo về từ sàn TMĐT (đã ánh xạ người mua sang mã khách nội bộ). */
export interface MarketplaceOrder {
  marketplaceOrderId: string;
  customerId: number;
  lines: { productId: number; qty: number }[];
}

export interface ImportReport {
  created: { ref: string; orderId: number; total: number }[];
  failed: { ref: string; reason: string }[];
}

const CSV_HEADER = 'order_ref,customer_id,product_id,quantity';

export function parseOrdersCsv(text: string): { orders: CsvOrder[]; errors: ImportReport['failed'] } {
  const rows = text.trim().split(/\r?\n/);
  if (rows[0]?.trim() !== CSV_HEADER) {
    return { orders: [], errors: [{ ref: 'dòng 1', reason: `Thiếu tiêu đề "${CSV_HEADER}"` }] };
  }
  const byRef = new Map<string, CsvOrder>();
  const errors: ImportReport['failed'] = [];
  rows.slice(1).forEach((row, index) => {
    const [ref, customerId, productId, quantity] = row.split(',').map((cell) => cell.trim());
    const numbers = [customerId, productId, quantity].map(Number);
    if (!ref || numbers.some((n) => !Number.isInteger(n) || n <= 0)) {
      errors.push({ ref: `dòng ${index + 2}`, reason: `Dòng không hợp lệ: "${row}"` });
      return;
    }
    const [cid, pid, qty] = numbers as [number, number, number];
    const order = byRef.get(ref) ?? { ref, customerId: cid, items: [] };
    order.items.push({ productId: pid, quantity: qty });
    byRef.set(ref, order);
  });
  return { orders: [...byRef.values()], errors };
}
