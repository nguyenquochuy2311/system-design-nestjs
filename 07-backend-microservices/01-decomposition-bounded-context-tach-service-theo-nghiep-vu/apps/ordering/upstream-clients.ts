import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { callService } from '../../libs/platform/service-client';
import type { OrderLine } from './pricing';

export const UPSTREAM_URLS = Symbol('UPSTREAM_URLS');

export interface UpstreamUrls {
  inventoryUrl: string;
  paymentUrl: string;
}

/** Dịch trả lời của Inventory sang ngôn ngữ của Ordering; phần còn lại của Ordering không biết mã HTTP của ai. */
@Injectable()
export class InventoryClient {
  constructor(@Inject(UPSTREAM_URLS) private readonly urls: UpstreamUrls) {}

  async reserve(orderId: string, lines: OrderLine[]): Promise<'reserved' | 'out-of-stock'> {
    const reply = await callService('inventory', 'POST', `${this.urls.inventoryUrl}/reservations`, {
      orderId,
      lines: lines.map((line) => ({ sku: line.sku, quantity: line.quantity })),
    });
    if (reply.status === 201) {
      return 'reserved';
    }
    if (reply.status === 409) {
      return 'out-of-stock';
    }
    throw new BadGatewayException(`Inventory trả ${reply.status}`);
  }
}

@Injectable()
export class PaymentClient {
  constructor(@Inject(UPSTREAM_URLS) private readonly urls: UpstreamUrls) {}

  async charge(orderId: string, amountVnd: number): Promise<void> {
    const reply = await callService('payment', 'POST', `${this.urls.paymentUrl}/charges`, { orderId, amountVnd });
    if (reply.status !== 201) {
      throw new BadGatewayException(`Payment trả ${reply.status}`);
    }
  }
}
