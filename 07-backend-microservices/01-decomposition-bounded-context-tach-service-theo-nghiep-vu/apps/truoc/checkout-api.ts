import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  Module,
  Post,
  UnprocessableEntityException,
  type DynamicModule,
} from '@nestjs/common';
import { callService } from '../../libs/platform/service-client';

export interface CheckoutConfig {
  userUrl: string;
  productUrl: string;
  stockUrl: string;
  promotionUrl: string;
  paymentUrl: string;
  orderUrl: string;
}

const CHECKOUT_CONFIG = Symbol('CHECKOUT_CONFIG');

interface PlaceOrderBody {
  customerId: string;
  items: { sku: string; quantity: number }[];
  promoCode?: string;
}

interface PricedItem {
  sku: string;
  quantity: number;
  name: string;
  unitPriceVnd: number;
}

// Quy tắc "đặt hàng" không có chủ: nó nằm ở đây, nhưng mọi dữ liệu nó cần đều ở service khác, nên mỗi bước là một lời
// gọi mạng tuần tự. Với đơn 2 SKU là 9 lời gọi qua 5 service, và bất kỳ service nào chết thì đơn đều không đặt được.
@Controller('orders')
class CheckoutController {
  constructor(@Inject(CHECKOUT_CONFIG) private readonly config: CheckoutConfig) {}

  @Post()
  async place(@Body() body: PlaceOrderBody) {
    if (!body.items?.length) {
      throw new BadRequestException('Đơn phải có ít nhất một dòng hàng');
    }
    await this.requireActiveCustomer(body.customerId);
    const items = await this.priceItems(body.items);
    const percentOff = body.promoCode ? await this.findPercentOff(body.promoCode) : 0;
    await this.reserveStock(items);

    const subtotal = items.reduce((sum, item) => sum + item.unitPriceVnd * item.quantity, 0);
    const totalVnd = subtotal - Math.floor((subtotal * percentOff) / 100);
    const orderId = randomUUID();
    const payment = await callService('payment-service', 'POST', `${this.config.paymentUrl}/payments`, {
      orderId,
      amountVnd: totalVnd,
    });
    const order = await callService('order-service', 'POST', `${this.config.orderUrl}/orders`, {
      id: orderId,
      customerId: body.customerId,
      totalVnd,
      lines: items,
    });
    if (payment.status !== 201 || order.status !== 201) {
      throw new BadGatewayException(`payment-service trả ${payment.status}, order-service trả ${order.status}`);
    }
    return { orderId, status: 'CONFIRMED', totalVnd };
  }

  private async requireActiveCustomer(customerId: string): Promise<void> {
    const user = await callService<{ active: boolean }>(
      'user-service',
      'GET',
      `${this.config.userUrl}/users/${customerId}`,
    );
    if (user.status !== 200 || !user.body.active) {
      throw new UnprocessableEntityException('Khách hàng không hợp lệ');
    }
  }

  private async priceItems(items: PlaceOrderBody['items']): Promise<PricedItem[]> {
    const priced: PricedItem[] = [];
    for (const item of items) {
      const product = await callService<{ name: string; price_vnd: number }>(
        'product-service',
        'GET',
        `${this.config.productUrl}/products/${item.sku}`,
      );
      if (product.status !== 200) {
        throw new UnprocessableEntityException(`Không có sản phẩm ${item.sku}`);
      }
      // Đọc thẳng tên cột của bảng products: product-service đổi tên cột là chỗ này sai ngay.
      priced.push({ ...item, name: product.body.name, unitPriceVnd: product.body.price_vnd });
    }
    return priced;
  }

  private async findPercentOff(code: string): Promise<number> {
    const promotion = await callService<{ percent_off: number }>(
      'promotion-service',
      'GET',
      `${this.config.promotionUrl}/promotions/${code}`,
    );
    if (promotion.status !== 200) {
      throw new UnprocessableEntityException(`Mã khuyến mãi ${code} không hợp lệ`);
    }
    return promotion.body.percent_off;
  }

  private async reserveStock(items: PricedItem[]): Promise<void> {
    for (const item of items) {
      const stock = await callService<{ on_hand: number; reserved: number }>(
        'stock-service',
        'GET',
        `${this.config.stockUrl}/stock/${item.sku}`,
      );
      if (stock.status !== 200 || stock.body.on_hand - stock.body.reserved < item.quantity) {
        throw new ConflictException(`Không đủ hàng ${item.sku}`);
      }
    }
    for (const item of items) {
      const reserved = await callService('stock-service', 'PATCH', `${this.config.stockUrl}/stock/${item.sku}/reserve`, {
        quantity: item.quantity,
      });
      if (reserved.status !== 200) {
        throw new ConflictException(`Không đủ hàng ${item.sku}`);
      }
    }
  }
}

@Module({})
export class CheckoutApiModule {
  static register(config: CheckoutConfig): DynamicModule {
    return {
      module: CheckoutApiModule,
      controllers: [CheckoutController],
      providers: [{ provide: CHECKOUT_CONFIG, useValue: config }],
    };
  }
}
