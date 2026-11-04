import { buildPricing } from './server';

const app = buildPricing({ startupDelayMs: Number(process.env.STARTUP_DELAY_MS ?? 3_000) });

// Tắt êm: ngừng nhận kết nối mới, xử lý nốt request đang chạy, rồi đóng kết nối keep-alive đang rảnh.
process.on('SIGTERM', () => {
  void app.close().then(() => process.exit(0));
});

app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' }).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
