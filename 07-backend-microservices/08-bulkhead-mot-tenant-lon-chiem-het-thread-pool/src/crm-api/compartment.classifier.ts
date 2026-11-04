import type { Compartment } from './tenant-bulkhead';

/** Gắn request vào khoang theo route. Route không có ở đây thì không chiếm chỗ của khoang nào. */
export function compartmentOf(method: string, path: string): Compartment | undefined {
  if (path.startsWith('/reports')) {
    return 'report';
  }
  if (path.startsWith('/notes') || (method === 'POST' && path.startsWith('/exports'))) {
    return 'interactive';
  }
  return undefined;
}
