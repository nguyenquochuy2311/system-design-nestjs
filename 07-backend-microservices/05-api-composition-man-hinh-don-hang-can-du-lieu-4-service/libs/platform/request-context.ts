import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  service: string;
  correlationId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
