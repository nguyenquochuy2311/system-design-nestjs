import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AccountController } from './account.controller';
import { MediaController, ProductsController } from './catalog.controller';
import { HttpCacheInterceptor } from './http-cache.interceptor';

@Module({
  controllers: [ProductsController, MediaController, AccountController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: HttpCacheInterceptor }],
})
export class SauModule {}
