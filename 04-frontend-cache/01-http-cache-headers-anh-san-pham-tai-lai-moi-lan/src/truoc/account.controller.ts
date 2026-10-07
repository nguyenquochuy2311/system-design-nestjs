import { Body, Controller, Get, Header, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { AccountService } from '../shared/account.service';
import { AuthGuard, type AuthedRequest } from '../shared/guards';

@Controller('api')
@UseGuards(AuthGuard)
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  @Get('cart')
  cart(@Req() req: AuthedRequest) {
    return this.account.cart(req.userId!);
  }

  // Lỗi tái hiện: số trên icon giỏ hàng được gọi ở mọi trang nên có người "tối ưu" bằng public, max-age=30. CDN không
  // đưa cookie vào khóa cache, nên khách sau nhận giỏ của khách trước (test cdn-never-serves-other-users-cart).
  @Get('cart/summary')
  @Header('Cache-Control', 'public, max-age=30')
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
