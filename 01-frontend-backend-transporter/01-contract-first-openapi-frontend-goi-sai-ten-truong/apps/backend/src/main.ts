/** Chạy tay: `pnpm api` (VARIANT=sau mặc định, VARIANT=truoc cho bản trước), cổng 3100. */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SauAppModule } from './sau/app.module.js';
import { TruocAppModule } from './truoc/app.module.js';

const variant = process.env.VARIANT === 'truoc' ? 'truoc' : 'sau';
const port = Number(process.env.API_PORT ?? 3100);
const app = await NestFactory.create(variant === 'truoc' ? TruocAppModule : SauAppModule, { logger: ['error', 'warn'] });
await app.listen(port, '127.0.0.1');
console.log(`API bản ${variant} ở http://127.0.0.1:${port}`);
