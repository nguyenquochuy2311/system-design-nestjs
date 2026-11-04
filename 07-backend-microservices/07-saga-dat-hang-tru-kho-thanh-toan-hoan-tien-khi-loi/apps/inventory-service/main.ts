import { requiredEnv, startService } from '../../libs/platform/service-app';
import { InventoryServiceModule } from './inventory-service.module';

startService('inventory-service', InventoryServiceModule.register(requiredEnv('DATABASE_URL'), 50));
