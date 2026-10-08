import { BadRequestException } from '@nestjs/common';

export interface PaymentInput {
  userId: string;
  merchantId: number;
  amount: number;
  note: string;
}

/**
 * Người dùng lấy từ header `X-User-Id` (lab không làm xác thực; xem scope 19). Body: merchantId, amount (đồng), note.
 * Lỗi validate là 400 và KHÔNG được lưu làm kết quả idempotent (Stripe: chưa bắt đầu thực thi thì không lưu).
 */
export function parsePaymentInput(userHeader: unknown, body: unknown): PaymentInput {
  const userId = parseUserId(userHeader);
  const b = (body ?? {}) as Record<string, unknown>;
  const { merchantId, amount, note } = b;
  if (!Number.isInteger(merchantId) || (merchantId as number) <= 0) throw invalid('merchantId phải là số nguyên dương');
  if (!Number.isInteger(amount) || (amount as number) <= 0 || (amount as number) > 1_000_000_000) {
    throw invalid('amount phải là số nguyên từ 1 tới 1.000.000.000');
  }
  if (typeof note !== 'string' || note.length === 0 || note.length > 200) throw invalid('note dài 1 – 200 ký tự');
  return { userId, merchantId: merchantId as number, amount: amount as number, note };
}

export function parseUserId(userHeader: unknown): string {
  if (typeof userHeader === 'string' && /^[1-9]\d{0,17}$/.test(userHeader)) return userHeader;
  throw invalid('Thiếu hoặc sai header X-User-Id');
}

function invalid(message: string) {
  return new BadRequestException({ statusCode: 400, error: 'invalid_request', message });
}
