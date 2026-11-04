import { FakeGateway } from './fake-gateway';

const gateway = new FakeGateway();
gateway.behavior.declineRate = Number(process.env.DECLINE_RATE ?? 0);
gateway.behavior.timeoutRate = Number(process.env.TIMEOUT_RATE ?? 0);

gateway
  .build()
  .listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
