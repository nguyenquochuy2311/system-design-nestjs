import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { loadConfig } from './shared/config';
import { WebModule } from './web.module';

// Process type `web`. PORT=0 thì hệ điều hành chọn cổng trống (test dùng); dòng log in cổng thật.
const { port } = loadConfig();
const app = await NestFactory.create(WebModule, { logger: ['error', 'warn'] });
app.enableShutdownHooks();
await app.listen(port, '127.0.0.1');
const actual = (app.getHttpServer().address() as AddressInfo).port;
console.log(`web ở http://127.0.0.1:${actual} (pid ${process.pid})`);
