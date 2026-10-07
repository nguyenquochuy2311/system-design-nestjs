import { Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SauModule } from './sau/sau.module';
import type { Config } from './shared/config';
import { configureHttp } from './shared/http';
import { SharedModule } from './shared/shared.module';
import { TruocModule } from './truoc/truoc.module';

// Hai bản phục vụ CÙNG đường dẫn (/api/..., /media/...) vì CDN và trình duyệt cần cùng URL; CACHE_MODE chọn bản.
@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return { module: AppModule, imports: [SharedModule.forRoot(config), config.mode === 'truoc' ? TruocModule : SauModule] };
  }
}

export async function createApp(config: Config): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { logger: ['error', 'warn'] });
  configureHttp(app, config);
  return app;
}
