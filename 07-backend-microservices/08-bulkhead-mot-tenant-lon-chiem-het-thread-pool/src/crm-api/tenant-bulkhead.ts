import { logEvent } from '../shared/log';

export type Compartment = 'interactive' | 'report';

export interface CompartmentLimits {
  /** Số request của một tenant được chạy cùng lúc trong khoang. */
  perTenant: number;
  /** Số request của một tenant được xếp hàng. Hàng chờ phải có giới hạn, nếu không khoang không bao giờ "đầy". */
  queue: number;
  /** Thời gian chờ tối đa trong hàng. */
  maxWaitMs: number;
}

export interface Lease {
  waitedMs: number;
  release(): void;
}

export class BulkheadFullError extends Error {
  constructor(
    readonly compartment: Compartment,
    readonly tenantId: string,
  ) {
    super(`Khoang ${compartment} của ${tenantId} đã đầy`);
  }
}

interface Waiter {
  grant: () => void;
  timer: NodeJS.Timeout;
}

interface Slot {
  active: number;
  waiting: Waiter[];
}

/**
 * [PATTERN] Semaphore theo cặp (khoang, tenant): một tenant đầy khoang không lấy chỗ của tenant khác.
 * Tự viết vì bulkhead của cockatiel chỉ kiểm hết hạn lúc lấy việc ra khỏi hàng, nên request hết hạn vẫn nằm chờ tới khi có chỗ.
 */
export class TenantBulkhead {
  private readonly slots = new Map<string, Slot>();

  constructor(private readonly limits: Record<Compartment, CompartmentLimits>) {}

  acquire(compartment: Compartment, tenantId: string): Promise<Lease> {
    const key = `${compartment}:${tenantId}`;
    const slot = this.slots.get(key) ?? { active: 0, waiting: [] };
    this.slots.set(key, slot);
    const limits = this.limits[compartment];
    const startedAt = performance.now();
    const lease = (): Lease => {
      let released = false;
      return {
        waitedMs: performance.now() - startedAt,
        release: () => {
          // Trả chỗ đúng một lần, kể cả khi handler lỗi và finalize chạy cùng lúc đóng kết nối.
          if (!released) {
            released = true;
            this.release(key, slot);
          }
        },
      };
    };

    if (slot.active < limits.perTenant) {
      slot.active += 1;
      return Promise.resolve(lease());
    }
    if (slot.waiting.length >= limits.queue) {
      logEvent({ service: 'crm-api', event: 'bulkhead_rejected', compartment, tenantId });
      return Promise.reject(new BulkheadFullError(compartment, tenantId));
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(waiter.timer);
          resolve(lease());
        },
        timer: setTimeout(() => {
          slot.waiting.splice(slot.waiting.indexOf(waiter), 1);
          reject(new BulkheadFullError(compartment, tenantId));
        }, limits.maxWaitMs),
      };
      slot.waiting.push(waiter);
    });
  }

  private release(key: string, slot: Slot): void {
    const next = slot.waiting.shift();
    if (next) {
      next.grant();
      return;
    }
    slot.active -= 1;
    if (slot.active === 0) {
      this.slots.delete(key);
    }
  }

  /** Số chỗ đang dùng, để test khẳng định không rò rỉ. */
  inUse(compartment: Compartment, tenantId: string): number {
    return this.slots.get(`${compartment}:${tenantId}`)?.active ?? 0;
  }
}
