import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { createApp } from './app';
import { loadConfig } from './shared/config';

const config = loadConfig();
const app = await createApp(config);
app.enableShutdownHooks();
await app.listen(config.port, config.host);
const port = (app.getHttpServer().address() as AddressInfo).port;
console.log(`API (${config.mode}) ở http://${config.host}:${port}: /api/products, /media/:id/:size, /api/cart..., pid ${process.pid}`);
