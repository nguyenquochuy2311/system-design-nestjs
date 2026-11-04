import { randomUUID } from 'node:crypto';

export interface OrderSnapshot {
  id: string;
  address: string;
  delivery_window: string;
  zone_code: string;
  version: number;
  created_at: Date;
}

/**
 * Hợp đồng công khai của order-service, tách khỏi tên cột của bảng orders. Chỉ gồm trường bên ngoài cần, không có giá.
 * Mỗi sự kiện mang đủ trường và số phiên bản của đơn, nên bên nhận chỉ cần giữ bản mới nhất, không cần đúng thứ tự.
 */
export function toPublishedEvent(
  eventType: 'OrderCreated' | 'OrderAddressChanged',
  order: OrderSnapshot,
  correlationId: string | undefined,
): Record<string, unknown> {
  return {
    eventType,
    schemaVersion: 1,
    eventId: randomUUID(),
    correlationId,
    occurredAt: new Date().toISOString(),
    orderId: order.id,
    orderVersion: order.version,
    deliveryAddress: order.address,
    deliveryWindow: order.delivery_window,
    zoneCode: order.zone_code,
  };
}
