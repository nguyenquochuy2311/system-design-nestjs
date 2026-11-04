import { startService } from '../shared/service-app';
import { PromotionModule } from './promotion.module';

startService('promotion', PromotionModule.register());
