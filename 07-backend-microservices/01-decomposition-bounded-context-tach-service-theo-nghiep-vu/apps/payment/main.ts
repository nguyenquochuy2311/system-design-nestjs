import { requiredEnv, startService } from '../../libs/platform/service-app';
import { PaymentModule } from './payment.module';

startService('payment', PaymentModule.register(requiredEnv('DATABASE_URL')));
