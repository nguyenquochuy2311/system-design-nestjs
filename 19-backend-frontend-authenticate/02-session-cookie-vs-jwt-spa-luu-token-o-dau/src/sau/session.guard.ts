import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CONFIG, type AppConfig } from '../shared/config';
import { destroySession } from './session.config';

/**
 * [PATTERN] Cho qua chỉ khi phiên còn sống: có `userId` (phiên tồn tại ở Redis và đã đăng nhập) và chưa quá hạn
 * tuyệt đối. Phiên bị xóa (đăng xuất / khóa user) thì express-session không nạp được `userId` → 401 ở request kế.
 * KHÔNG tra DB mỗi request — thu hồi là xóa phiên, không phải kiểm cờ khóa từng lần.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.session?.userId) throw new UnauthorizedException({ error: 'no_session' });
    const abs = req.session.absoluteExpiry;
    if (typeof abs === 'number' && Date.now() > abs) {
      await destroySession(req);
      throw new UnauthorizedException({ error: 'session_expired' });
    }
    return true;
  }
}
