import { requiredEnv, startService } from '../shared/service-app';
import { CheckoutModule } from './checkout.module';

startService(
  'checkout',
  CheckoutModule.register({
    mode: process.env.CHECKOUT_MODE === 'truoc' ? 'truoc' : 'sau',
    promotionUrl: requiredEnv('PROMOTION_URL'),
    poolSize: Number(process.env.PROMOTION_POOL_SIZE ?? 50),
  }),
);
