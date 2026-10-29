import { DatabasePool } from 'slonik';

// Pool methods that check out a connection for their duration.
const CHECKOUT_METHODS = new Set<PropertyKey>([
  'any',
  'anyFirst',
  'connect',
  'exists',
  'many',
  'manyFirst',
  'maybeOne',
  'maybeOneFirst',
  'one',
  'oneFirst',
  'query',
  'record',
  'stream',
  'transaction',
]);

export class PoolCheckoutTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`No database connection became free within ${timeoutMs} ms`);
    this.name = 'PoolCheckoutTimeoutError';
  }
}

type Waiter = { grant: () => void };

/**
 * slonik >= 49 queues checkouts without a deadline once every connection is
 * busy; slonik 33 (pg-pool) rejected them after `connectionTimeout`. Admit at
 * most `maxPoolSize` calls at a time so slonik never queues, and reject a call
 * still waiting after `timeoutMs`. A rejected call is dropped from the queue,
 * so its query never runs later.
 */
export const withCheckoutTimeout = (
  pool: DatabasePool,
  maxPoolSize: number,
  timeoutMs: number,
): DatabasePool => {
  let active = 0;
  const waiters: Waiter[] = [];

  const acquire = (): Promise<void> => {
    if (active < maxPoolSize) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new PoolCheckoutTimeoutError(timeoutMs));
      }, timeoutMs);
      waiters.push(waiter);
    });
  };

  const release = (): void => {
    const next = waiters.shift();
    if (next) {
      // the slot passes straight to the next waiter
      next.grant();
    } else {
      active--;
    }
  };

  return new Proxy(pool, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (!CHECKOUT_METHODS.has(property) || typeof value !== 'function') {
        return value;
      }
      return async (...args: unknown[]): Promise<unknown> => {
        await acquire();
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(
            target,
            args,
          );
        } finally {
          release();
        }
      };
    },
  });
};
