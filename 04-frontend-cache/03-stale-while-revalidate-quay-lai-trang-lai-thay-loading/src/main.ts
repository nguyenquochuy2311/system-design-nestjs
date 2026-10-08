import 'reflect-metadata';
import { createApp } from './app';
import { loadConfig } from './shared/config';

const config = loadConfig();
const app = await createApp(config);
app.enableShutdownHooks();
await app.listen(config.port, config.host);
console.log(`API ở http://${config.host}:${config.port} (độ trễ danh sách ${config.listLatencyMs} ms), pid ${process.pid}`);
