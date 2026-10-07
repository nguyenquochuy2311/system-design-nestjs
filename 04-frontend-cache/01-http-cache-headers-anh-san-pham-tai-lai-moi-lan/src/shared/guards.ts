import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CONFIG, type Config } from './config';
import { SESSION_COOKIE, readCookie, verifySession } from './session';

export type AuthedRequest = Request & { userId?: number };

/** Route của khách đã đăng nhập (giỏ hàng, đơn, tài khoản). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const userId = verifySession(this.config.sessionSecret, readCookie(req.headers.cookie, SESSION_COOKIE));
    if (userId === null) throw new UnauthorizedException('cần đăng nhập');
    req.userId = userId;
    return true;
  }
}

/** Route quản trị (đổi giá) — header X-Admin-Token. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.headers['x-admin-token'] !== this.config.adminToken) throw new UnauthorizedException('cần quyền quản trị');
    return true;
  }
}
