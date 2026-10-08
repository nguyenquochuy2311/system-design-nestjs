import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CONFIG, type AppConfig } from '../shared/config';
import { verifyCsrfToken } from './csrf';

/** Đọc một cookie theo tên từ header Cookie (không thêm cookie-parser). */
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * [PATTERN] Chặn CSRF cho mọi phương thức KHÔNG an toàn (POST/PUT/PATCH/DELETE):
 *   1. Kiểm `Origin` (fallback `Referer`) phải nằm trong danh sách origin được phép — chặn request từ site khác.
 *   2. Nếu phiên đã đăng nhập: bắt buộc token CSRF hợp lệ (cookie `csrf` khớp header `X-CSRF-Token` và chữ ký đúng).
 * Request đăng nhập (chưa có userId) chỉ cần qua bước (1) vì chưa có token.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;

    const origin = req.headers.origin ?? originOfReferer(req.headers.referer);
    if (!origin || !this.cfg.allowedOrigins.includes(origin)) {
      throw new ForbiddenException({ error: 'bad_origin' });
    }

    if (req.session?.userId) {
      const cookieToken = readCookie(req, 'csrf');
      const headerToken = typeof req.headers['x-csrf-token'] === 'string' ? (req.headers['x-csrf-token'] as string) : undefined;
      if (!verifyCsrfToken(this.cfg.csrfSecret, req.sessionID, cookieToken, headerToken)) {
        throw new ForbiddenException({ error: 'bad_csrf_token' });
      }
    }
    return true;
  }
}

function originOfReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
