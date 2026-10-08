import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { CONFIG, type AppConfig } from './shared/config';
import { localhostSecureShim } from './shared/localhost-secure';
import { REDIS } from './shared/redis';
import { createSessionMiddleware } from './sau/session.config';

const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
const cfg = app.get<AppConfig>(CONFIG);
const redis = app.get(REDIS);

app.set('trust proxy', 1);
// Lab shim chỉ cho Host localhost, bật bằng TRUST_LOCALHOST_SECURE=1 (xem src/shared/localhost-secure.ts).
if (cfg.trustLocalhostSecure) app.use(localhostSecureShim);
// Middleware phiên chỉ gắn cho /sau/* (bản trước không có phiên).
app.use('/sau', createSessionMiddleware(cfg, redis));
app.enableShutdownHooks();

await app.listen(cfg.port, '127.0.0.1');
console.log(`API ở http://127.0.0.1:${cfg.port} (/truoc/*, /sau/*, /_attacker/*)`);
