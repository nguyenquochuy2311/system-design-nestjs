import { FakeBank } from './fake-bank';

const bank = new FakeBank();
bank.behavior.capacityRps = Number(process.env.BANK_CAPACITY_RPS ?? bank.behavior.capacityRps);

bank
  .build()
  .listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
