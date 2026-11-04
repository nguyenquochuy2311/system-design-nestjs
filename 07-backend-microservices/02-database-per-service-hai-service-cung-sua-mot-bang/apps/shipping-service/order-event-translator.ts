/** Mô hình của shipping: chỉ những gì cần để giao hàng. */
export interface ShipmentOrderUpdate {
  orderId: string;
  orderVersion: number;
  address: string;
  deliveryWindow: string;
  zoneCode: string;
  occurredAt: Date;
  correlationId: string | undefined;
}

export type Translation = { kind: 'apply'; update: ShipmentOrderUpdate } | { kind: 'quarantine'; reason: string };

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** Mọi hiểu biết về hình dạng sự kiện của order-service nằm ở đây. Trường lạ bị bỏ qua, sự kiện hỏng bị cách ly. */
export function translateOrderEvent(raw: unknown): Translation {
  const event = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const known = event.eventType === 'OrderCreated' || event.eventType === 'OrderAddressChanged';
  const occurredAt = new Date(String(event.occurredAt));
  if (
    known &&
    isText(event.orderId) &&
    Number.isInteger(event.orderVersion) &&
    isText(event.deliveryAddress) &&
    isText(event.deliveryWindow) &&
    isText(event.zoneCode) &&
    !Number.isNaN(occurredAt.getTime())
  ) {
    return {
      kind: 'apply',
      update: {
        orderId: event.orderId,
        orderVersion: event.orderVersion as number,
        address: event.deliveryAddress,
        deliveryWindow: event.deliveryWindow,
        zoneCode: event.zoneCode,
        occurredAt,
        correlationId: isText(event.correlationId) ? event.correlationId : undefined,
      },
    };
  }
  return { kind: 'quarantine', reason: `Không dịch được sự kiện ${String(event.eventType)}` };
}

/** Địa chỉ theo mô hình mới của shipping, cùng quy tắc với migration 002. */
export function splitAddress(address: string): { street: string; ward: string; district: string } {
  const [street = '', ward = '', district = ''] = address.split(', ');
  return { street, ward, district };
}
