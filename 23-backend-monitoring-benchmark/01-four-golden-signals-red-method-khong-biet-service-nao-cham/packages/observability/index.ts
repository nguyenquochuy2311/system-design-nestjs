// Gói dùng chung cho mọi service: một dòng initTelemetry() + hook Fastify + client HTTP + pool DB có đo.
export { initTelemetry, telemetryDisabled, type Telemetry } from './init-telemetry.js';
export { registerHttpServerMetrics, HTTP_DURATION_BUCKETS } from './http-server.js';
export { requestJson, type JsonResponse } from './http-client.js';
export { observePgPool, type PgPoolObserver } from './db-pool.js';
