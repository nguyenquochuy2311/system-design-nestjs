import { requiredEnv, startService } from '../../libs/platform/service-app';
import { BffModule } from './bff.module';

startService(
  'bff',
  BffModule.register({
    orderUrl: requiredEnv('ORDER_URL'),
    paymentUrl: requiredEnv('PAYMENT_URL'),
    shippingUrl: requiredEnv('SHIPPING_URL'),
    customerUrl: requiredEnv('CUSTOMER_URL'),
  }),
);
