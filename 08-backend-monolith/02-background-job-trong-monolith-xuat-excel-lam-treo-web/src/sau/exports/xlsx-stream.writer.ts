import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import { REPORT_COLUMNS, type ReportRow } from '../../shared/order-report';

/**
 * [PATTERN] Ghi Excel theo luồng: mỗi dòng được commit rồi nén ra `out` ngay, không giữ cả workbook trong bộ nhớ.
 * `onBatch` được gọi sau mỗi `batchSize` dòng (cập nhật tiến độ, nhường event loop cho heartbeat).
 */
export async function writeOrdersXlsx(
  rows: AsyncIterable<ReportRow>,
  out: Writable,
  batchSize: number,
  onBatch: (rowsWritten: number) => Promise<void>,
): Promise<number> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: false, useSharedStrings: false });
  const sheet = workbook.addWorksheet('Đơn hàng');
  sheet.columns = REPORT_COLUMNS.map((c) => ({ ...c }));
  let count = 0;
  for await (const row of rows) {
    // upload hỏng thì `out` bị hủy: dừng vòng lặp để đóng cursor và trả kết nối DB, không đọc tiếp vô ích
    if (out.destroyed) throw new Error('luồng ghi đã bị hủy (upload lỗi)');
    sheet.addRow(row).commit();
    count++;
    if (count % batchSize === 0) await onBatch(count);
  }
  sheet.commit();
  await workbook.commit(); // đóng file zip; archiver kết thúc thì `out` cũng end (pipe)
  return count;
}
