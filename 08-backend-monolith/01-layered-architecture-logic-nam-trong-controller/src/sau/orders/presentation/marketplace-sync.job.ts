import { Inject, Injectable } from '@nestjs/common';
import type { ImportReport, MarketplaceOrder } from '../../../shared/order-input';
import { PlaceOrderService } from '../application/place-order.service';
import { OrderRuleError } from '../domain/order';

/** Đường vào thứ ba: đơn kéo về từ sàn TMĐT. Chỉ đổi định dạng rồi gọi cùng service. */
@Injectable()
export class MarketplaceSyncJob {
  constructor(@Inject(PlaceOrderService) private readonly placeOrderService: PlaceOrderService) {}

  async run(feed: MarketplaceOrder[]): Promise<ImportReport> {
    const report: ImportReport = { created: [], failed: [] };
    for (const mo of feed) {
      const ref = mo.marketplaceOrderId;
      const items = mo.lines.map((l) => ({ productId: l.productId, quantity: l.qty }));
      try {
        const placed = await this.placeOrderService.placeOrder({ customerId: mo.customerId, items, channel: 'marketplace', externalRef: ref });
        report.created.push({ ref, orderId: placed.orderId, total: placed.total });
      } catch (error) {
        if (!(error instanceof OrderRuleError)) throw error;
        report.failed.push({ ref, reason: error.message });
      }
    }
    return report;
  }
}
