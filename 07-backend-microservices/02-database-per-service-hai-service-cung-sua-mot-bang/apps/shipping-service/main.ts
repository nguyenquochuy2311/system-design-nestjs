import { requiredEnv, startService } from '../../libs/platform/service-app';
import { ShippingServiceModule } from './shipping-service.module';

startService(
  'shipping-service',
  ShippingServiceModule.register({
    databaseUrl: requiredEnv('DATABASE_URL'),
    addressModel: process.env.SHIPPING_ADDRESS_MODEL === 'split' ? 'split' : 'single',
    pollMs: Number(process.env.ORDER_EVENT_POLL_MS ?? 100),
  }),
);
