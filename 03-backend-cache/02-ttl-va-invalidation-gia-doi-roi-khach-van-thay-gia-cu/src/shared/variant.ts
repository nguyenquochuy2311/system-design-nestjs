import type { Client, PagesService } from './pages.service';

/** Những gì controller cần từ một bản; module truoc và sau mỗi bên cung cấp một bộ. */
export interface VariantHandlers {
  pages: PagesService;
  /** Đường ghi 1: màn hình admin của người bán sửa giá bán. Trả false nếu không có sản phẩm. */
  adminSetPrice(id: number, price: number): Promise<boolean>;
  /** Bước đặt hàng: tính giá cho khách và tạo đơn. */
  placeOrder(productId: number, client: Client): Promise<{ id: number; chargedPrice: number } | undefined>;
}

export const TRUOC = Symbol('TRUOC');
export const SAU = Symbol('SAU');
