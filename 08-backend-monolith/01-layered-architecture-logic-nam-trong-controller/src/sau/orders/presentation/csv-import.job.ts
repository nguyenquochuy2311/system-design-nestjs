import { Inject, Injectable } from '@nestjs/common';
import { parseOrdersCsv, type ImportReport } from '../../../shared/order-input';
import { PlaceOrderService } from '../application/place-order.service';
import { OrderRuleError } from '../domain/order';

/** Đường vào thứ hai: file CSV của đại lý. Cùng service, cùng quy tắc với web. */
@Injectable()
export class CsvImportJob {
  constructor(@Inject(PlaceOrderService) private readonly placeOrderService: PlaceOrderService) {}

  async run(csv: string): Promise<ImportReport> {
    const { orders, errors } = parseOrdersCsv(csv);
    const report: ImportReport = { created: [], failed: [...errors] };
    for (const order of orders) {
      try {
        const placed = await this.placeOrderService.placeOrder({ ...order, channel: 'csv', externalRef: order.ref });
        report.created.push({ ref: order.ref, orderId: placed.orderId, total: placed.total });
      } catch (error) {
        // Lỗi nghiệp vụ vào báo cáo dòng lỗi; lỗi hạ tầng (mất kết nối DB...) không được nuốt.
        if (!(error instanceof OrderRuleError)) throw error;
        report.failed.push({ ref: order.ref, reason: error.message });
      }
    }
    return report;
  }
}
