import { buildOrder } from './server';

const app = buildOrder({
  pricingTargets: (process.env.PRICING_TARGETS ?? 'http://127.0.0.1:3001').split(','),
  maxConnectionAgeMs: Number(process.env.CONNECTION_MAX_AGE_MS ?? 0),
  retries: Number(process.env.PRICING_RETRIES ?? 0),
  legacyUrl: process.env.LEGACY_URL,
  headlessName: process.env.HEADLESS_NAME,
});

process.on('SIGTERM', () => {
  void app.close().then(() => process.exit(0));
});

app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' }).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
