import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const port = Number(process.env.PORT ?? 3100);
const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
app.enableShutdownHooks();
await app.listen(port, '127.0.0.1');
console.log(`API ở http://127.0.0.1:${port} (POST /truoc/login, POST /sau/login)`);
