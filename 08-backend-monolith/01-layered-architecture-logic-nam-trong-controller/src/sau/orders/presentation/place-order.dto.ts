import { BadRequestException } from '@nestjs/common';
import type { OrderItemRequest } from '../domain/order';

export interface PlaceOrderBody {
  customerId: number;
  items: OrderItemRequest[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isIntInRange = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= max;

/**
 * Kiểm hình dạng body (kiểu, khoảng giá trị) — việc của lớp presentation, không phải quy tắc nghiệp vụ.
 * Thông báo lỗi giữ nguyên như bản cũ để test đặc tả của luồng web vẫn đúng.
 */
export function parsePlaceOrderBody(body: unknown): PlaceOrderBody {
  if (!isRecord(body)) throw new BadRequestException('Body phải là JSON object');
  const { customerId, items } = body;
  if (!isIntInRange(customerId, Number.MAX_SAFE_INTEGER)) {
    throw new BadRequestException('customerId phải là số nguyên dương');
  }
  if (!Array.isArray(items) || items.length === 0) throw new BadRequestException('Đơn phải có ít nhất một dòng hàng');
  if (items.length > 100) throw new BadRequestException('Đơn tối đa 100 dòng hàng');
  return { customerId, items: items.map(parseItem) };
}

function parseItem(item: unknown): OrderItemRequest {
  if (!isRecord(item) || !isIntInRange(item.productId, Number.MAX_SAFE_INTEGER)) {
    throw new BadRequestException('productId phải là số nguyên dương');
  }
  if (!isIntInRange(item.quantity, 10_000)) throw new BadRequestException('quantity phải là số nguyên từ 1 đến 10000');
  return { productId: item.productId, quantity: item.quantity };
}
