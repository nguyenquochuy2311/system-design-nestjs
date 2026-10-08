import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Post, Query, Res, Headers, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { isReleaseId } from '../../web/releases';
import { CONFIG, type Config } from './config';
import { ContactsStore } from './contacts.store';
import { ReleaseState } from './release.state';

/** Báo cáo pipeline: hợp đồng không đổi giữa các bản. */
@Controller('api/reports')
export class ReportsController {
  @Get('summary')
  summary() {
    return {
      rows: [
        { stage: 'Tiềm năng', deals: 42, value: 1_260_000_000 },
        { stage: 'Đã liên hệ', deals: 27, value: 980_000_000 },
        { stage: 'Đàm phán', deals: 11, value: 640_000_000 },
        { stage: 'Chốt', deals: 6, value: 410_000_000 },
      ],
    };
  }
}

/** Nhận lỗi JS từ bộ đo inline trong index.html; ghi vào nhật ký request. */
@Controller('api/client-errors')
export class ClientErrorsController {
  @Post()
  @HttpCode(204)
  report(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response): void {
    res.locals.log = { clientError: { kind: body.kind, message: body.message, src: body.src, version: body.version, path: body.path, tab: body.tab } };
  }
}

/** Điều khiển của lab: sức khỏe, đổi bản đang chạy (bước "deploy API"), xem ghi chú đã lưu. */
@Controller('ops')
export class OpsController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(ReleaseState) private readonly state: ReleaseState,
    @Inject(ContactsStore) private readonly store: ContactsStore,
  ) {}

  @Get('health')
  health() {
    return { ok: true, site: this.config.site, release: this.state.current, pid: process.pid };
  }

  @Post('release')
  setRelease(@Headers('x-ops-token') token: string | undefined, @Body() body: { release?: string }) {
    if (token !== this.config.opsToken) throw new ForbiddenException('sai x-ops-token');
    if (!body.release || !isReleaseId(body.release)) throw new BadRequestException(`release không hợp lệ: ${body.release}`);
    this.state.current = body.release;
    return { release: this.state.current, contract: this.state.contract };
  }

  @Get('notes')
  notes(@Query('contactId') contactId?: string) {
    const all = this.store.allNotes();
    return contactId ? all.filter((n) => n.contactId === Number(contactId)) : all;
  }
}
