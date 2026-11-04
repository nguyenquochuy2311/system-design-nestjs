import { requiredEnv, startService } from '../../libs/platform/service-app';
import { OrderServiceModule } from './order-service.module';

startService('order-service', OrderServiceModule.register(requiredEnv('DATABASE_URL')));
