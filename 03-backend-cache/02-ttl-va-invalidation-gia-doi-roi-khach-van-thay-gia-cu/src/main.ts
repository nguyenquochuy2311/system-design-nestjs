import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { AppModule } from './app.module';
import { loadConfig } from './shared/config';

const { port, pageTtlS, pageTtlJitterPct } = loadConfig();
const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
app.enableShutdownHooks();
await app.listen(port, '127.0.0.1');
const actual = (app.getHttpServer().address() as AddressInfo).port;
console.log(`API ở http://127.0.0.1:${actual} (/truoc/..., /sau/..., TTL ${pageTtlS} s, jitter bản sau ±${pageTtlJitterPct} %, pid ${process.pid})`);
