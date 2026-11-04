import { requiredEnv, startService } from '../../libs/platform/service-app';
import { OrderingModule } from './ordering.module';

startService(
  'ordering',
  OrderingModule.register({
    databaseUrl: requiredEnv('DATABASE_URL'),
    inventoryUrl: requiredEnv('INVENTORY_URL'),
    paymentUrl: requiredEnv('PAYMENT_URL'),
    catalogEventPollMs: Number(process.env.CATALOG_EVENT_POLL_MS ?? 200),
  }),
);
