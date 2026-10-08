import { HttpException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { PaymentInput } from './payment-input';
import { TransactionContext } from './transaction-context';

export interface PaymentResult {
  paymentId: string;
  status: 'succeeded';
  userId: string;
  merchantId: number;
  amount: number;
  balanceAfter: string;
  note: string;
}

/** Nghiệp vụ thanh toán, giống hệt nhau ở hai bản: trừ số dư ví rồi ghi một payment, trong một transaction. */
@Injectable()
export class PaymentsService {
  constructor(@Inject(TransactionContext) private readonly tx: TransactionContext) {}

  pay(input: PaymentInput): Promise<PaymentResult> {
    return this.tx.inTransaction(async (trx) => {
      // Trừ có điều kiện: hai request cùng lúc vẫn không làm số dư âm, nhưng mỗi request là một lần trừ.
      const wallet = await trx
        .updateTable('wallets')
        .set({ balance: sql`balance - ${input.amount}` })
        .where('user_id', '=', input.userId)
        .where('balance', '>=', String(input.amount))
        .returning('balance')
        .executeTakeFirst();
      if (!wallet) {
        throw new HttpException({ statusCode: 402, error: 'insufficient_funds', message: 'Số dư ví không đủ hoặc ví không tồn tại' }, 402);
      }
      const payment = await trx
        .insertInto('payments')
        .values({ user_id: input.userId, merchant_id: input.merchantId, amount: input.amount, note: input.note })
        .returning('id')
        .executeTakeFirstOrThrow();
      return {
        paymentId: payment.id,
        status: 'succeeded',
        userId: input.userId,
        merchantId: input.merchantId,
        amount: input.amount,
        balanceAfter: wallet.balance,
        note: input.note,
      };
    });
  }
}
