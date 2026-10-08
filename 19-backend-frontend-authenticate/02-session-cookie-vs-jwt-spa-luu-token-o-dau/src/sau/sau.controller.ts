import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONFIG, type AppConfig } from '../shared/config';
import { NotesService } from '../shared/notes.service';
import { UsersService } from '../shared/users.service';
import { mintCsrfToken } from './csrf';
import { CsrfGuard } from './csrf.guard';
import { destroySession, regenerate, saveSession } from './session.config';
import { SessionGuard } from './session.guard';
import { SessionRevoker } from './session-revoker';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

// Bản SAU: session id ngẫu nhiên trong cookie __Host-sid, dữ liệu ở Redis, CSRF guard, thu hồi tức thì.
@Controller('sau')
export class SauController {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(NotesService) private readonly notes: NotesService,
    @Inject(SessionRevoker) private readonly revoker: SessionRevoker,
  ) {}

  private issueCsrfCookie(req: Request, res: Response): string {
    const token = mintCsrfToken(this.cfg.csrfSecret, req.sessionID);
    // Cookie `csrf` ĐỌC ĐƯỢC bằng JS (không HttpOnly) để SPA cùng origin gửi lại trong header — double-submit.
    res.cookie('csrf', token, { httpOnly: false, secure: this.cfg.cookieSecure, sameSite: 'lax', path: '/' });
    return token;
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(CsrfGuard) // chỉ kiểm Origin (chưa có phiên nên chưa cần token)
  async login(@Body() body: LoginBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) throw new BadRequestException({ error: 'email_and_password_required' });
    const user = await this.users.verifyCredentials(email, password);
    if (!user) throw new UnauthorizedException({ error: 'invalid_credentials' });

    // [PATTERN] chống session fixation: tạo id MỚI trước khi gắn danh tính; id ẩn danh cũ bị hủy.
    await regenerate(req);
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.absoluteExpiry = Date.now() + this.cfg.sessionAbsoluteSeconds * 1000;
    await saveSession(req);
    await this.revoker.addSession(user.id, req.sessionID);

    const csrfToken = this.issueCsrfCookie(req, res);
    return { user: { id: user.id, email: user.email }, csrfToken };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() req: Request): { id: string; email: string } {
    // Thuần Redis (express-session đã nạp phiên); không tra DB.
    return { id: req.session.userId!, email: req.session.email! };
  }

  @Get('csrf')
  @UseGuards(SessionGuard)
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response): { csrfToken: string } {
    return { csrfToken: this.issueCsrfCookie(req, res) };
  }

  @Get('notes')
  @UseGuards(SessionGuard)
  async listNotes() {
    return this.notes.list();
  }

  @Post('notes')
  @HttpCode(201)
  @UseGuards(SessionGuard, CsrfGuard)
  async createNote(@Req() req: Request, @Body() body: { body?: unknown }) {
    const text = typeof body.body === 'string' ? body.body : '';
    if (!text) throw new BadRequestException({ error: 'body_required' });
    return this.notes.create(req.session.userId!, text);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionGuard, CsrfGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    const userId = req.session.userId!;
    const sid = req.sessionID;
    await this.revoker.removeSession(userId, sid);
    await destroySession(req); // [PATTERN] xóa bản ghi phiên khỏi Redis
    res.clearCookie(this.cfg.cookieName, { path: '/' });
    res.clearCookie('csrf', { path: '/' });
    return { ok: true };
  }

  // Lab KHÔNG kiểm vai trò quản trị: mọi phiên đã đăng nhập đều gọi được (đủ để đo thu hồi phiên). Hệ thống thật phải
  // thêm guard phân quyền trước endpoint này — xem bài 19/06 (RBAC/ABAC/ReBAC).
  @Post('admin/lock')
  @HttpCode(200)
  @UseGuards(SessionGuard, CsrfGuard)
  async lock(@Body() body: { email?: unknown }): Promise<{ ok: true; revoked: number }> {
    const email = typeof body.email === 'string' ? body.email : '';
    const target = email ? await this.users.findByEmail(email) : null;
    if (!target) throw new BadRequestException({ error: 'user_not_found' });
    await this.users.lock(target.id);
    // [PATTERN] khóa tài khoản = xóa MỌI phiên của user đó → mọi thiết bị 401 ở request kế.
    const revoked = await this.revoker.revokeAllForUser(target.id);
    return { ok: true, revoked };
  }
}
