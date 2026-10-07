import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { AccountService } from '../shared/account.service';
import { AuthGuard, type AuthedRequest } from '../shared/guards';
import { CachePolicy } from './cache-policy';

// Dữ liệu riêng của khách. Khai báo private tường minh; dù có ai đổi thành public, interceptor vẫn ép private
// vì controller có guard (phép thử âm ở mục 5.1 kiểm cả hai lớp).
@Controller('api')
@UseGuards(AuthGuard)
@CachePolicy('private')
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  @Get('cart')
  cart(@Req() req: AuthedRequest) {
    return this.account.cart(req.userId!);
  }

  @Get('cart/summary')
  summary(@Req() req: AuthedRequest) {
    return this.account.summary(req.userId!);
  }

  @Post('cart/items')
  add(@Req() req: AuthedRequest, @Body() body: { productId?: number; qty?: number }) {
    return this.account.addItem(req.userId!, Number(body.productId), Number(body.qty ?? 1));
  }

  @Get('orders')
  orders(@Req() req: AuthedRequest) {
    return this.account.orders(req.userId!);
  }

  @Get('account')
  me(@Req() req: AuthedRequest) {
    return this.account.account(req.userId!);
  }
}
