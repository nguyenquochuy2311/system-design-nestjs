import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Post, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { CONFIG, type AppConfig } from '../shared/config';
import { NotesService } from '../shared/notes.service';
import { UsersService } from '../shared/users.service';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

// Bản TRƯỚC: JWT HS256 hạn 7 ngày, trả trong body để SPA lưu vào localStorage và gắn Authorization: Bearer.
// Khiếm khuyết cố ý: (1) token đọc được bằng JavaScript (localStorage); (2) stateless — khóa user không thu hồi
// được token đã phát; /truoc/me chỉ kiểm chữ ký + hạn, KHÔNG tra DB.
@Controller('truoc')
export class TruocController {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(NotesService) private readonly notes: NotesService,
  ) {}

  private verify(auth: string | undefined): { sub: string; email: string } {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) throw new UnauthorizedException({ error: 'missing_token' });
    try {
      const payload = jwt.verify(token, this.cfg.jwtSecret) as jwt.JwtPayload;
      return { sub: String(payload.sub), email: String(payload.email) };
    } catch {
      throw new UnauthorizedException({ error: 'invalid_token' });
    }
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginBody): Promise<{ token: string; user: { id: string; email: string } }> {
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) throw new BadRequestException({ error: 'email_and_password_required' });
    const user = await this.users.verifyCredentials(email, password);
    if (!user) throw new UnauthorizedException({ error: 'invalid_credentials' });
    // Hạn 7 ngày; không có cơ chế thu hồi trước hạn.
    const token = jwt.sign({ sub: user.id, email: user.email }, this.cfg.jwtSecret, { expiresIn: '7d', algorithm: 'HS256' });
    return { token, user: { id: user.id, email: user.email } };
  }

  @Get('me')
  me(@Headers('authorization') auth?: string): { id: string; email: string } {
    const claims = this.verify(auth);
    // KHÔNG tra DB: token hợp lệ là qua, kể cả khi user đã bị khóa — đây là khiếm khuyết của bản trước.
    return { id: claims.sub, email: claims.email };
  }

  @Get('notes')
  async listNotes(@Headers('authorization') auth?: string) {
    this.verify(auth);
    return this.notes.list();
  }

  @Post('notes')
  @HttpCode(201)
  async createNote(@Headers('authorization') auth: string | undefined, @Body() body: { body?: unknown }) {
    const claims = this.verify(auth);
    const text = typeof body.body === 'string' ? body.body : '';
    if (!text) throw new BadRequestException({ error: 'body_required' });
    return this.notes.create(claims.sub, text);
  }
}
