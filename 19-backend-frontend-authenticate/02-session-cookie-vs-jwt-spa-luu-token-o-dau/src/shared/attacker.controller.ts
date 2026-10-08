import { Body, Controller, Get, Post } from '@nestjs/common';

interface Loot {
  at: string;
  localStorage: string | null;
  documentCookie: string | null;
  note: string | null;
}

// Endpoint "kẻ tấn công" GIẢ LẬP, chỉ tồn tại trong lab để hứng dữ liệu script XSS (payload của chính lab) gửi về.
// KHÔNG nhắm tới site nào khác. Lưu trong bộ nhớ để bench/test đọc lại thứ payload lấy được.
@Controller('_attacker')
export class AttackerController {
  private loot: Loot[] = [];

  @Post('collect')
  collect(@Body() body: { localStorage?: unknown; documentCookie?: unknown; note?: unknown }): { ok: true } {
    this.loot.push({
      at: new Date().toISOString(),
      localStorage: typeof body.localStorage === 'string' ? body.localStorage : null,
      documentCookie: typeof body.documentCookie === 'string' ? body.documentCookie : null,
      note: typeof body.note === 'string' ? body.note : null,
    });
    return { ok: true };
  }

  @Get('loot')
  getLoot(): Loot[] {
    return this.loot;
  }

  @Post('reset')
  reset(): { ok: true } {
    this.loot = [];
    return { ok: true };
  }
}
