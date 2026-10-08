import { Body, Controller, Headers, HttpCode, Inject, Post, UseInterceptors } from '@nestjs/common';
import { parsePaymentInput } from '../shared/payment-input';
import { PaymentsService, type PaymentResult } from '../shared/payments.service';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';

/** Bản "sau": cùng handler với bản trước, chỉ thêm interceptor idempotency. */
@Controller('sau/payments')
export class SauPaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(IdempotencyInterceptor) // [PATTERN]
  create(@Headers('x-user-id') userId: string | undefined, @Body() body: unknown): Promise<PaymentResult> {
    return this.payments.pay(parsePaymentInput(userId, body));
  }
}
