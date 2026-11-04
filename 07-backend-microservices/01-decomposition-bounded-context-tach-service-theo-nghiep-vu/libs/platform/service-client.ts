import { ServiceUnavailableException } from '@nestjs/common';
import { logEvent } from './log';
import { requestContext } from './request-context';

const CALL_TIMEOUT_MS = 2_000;

export interface ServiceReply<T> {
  status: number;
  body: T;
}

/** Mọi lời gọi giữa các service đi qua đây: mang correlation id theo và ghi một dòng log `outbound` để đếm. */
export async function callService<T>(
  target: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<ServiceReply<T>> {
  const context = requestContext.getStore();
  const startedAt = performance.now();
  let status = 0;
  try {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-correlation-id': context?.correlationId ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    status = response.status;
    return { status, body: (await response.json()) as T };
  } catch (cause) {
    throw new ServiceUnavailableException(`Không gọi được ${target}`, { cause });
  } finally {
    logEvent({
      service: context?.service ?? 'unknown',
      correlationId: context?.correlationId,
      event: 'outbound',
      target,
      method,
      status,
      ms: Math.round(performance.now() - startedAt),
    });
  }
}
