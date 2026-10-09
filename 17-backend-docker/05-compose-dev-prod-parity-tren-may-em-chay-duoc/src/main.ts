import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadDotEnv } from './config';
import { CustomersRepository } from './customers/customers.repository';

loadDotEnv();
const port = Number(process.env.PORT ?? 3100);
const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
app.enableShutdownHooks();
// In ra role và phiên bản DB lúc khởi động: nối nhầm sang PostgreSQL cài sẵn trên máy thì thấy ngay (README 3.4).
const who = await app.get(CustomersRepository).whoAmI();
await app.listen(port, '127.0.0.1');
console.log(`API ở http://127.0.0.1:${port} · DB role=${who.role} server=${who.serverVersion}`);
