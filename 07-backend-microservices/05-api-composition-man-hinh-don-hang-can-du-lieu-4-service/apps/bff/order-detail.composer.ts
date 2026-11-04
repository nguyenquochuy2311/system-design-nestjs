import { BadGatewayException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createLoaders, type Customer, type Payment, type Shipment } from './batch-loaders';
import { BffMetrics } from './metrics';
import { callSource, NotFoundAtSource, type SourceName, type SourceUrls } from './source-client';

export const SOURCE_URLS = Symbol('SOURCE_URLS');

export interface Viewer {
  userId: string;
  role: 'customer' | 'support';
}

interface Order {
  id: string;
  customer_id: string;
  total_vnd: string;
}

/** Kiểu trả về ép người viết xử lý từng nguồn: nguồn tùy chọn có thể null, và partial nói rõ nguồn nào thiếu. */
export interface OrderDetail {
  order: Order;
  payment: Payment | null;
  shipping: Shipment | null;
  customer: Customer | null;
  partial: SourceName[];
}

function canView(viewer: Viewer, customerId: string): boolean {
  return viewer.role === 'support' || viewer.userId === customerId;
}

@Injectable()
export class OrderDetailComposer {
  constructor(
    @Inject(SOURCE_URLS) private readonly urls: SourceUrls,
    @Inject(BffMetrics) private readonly metrics: BffMetrics,
  ) {}

  // [PATTERN] Đồ thị phụ thuộc: tầng 1 lấy đơn vì cần customerId và để kiểm quyền; tầng 2 gọi song song.
  async detail(orderId: string, viewer: Viewer): Promise<OrderDetail> {
    const order = await this.requiredOrder(orderId);
    if (!canView(viewer, order.customer_id)) {
      // Kiểm quyền trước tầng 2: khách không xem được đơn thì không gọi xuống provider nào nữa.
      throw new ForbiddenException('Không có quyền xem đơn này');
    }
    const loaders = createLoaders(this.urls, this.metrics);
    return this.compose(order, loaders);
  }

  async list(customerId: string, viewer: Viewer): Promise<OrderDetail[]> {
    if (!canView(viewer, customerId)) {
      throw new ForbiddenException('Không có quyền xem danh sách này');
    }
    const orders = await this.requiredList(customerId);
    const loaders = createLoaders(this.urls, this.metrics);
    return Promise.all(orders.map((order) => this.compose(order, loaders)));
  }

  private async compose(order: Order, loaders: ReturnType<typeof createLoaders>): Promise<OrderDetail> {
    // [PATTERN] allSettled, không phải all: nguồn tùy chọn lỗi thì trả phần còn lại kèm cờ, không làm trắng cả màn hình.
    const [payment, shipping, customer] = await Promise.allSettled([
      loaders.payment.load(order.id),
      loaders.shipping.load(order.id),
      loaders.customer.load(order.customer_id),
    ]);
    const partial: SourceName[] = [];
    const value = <T>(source: SourceName, result: PromiseSettledResult<T | null>): T | null => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      partial.push(source);
      this.metrics.partialResponses.inc({ source });
      return null;
    };
    return {
      order,
      payment: value('payment', payment),
      shipping: value('shipping', shipping),
      customer: value('customer', customer),
      partial,
    };
  }

  private requiredOrder(orderId: string): Promise<Order> {
    return this.required(() => callSource<Order>('order', `${this.urls.orderUrl}/orders/${orderId}`, this.metrics));
  }

  private requiredList(customerId: string): Promise<Order[]> {
    return this.required(() => callSource<Order[]>('order', `${this.urls.orderUrl}/orders?customerId=${customerId}`, this.metrics));
  }

  /** Nguồn bắt buộc lỗi thì lỗi cả phản hồi: không có đơn thì không có gì để hiển thị. */
  private async required<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof NotFoundAtSource) {
        throw new NotFoundException('Không có đơn');
      }
      throw new BadGatewayException('Không lấy được đơn', { cause: error });
    }
  }
}
