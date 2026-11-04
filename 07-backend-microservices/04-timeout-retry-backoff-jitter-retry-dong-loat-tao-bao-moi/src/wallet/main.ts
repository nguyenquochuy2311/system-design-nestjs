import { requiredEnv, startService } from '../shared/service-app';
import { WalletModule } from './wallet.module';

startService(
  'wallet',
  WalletModule.register({
    mode: process.env.WALLET_MODE === 'truoc' ? 'truoc' : 'sau',
    bankUrl: requiredEnv('BANK_URL'),
  }),
);
