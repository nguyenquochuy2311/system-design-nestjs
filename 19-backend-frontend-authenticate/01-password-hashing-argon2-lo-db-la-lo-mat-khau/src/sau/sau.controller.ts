import { BadRequestException, Body, Controller, HttpCode, HttpException, Inject, Ip, Post, UnauthorizedException } from '@nestjs/common';
import { LoginService } from './login.service';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

/** POST /sau/login — đăng nhập Argon2id + nâng cấp hash + bộ đếm sai. */
@Controller('sau')
export class SauController {
  // @Inject tường minh: tsx (esbuild) không phát metadata design:paramtypes (nhật ký 08/01 điểm 1).
  constructor(@Inject(LoginService) private readonly loginService: LoginService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginBody,
    @Ip() ip: string,
  ): Promise<{ ok: true; userId: string; hashVersion: number; upgraded: boolean }> {
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) throw new BadRequestException({ error: 'email_and_password_required' });

    const outcome = await this.loginService.login(email, password, ip || 'unknown');
    if (outcome.kind === 'blocked') {
      // 429 Too Many Requests (RFC 6585) — thử sai quá nhiều lần.
      throw new HttpException({ error: 'too_many_attempts' }, 429);
    }
    if (outcome.kind === 'invalid') {
      // Lỗi chung, không phân biệt "email không tồn tại" và "sai mật khẩu".
      throw new UnauthorizedException({ error: 'invalid_credentials' });
    }
    return { ok: true, userId: outcome.userId, hashVersion: outcome.hashVersion, upgraded: outcome.upgraded };
  }
}
