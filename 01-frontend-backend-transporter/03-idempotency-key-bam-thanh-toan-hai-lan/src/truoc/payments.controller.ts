import { Body, Controller, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { parsePaymentInput } from '../shared/payment-input';
import { PaymentsService, type PaymentResult } from '../shared/payments.service';

/** Bản "trước": mỗi POST là một lần trừ tiền mới; header Idempotency-Key (nếu có) bị bỏ qua. */
@Controller('truoc/payments')
export class TruocPaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  create(@Headers('x-user-id') userId: string | undefined, @Body() body: unknown): Promise<PaymentResult> {
    return this.payments.pay(parsePaymentInput(userId, body));
  }
}
