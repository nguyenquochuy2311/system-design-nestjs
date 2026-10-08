import RedisStore from 'connect-redis';
import session from 'express-session';
import type { RequestHandler } from 'express';
import type Redis from 'ioredis';
import type { AppConfig } from '../shared/config';
import './session.types';

/** Tiền tố khóa phiên trong Redis; phải khớp với SessionRevoker để xóa đúng bản ghi. */
export const SESS_PREFIX = 'sess:';

/**
 * [PATTERN] Middleware phiên: id ngẫu nhiên (express-session sinh), dữ liệu phiên ở Redis (connect-redis),
 * chỉ gửi id về trình duyệt trong cookie `__Host-sid`:
 *   - HttpOnly: JavaScript không đọc được id → XSS không "mang chìa khóa" đi được.
 *   - Secure + tiền tố __Host- + Path=/ + KHÔNG Domain: cookie chỉ gắn đúng host này, không rò sang subdomain.
 *   - SameSite=Lax: không gửi kèm request POST khởi từ site khác.
 *   - rolling: gia hạn TTL (hạn nhàn rỗi) mỗi response; hạn tuyệt đối kiểm riêng trong SessionGuard.
 */
export function createSessionMiddleware(cfg: AppConfig, redis: Redis): RequestHandler {
  const store = new RedisStore({ client: redis, prefix: SESS_PREFIX, ttl: cfg.sessionIdleSeconds });
  return session({
    name: cfg.cookieName,
    secret: cfg.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: cfg.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: cfg.sessionIdleSeconds * 1000,
      // KHÔNG đặt domain: tiền tố __Host- buộc không có Domain.
    },
  });
}

// express-session dùng callback; bọc lại thành Promise cho controller async.
import type { Request } from 'express';

export const regenerate = (req: Request): Promise<void> =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

export const saveSession = (req: Request): Promise<void> =>
  new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));

export const destroySession = (req: Request): Promise<void> =>
  new Promise((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));
