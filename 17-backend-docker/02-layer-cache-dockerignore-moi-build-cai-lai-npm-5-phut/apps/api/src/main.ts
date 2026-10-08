import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((err: unknown) => {
  // Lỗi khởi động (thiếu module, sai cấu hình) phải làm tiến trình thoát mã ≠ 0 để smoke test bắt được.
  console.error('Khởi động API thất bại:', err);
  process.exit(1);
});
