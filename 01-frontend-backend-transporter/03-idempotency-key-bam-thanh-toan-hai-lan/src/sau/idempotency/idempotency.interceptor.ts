import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Kysely } from 'kysely';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { KYSELY, type Database } from '../../shared/db';
import { parseUserId } from '../../shared/payment-input';
import { TransactionContext } from '../../shared/transaction-context';
import { IdempotencyRepository, type KeyRow } from './idempotency.repository';
import { IDEMPOTENCY_OPTIONS, type IdempotencyOptions } from './idempotency.options';
import { parseIdempotencyKey, requestFingerprint } from './request-fingerprint';

// Chỉ phần của request/response Express mà interceptor dùng (không phụ thuộc gói @types/express).
interface Request {
  method: string;
  path: string;
  body: unknown;
  header(name: string): string | undefined;
}
interface Response {
  setHeader(name: string, value: string): unknown;
}

/** Header lab tự đặt để client (và bộ đo) biết response là bản phát lại; không nằm trong bản nháp IETF. */
export const REPLAYED_HEADER = 'Idempotent-Replayed';

/**
 * [PATTERN] Idempotency Key quanh một handler ghi tiền:
 *   1. giành khóa (user, key) bằng INSERT ... ON CONFLICT;
 *   2. khóa đã có: khác dấu vân tay → 422; đã xong → phát lại response; đang xử lý → 409;
 *   3. khóa mới: chạy handler và lưu response trong CÙNG một transaction.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(IdempotencyRepository) private readonly keys: IdempotencyRepository,
    @Inject(TransactionContext) private readonly tx: TransactionContext,
    @Inject(IDEMPOTENCY_OPTIONS) private readonly options: IdempotencyOptions,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const successCode = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ?? 201;
    return from(this.handle(http.getRequest<Request>(), http.getResponse<Response>(), next, successCode));
  }

  private async handle(req: Request, res: Response, next: CallHandler, successCode: number): Promise<unknown> {
    const key = parseIdempotencyKey(req.header('idempotency-key'));
    const userId = parseUserId(req.header('x-user-id'));
    const fingerprint = requestFingerprint(req.method, req.path, req.body);

    const claim = await this.keys.claim(userId, key, req.method, req.path, fingerprint);
    if (!claim.owned) {
      const row = claim.row;
      // Dòng vừa bị nhả giữa hai câu lệnh: coi như đang bận, client gửi lại sau.
      if (!row) throw this.inFlight(res);
      // [PATTERN] Cùng khóa nhưng payload khác: lỗi của client, không được im lặng trả kết quả cũ (bản nháp: 422).
      if (row.fingerprint !== fingerprint) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'idempotency_key_reused',
          message: 'Idempotency-Key này đã dùng cho một request có nội dung khác',
        });
      }
      if (row.status === 'completed') return this.replay(res, row);
      // [PATTERN] Lần đầu còn đang xử lý: báo xung đột (bản nháp: 409), trừ khi khóa đã kẹt quá lâu thì tiếp quản.
      if (!(await this.keys.takeOver(userId, key, this.options.lockTimeoutMs))) throw this.inFlight(res);
    }

    try {
      // [PATTERN] Nghiệp vụ và việc lưu response chung một transaction: hoặc có cả hai, hoặc không có gì.
      const result = await this.db.transaction().execute(async (trx) => {
        const body = await this.tx.run(trx, () => lastValueFrom(next.handle()));
        await this.keys.complete(trx, userId, key, successCode, JSON.stringify(body));
        return body;
      });
      return result;
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 500;
      if (err instanceof HttpException && status >= 401 && status < 500) {
        // Nghiệp vụ từ chối (ví dụ số dư không đủ): transaction đã rollback, không có gì được ghi. Lưu lỗi để lần
        // gửi lại nhận đúng lỗi này thay vì chạy lại (Stripe lưu cả kết quả lỗi).
        await this.keys.complete(this.db, userId, key, status, JSON.stringify(err.getResponse()));
      } else {
        // 400 (chưa bắt đầu thực thi) hoặc lỗi hệ thống: transaction đã rollback, nhả khóa để gửi lại được.
        await this.keys.release(userId, key).catch((e: unknown) => this.logger.error(`Không nhả được khóa ${userId}/${key}: ${String(e)}`));
      }
      throw err;
    }
  }

  private replay(res: Response, row: KeyRow): unknown {
    res.setHeader(REPLAYED_HEADER, 'true');
    const body: unknown = JSON.parse(row.response_body ?? 'null');
    // Response thành công đi qua đường trả về bình thường (Express tự JSON.stringify ra đúng chuỗi đã lưu);
    // response lỗi được ném lại để exception filter trả đúng mã và thân đã lưu.
    if (row.response_code !== null && row.response_code >= 400) throw new HttpException(body as object, row.response_code);
    return body;
  }

  private inFlight(res: Response): ConflictException {
    res.setHeader('Retry-After', '1');
    return new ConflictException({
      statusCode: 409,
      error: 'idempotency_key_in_use',
      message: 'Request đầu tiên với Idempotency-Key này còn đang xử lý; gửi lại sau',
    });
  }
}
