import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { KYSELY, type Database } from './db';

/**
 * Transaction "đang mở" của request hiện tại, truyền qua AsyncLocalStorage để interceptor bọc được nghiệp vụ
 * trong transaction của nó mà service không cần biết có interceptor hay không.
 */
@Injectable()
export class TransactionContext {
  private readonly storage = new AsyncLocalStorage<Transaction<Database>>();

  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /** Chạy `fn` với `trx` là transaction hiện hành. */
  run<T>(trx: Transaction<Database>, fn: () => T): T {
    return this.storage.run(trx, fn);
  }

  /** Dùng transaction đang mở nếu có (bản "sau"), nếu không thì tự mở một transaction (bản "trước"). */
  inTransaction<T>(fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    const current = this.storage.getStore();
    return current ? fn(current) : this.db.transaction().execute(fn);
  }
}
