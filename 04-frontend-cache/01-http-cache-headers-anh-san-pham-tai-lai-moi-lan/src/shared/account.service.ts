import { Inject, Injectable } from '@nestjs/common';
import { PRODUCT_COUNT, type CartSummaryJson } from './catalog-data';
import { CatalogService } from './catalog.service';

export interface CartLine {
  productId: number;
  name: string;
  qty: number;
  price: number;
}

/** Giỏ hàng, đơn hàng, tài khoản theo từng khách — dữ liệu riêng, không bao giờ được nằm ở cache dùng chung. */
@Injectable()
export class AccountService {
  private readonly carts = new Map<number, Map<number, number>>();

  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  /** Giỏ khởi tạo tất định theo id khách: khách u có (u mod 4) dòng hàng, nên hai khách thường có giỏ khác nhau. */
  private cartOf(userId: number): Map<number, number> {
    let cart = this.carts.get(userId);
    if (!cart) {
      cart = new Map();
      for (let k = 0; k < userId % 4; k++) cart.set(((userId * 13 + k * 7) % PRODUCT_COUNT) + 1, 1 + (k % 2));
      this.carts.set(userId, cart);
    }
    return cart;
  }

  cart(userId: number): { userId: number; lines: CartLine[] } {
    const lines = [...this.cartOf(userId)].map(([productId, qty]) => {
      const p = this.catalog.get(productId);
      return { productId, name: p.name, qty, price: p.price };
    });
    return { userId, lines };
  }

  summary(userId: number): CartSummaryJson {
    const { lines } = this.cart(userId);
    return { userId, count: lines.reduce((n, l) => n + l.qty, 0), total: lines.reduce((s, l) => s + l.qty * l.price, 0) };
  }

  addItem(userId: number, productId: number, qty: number): CartSummaryJson {
    this.catalog.get(productId);
    const cart = this.cartOf(userId);
    cart.set(productId, (cart.get(productId) ?? 0) + Math.max(1, Math.trunc(qty)));
    return this.summary(userId);
  }

  orders(userId: number) {
    return Array.from({ length: 1 + (userId % 3) }, (_, i) => ({
      id: `DH${userId}-${i + 1}`,
      total: 1_500_000 + ((userId + i) % 7) * 250_000,
      status: i === 0 ? 'dang-giao' : 'da-giao',
    }));
  }

  account(userId: number) {
    return { userId, name: `Khách ${userId}`, email: `khach${userId}@example.test`, phone: `09xx xxx ${String(userId % 1000).padStart(3, '0')}` };
  }
}
