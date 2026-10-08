import { BadRequestException, Body, Controller, HttpCode, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { LoginMd5Service } from './login-md5.service';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

/** POST /truoc/login — đăng nhập theo cách cũ (MD5 không salt). */
@Controller('truoc')
export class TruocController {
  constructor(@Inject(LoginMd5Service) private readonly loginService: LoginMd5Service) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginBody): Promise<{ ok: true; userId: string }> {
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) throw new BadRequestException({ error: 'email_and_password_required' });
    const result = await this.loginService.login(email, password);
    // Lỗi chung, không nói "email không tồn tại" hay "sai mật khẩu".
    if (!result.ok || !result.userId) throw new UnauthorizedException({ error: 'invalid_credentials' });
    return { ok: true, userId: result.userId };
  }
}
