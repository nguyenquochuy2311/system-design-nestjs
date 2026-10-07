import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { catchError, map, throwError, type Observable } from 'rxjs';
import { CACHE_POLICIES, CACHE_POLICY_KEY, etagFor, isShared, type CachePolicyName } from './cache-policy';

/**
 * Áp bảng chính sách cho mọi route của bản sau (đăng ký toàn cục bằng APP_INTERCEPTOR).
 * Cache-Control đặt TRƯỚC khi chạy handler, vì route ảnh tự gửi response bằng @Res(); ETag của JSON đặt sau khi có body.
 */
@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const declared = this.reflector.getAllAndOverride<CachePolicyName | undefined>(CACHE_POLICY_KEY, [ctx.getHandler(), ctx.getClass()]) ?? 'no-store';
    const guards = this.reflector.getAllAndMerge<unknown[]>(GUARDS_METADATA, [ctx.getClass(), ctx.getHandler()]);
    // [PATTERN] Route có guard không bao giờ được cache dùng chung lưu, dù ai đó khai báo public "cho nhanh".
    const policy: CachePolicyName = guards.length > 0 && isShared(declared) ? 'private' : declared;
    const res = ctx.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', CACHE_POLICIES[policy]);

    return next.handle().pipe(
      map((body: unknown) => {
        // [PATTERN] ETag từ hash JSON. Express so ETag này với If-None-Match (req.fresh) và tự trả 304 không body khi khớp.
        if (policy === 'public-json' && body !== undefined && !res.headersSent) res.setHeader('ETag', etagFor(JSON.stringify(body)));
        return body;
      }),
      catchError((err: unknown) => {
        // Lỗi (404, 400...) không được mang chính sách của response thành công: CDN sẽ giữ lỗi đó cho mọi người.
        if (!res.headersSent) {
          res.setHeader('Cache-Control', CACHE_POLICIES['no-store']);
          res.removeHeader('ETag');
          res.removeHeader('Vary');
        }
        return throwError(() => err);
      }),
    );
  }
}
