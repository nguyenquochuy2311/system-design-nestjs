import { ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'undici';

export const PROMOTION_CLIENT = Symbol('PROMOTION_CLIENT');

export interface Cart {
  cartId: string;
  subtotalVnd: number;
  promoCode?: string;
}

export interface Discount {
  discountVnd: number;
  promotionUnavailable: boolean;
}

export interface PromotionClient {
  calculate(cart: Cart): Promise<Discount>;
}

/** Lỗi do chính request sai, không phải do promotion hỏng: không được đếm vào ngưỡng của cầu dao. */
export class InvalidPromoCodeError extends Error {}

export function openPromotionPool(promotionUrl: string, connections: number): Pool {
  return new Pool(promotionUrl, { connections });
}

/**
 * Timeout đặt ở đây chứ không ở opossum: AbortSignal hủy hẳn lời gọi và trả kết nối về pool. Timeout của opossum chỉ làm
 * hàm trả lỗi, kết nối vẫn bị giữ tới khi promotion trả lời, nên pool vẫn cạn đúng như sự cố cần tránh.
 * Thời gian chờ chỗ trống trong pool cũng tính vào timeout này.
 */
export async function requestDiscount(pool: Pool, cart: Cart, timeoutMs: number): Promise<Discount> {
  const { statusCode, body } = await pool.request({
    path: '/discounts',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cart),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await body.json()) as { discountVnd?: number; message?: string };
  if (statusCode === 400) {
    throw new InvalidPromoCodeError(payload.message ?? 'Mã khuyến mãi không hợp lệ');
  }
  if (statusCode !== 200) {
    throw new Error(`promotion trả ${statusCode}`);
  }
  return { discountVnd: payload.discountVnd ?? 0, promotionUnavailable: false };
}

/** Bản "trước": chờ promotion tới hết timeout dài, không có phương án dự phòng. */
export class DirectPromotionClient implements PromotionClient {
  constructor(
    private readonly pool: Pool,
    private readonly timeoutMs: number,
  ) {}

  async calculate(cart: Cart): Promise<Discount> {
    try {
      return await requestDiscount(this.pool, cart, this.timeoutMs);
    } catch (error) {
      if (error instanceof InvalidPromoCodeError) {
        throw error;
      }
      throw new ServiceUnavailableException('Không tính được khuyến mãi', { cause: error });
    }
  }
}
