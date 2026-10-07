import { Inject, Injectable } from '@nestjs/common';
import { MAILER, type Mailer } from '../../../shared/mailer';
import { assertWithinCreditLimit } from '../domain/credit-limit-policy';
import { priceOrder } from '../domain/discount-policy';
import { buildOrderLines, CustomerNotFoundError, type OrderItemRequest, type SalesChannel } from '../domain/order';
import { ORDER_UNIT_OF_WORK, type CustomerAccount, type OrderUnitOfWork } from './order-repository';

export interface PlaceOrderCommand {
  customerId: number;
  channel: SalesChannel;
  /** Mã đơn bên ngoài (order_ref của file CSV, mã đơn trên sàn); web để trống. */
  externalRef?: string;
  items: OrderItemRequest[];
}

export interface PlacedOrder {
  orderId: number;
  customerId: number;
  subtotal: number;
  discount: number;
  total: number;
}

/**
 * [PATTERN] Service Layer: một use case "đặt hàng", là ranh giới ứng dụng chung cho mọi đường vào
 * (controller web, job CSV, job đồng bộ sàn). Định ranh giới transaction, gọi domain, lưu qua repository.
 * Ném lỗi nghiệp vụ có kiểu, không ném HttpException: job CSV không có "mã HTTP" nào để hiểu.
 */
@Injectable()
export class PlaceOrderService {
  // @Inject tường minh: tsx/esbuild không phát metadata kiểu tham số nên NestJS không tự suy ra được.
  constructor(
    @Inject(ORDER_UNIT_OF_WORK) private readonly unitOfWork: OrderUnitOfWork,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async placeOrder(command: PlaceOrderCommand): Promise<PlacedOrder> {
    const { customer, placed } = await this.unitOfWork.run(async ({ customers, products, orders }) => {
      const customer = await customers.findForUpdate(command.customerId);
      if (!customer) throw new CustomerNotFoundError(command.customerId);
      const catalog = await products.findByIds([...new Set(command.items.map((i) => i.productId))]);
      const lines = buildOrderLines(command.items, catalog);
      const pricing = priceOrder(customer.tier, lines);
      const outstanding = await orders.outstandingDebt(customer.id);
      assertWithinCreditLimit({ customerId: customer.id, creditLimit: customer.creditLimit, outstanding }, pricing.total);
      const externalRef = command.externalRef ?? null;
      const orderId = await orders.insert({ customerId: customer.id, channel: command.channel, externalRef, ...pricing, lines });
      return { customer, placed: { orderId, customerId: customer.id, ...pricing } };
    });
    // Gửi sau khi commit: đơn bị từ chối hoặc rollback thì không có email.
    await this.mailer.send(confirmationEmail(customer, placed));
    return placed;
  }
}

function confirmationEmail(customer: CustomerAccount, order: PlacedOrder) {
  return {
    to: customer.email,
    subject: `Xác nhận đơn #${order.orderId}`,
    body: `Chào ${customer.name}, đơn #${order.orderId} tổng ${order.total} đồng đã được ghi nhận.`,
  };
}
