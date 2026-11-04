import { requiredEnv, startService } from '../../libs/platform/service-app';
import { TruocModule } from './truoc.module';

const name = requiredEnv('SERVICE_NAME');

if (name === 'truoc-order') {
  startService(
    name,
    TruocModule.order(requiredEnv('DATABASE_URL'), {
      inventoryUrl: requiredEnv('INVENTORY_URL'),
      paymentUrl: requiredEnv('PAYMENT_URL'),
    }),
  );
} else if (name === 'truoc-inventory') {
  startService(name, TruocModule.inventory(requiredEnv('DATABASE_URL')));
} else if (name === 'truoc-payment') {
  startService(name, TruocModule.payment(requiredEnv('GATEWAY_URL'), Number(process.env.GATEWAY_TIMEOUT_MS ?? 1_000)));
} else {
  throw new Error(`Không có service ${name}`);
}
