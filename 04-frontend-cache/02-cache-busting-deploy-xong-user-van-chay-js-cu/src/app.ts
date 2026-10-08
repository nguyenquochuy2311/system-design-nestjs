import { Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { SauContactsController } from './sau/contacts.controller';
import { CONFIG, type Config } from './shared/config';
import { ContactsStore } from './shared/contacts.store';
import { requestLogger } from './shared/request-log';
import { ReleaseState } from './shared/release.state';
import { ClientErrorsController, OpsController, ReportsController } from './shared/shared.controllers';
import { TruocContactsController } from './truoc/contacts.controller';

// Mỗi site một tiến trình API (SITE=truoc ở 3101, SITE=sau ở 3100) để CDN gọi đúng bản theo tên miền.
@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      controllers: [config.site === 'truoc' ? TruocContactsController : SauContactsController, ReportsController, ClientErrorsController, OpsController],
      providers: [{ provide: CONFIG, useValue: config }, ReleaseState, ContactsStore],
    };
  }
}

export async function createApp(config: Config): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { logger: ['error', 'warn'] });
  app.set('etag', false);
  app.disable('x-powered-by');
  if (config.requestLog) app.use(requestLogger(config.requestLog));
  // Dữ liệu API không được lưu ở CDN hay trình duyệt: bài này chỉ cache file tĩnh.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  return app;
}
