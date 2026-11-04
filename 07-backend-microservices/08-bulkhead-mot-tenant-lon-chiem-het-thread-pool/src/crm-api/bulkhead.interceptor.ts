import { HttpException, Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { finalize, from, switchMap, type Observable } from 'rxjs';
import { compartmentOf } from './compartment.classifier';
import { CrmMetrics } from './metrics';
import { BulkheadFullError, TenantBulkhead, type Compartment, type Lease } from './tenant-bulkhead';

export const RETRY_AFTER_SECONDS = Symbol('RETRY_AFTER_SECONDS');

interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
}
interface HttpResponse {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class BulkheadInterceptor implements NestInterceptor {
  constructor(
    @Inject(TenantBulkhead) private readonly bulkhead: TenantBulkhead,
    @Inject(CrmMetrics) private readonly metrics: CrmMetrics,
    @Inject(RETRY_AFTER_SECONDS) private readonly retryAfter: Record<Compartment, number>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const compartment = compartmentOf(request.method, request.path);
    if (!compartment) {
      return next.handle();
    }
    // Lab coi tenant đã được gateway xác thực; thật thì lấy từ token, không tin header client gửi.
    const tenantId = String(request.headers['x-tenant-id']);
    return from(this.lease(compartment, tenantId, response)).pipe(
      switchMap((lease) => {
        this.metrics.waitSeconds.observe({ compartment }, lease.waitedMs / 1_000);
        response.setHeader('x-bulkhead-wait-ms', lease.waitedMs.toFixed(2));
        // [PATTERN] Trả chỗ ở finalize: chạy cả khi handler lỗi, nếu không khoang rò rỉ dần tới đầy.
        return next.handle().pipe(finalize(() => lease.release()));
      }),
    );
  }

  private async lease(compartment: Compartment, tenantId: string, response: HttpResponse): Promise<Lease> {
    try {
      return await this.bulkhead.acquire(compartment, tenantId);
    } catch (error) {
      if (error instanceof BulkheadFullError) {
        this.metrics.rejected.inc({ compartment });
        // [PATTERN] Chỉ tenant gây quá tải nhận 429, kèm thời điểm nên thử lại.
        response.setHeader('retry-after', String(this.retryAfter[compartment]));
        throw new HttpException('Vượt giới hạn đồng thời của tenant', 429);
      }
      throw error;
    }
  }
}
