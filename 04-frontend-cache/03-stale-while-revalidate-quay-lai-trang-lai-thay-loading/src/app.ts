import { Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { OpsController } from './ops.controller';
import { OrdersController, SessionController } from './orders.controller';
import { CONFIG, type Config } from './shared/config';
import { OrderStore } from './shared/orders.store';
import { RequestLog } from './shared/request-log';

@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      controllers: [OrdersController, SessionController, OpsController],
      providers: [{ provide: CONFIG, useValue: config }, OrderStore, RequestLog],
    };
  }
}

export async function createApp(config: Config): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { logger: ['error', 'warn'] });
  app.set('etag', false);
  app.disable('x-powered-by');
  const log = app.get(RequestLog);
  log.file = config.requestLog;
  app.use(log.middleware());
  // Bài này đo cache dữ liệu TRONG ứng dụng; HTTP cache của trình duyệt không được giữ response API (bài 04/01).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get(OrderStore).reset(config.seed);
  return app;
}
