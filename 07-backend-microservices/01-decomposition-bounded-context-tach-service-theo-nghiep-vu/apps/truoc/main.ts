import { requiredEnv, startService } from '../../libs/platform/service-app';
import { CheckoutApiModule } from './checkout-api';
import { ENTITY_CONTROLLERS, EntityServiceModule, type EntityServiceName } from './entity-services';

// Một bundle cho 7 tiến trình của bản "trước"; SERVICE_NAME chọn tiến trình này là service nào.
const name = requiredEnv('SERVICE_NAME');

if (name === 'checkout-api') {
  startService(
    name,
    CheckoutApiModule.register({
      userUrl: requiredEnv('USER_URL'),
      productUrl: requiredEnv('PRODUCT_URL'),
      stockUrl: requiredEnv('STOCK_URL'),
      promotionUrl: requiredEnv('PROMOTION_URL'),
      paymentUrl: requiredEnv('PAYMENT_URL'),
      orderUrl: requiredEnv('ORDER_URL'),
    }),
  );
} else if (name in ENTITY_CONTROLLERS) {
  startService(name, EntityServiceModule.register(name as EntityServiceName, requiredEnv('DATABASE_URL')));
} else {
  throw new Error(`Không có service ${name}`);
}
