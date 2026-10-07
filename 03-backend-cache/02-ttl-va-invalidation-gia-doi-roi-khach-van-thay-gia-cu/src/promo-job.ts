// Job khuyến mãi theo lịch (đường ghi 3): VARIANT=truoc|sau pnpm promo-job. Mỗi PROMO_TICK_MS quét lịch và áp giá.
import { Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, num } from './shared/config';
import { createDb } from './shared/db';
import { isVariant } from './shared/pages';
import { runPromoTick as sauTick } from './sau/price-writers';
import { runPromoTick as truocTick } from './truoc/price-writers';

const variant = process.env.VARIANT ?? 'sau';
if (!isVariant(variant)) throw new Error(`VARIANT phải là truoc hoặc sau, nhận ${variant}`);
const tickMs = num('PROMO_TICK_MS', 1_000);
const tick = variant === 'sau' ? sauTick : truocTick;
const db = createDb(loadConfig().databaseUrl, { max: 1 });
const logger = new Logger(`promo.${variant}`);

let running = true;
const stop = () => (running = false);
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
console.log(`job khuyến mãi bản ${variant}: quét lịch mỗi ${tickMs} ms, pid ${process.pid}`);

while (running) {
  try {
    // Giờ của tiến trình job (cùng đồng hồ host với script đo), không phải now() của máy ảo Docker.
    const ids = await tick(db, new Date());
    if (ids.length) logger.log(`áp ${ids.length} khuyến mãi: ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ', …' : ''}`);
  } catch (err) {
    logger.error(`quét lịch khuyến mãi lỗi: ${(err as Error).message}`);
  }
  await sleep(tickMs);
}
await db.destroy();
