import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { AppModule } from './app.module';
import { loadConfig } from './shared/config';

const { port } = loadConfig();
const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
app.enableShutdownHooks();
await app.listen(port, '127.0.0.1');
const actual = (app.getHttpServer().address() as AddressInfo).port;
console.log(`API ở http://127.0.0.1:${actual} (GET /truoc/products/:id, GET /sau/products/:id, pid ${process.pid})`);
