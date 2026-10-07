import { BadRequestException, Controller, Get, Headers, Inject, NotFoundException, Query, Res } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import type { Kysely } from 'kysely';
import { KYSELY, type Database } from '../shared/db';
import { MONTH_RE, REPORT_COLUMNS, reportFilename, reportQuery } from '../shared/order-report';

/**
 * Bản "trước": xuất Excel ngay trong request web. Tái hiện triệu chứng của bài:
 * - đọc toàn bộ dòng vào bộ nhớ, dựng cả workbook trong bộ nhớ rồi mới nén;
 * - dựng workbook là việc CPU đồng bộ trên event loop của web process, mọi request khác (kể cả health check) phải chờ.
 */
@Controller('truoc/reports')
export class OrdersXlsxController {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  @Get('orders.xlsx')
  async export(@Headers('x-user-id') userHeader: string | undefined, @Query('month') month: string | undefined, @Res() res: Response) {
    if (!MONTH_RE.test(month ?? '')) throw new BadRequestException('month phải có dạng YYYY-MM');
    const user = await this.db.selectFrom('users').select(['tenant_id']).where('id', '=', Number(userHeader)).executeTakeFirst();
    if (!user) throw new NotFoundException(`không có người dùng ${userHeader}`);

    const rows = await reportQuery(this.db, user.tenant_id, month as string).execute(); // cả 50.000 dòng trong bộ nhớ
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Đơn hàng');
    sheet.columns = REPORT_COLUMNS.map((c) => ({ ...c }));
    for (const row of rows) sheet.addRow(row); // vòng lặp đồng bộ: event loop không phục vụ request nào khác
    const buffer = await workbook.xlsx.writeBuffer(); // nén cả workbook trong bộ nhớ

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${reportFilename(month as string)}"`);
    res.send(Buffer.from(buffer));
  }
}
