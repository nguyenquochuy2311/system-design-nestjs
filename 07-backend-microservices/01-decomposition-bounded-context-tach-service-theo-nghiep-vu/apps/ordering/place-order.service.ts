import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OrderRepository } from './order.repository';
import { orderTotalVnd, priceLines, UnknownProductError, type OrderItem, type OrderLine } from './pricing';
import { InventoryClient, PaymentClient } from './upstream-clients';

export interface PlaceOrderCommand {
  customerId: string;
  items: OrderItem[];
  promoCode?: string;
}

@Injectable()
export class PlaceOrderService {
  constructor(
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(InventoryClient) private readonly inventory: InventoryClient,
    @Inject(PaymentClient) private readonly payment: PaymentClient,
  ) {}

  // [PATTERN] Quy tắc đặt hàng có một chủ: khách, giá và khuyến mãi đều đọc từ dữ liệu của Ordering, nên bước này không
  // có lời gọi mạng nào và không phụ thuộc Catalog. Ra ngoài chỉ còn hai lệnh: đặt giữ và thu tiền.
  async execute(command: PlaceOrderCommand) {
    if (!command.items?.length) {
      throw new BadRequestException('Đơn phải có ít nhất một dòng hàng');
    }
    if (!(await this.orders.isActiveCustomer(command.customerId))) {
      throw new UnprocessableEntityException('Khách hàng không hợp lệ');
    }
    const lines = await this.priceFromSnapshots(command.items);
    const totalVnd = orderTotalVnd(lines, await this.percentOff(command.promoCode));

    const orderId = randomUUID();
    await this.orders.createPending(orderId, command.customerId, totalVnd, lines);
    const reservation = await this.failOrderOnError(orderId, () => this.inventory.reserve(orderId, lines));
    if (reservation === 'out-of-stock') {
      await this.orders.setStatus(orderId, 'REJECTED');
      throw new ConflictException('Không đủ hàng');
    }
    await this.failOrderOnError(orderId, () => this.payment.charge(orderId, totalVnd));
    await this.orders.setStatus(orderId, 'CONFIRMED');
    return { orderId, status: 'CONFIRMED', totalVnd };
  }

  private async priceFromSnapshots(items: OrderItem[]): Promise<OrderLine[]> {
    const snapshots = await this.orders.findSnapshots(items.map((item) => item.sku));
    try {
      return priceLines(items, snapshots);
    } catch (error) {
      if (error instanceof UnknownProductError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }

  private async percentOff(promoCode: string | undefined): Promise<number> {
    if (!promoCode) {
      return 0;
    }
    const percentOff = await this.orders.findPercentOff(promoCode);
    if (percentOff === undefined) {
      throw new UnprocessableEntityException(`Mã khuyến mãi ${promoCode} không hợp lệ`);
    }
    return percentOff;
  }

  // Nhả hàng khi thu tiền lỗi là việc của Saga (bài 07/07); ở bài này phần đặt giữ tự hết hạn sau 15 phút.
  private async failOrderOnError<T>(orderId: string, step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (error) {
      await this.orders.setStatus(orderId, 'FAILED');
      throw error;
    }
  }
}
