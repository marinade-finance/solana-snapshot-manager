import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ClientConfigurationInput,
  createPool,
  DatabasePool,
  Interceptor,
} from 'slonik';

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

type Checkout = { connected: boolean; expired: boolean; timeoutMs: number };
type Waiter = { grant: () => void };

const checkouts = new AsyncLocalStorage<Checkout>();

// Runs when slonik hands a connection to a pool call, before its query. A
// call whose caller already gave up must not run late, so refuse it here.
const checkoutDeadline: Interceptor = {
  name: 'checkout-deadline',
  afterPoolConnection: () => {
    const checkout = checkouts.getStore();
    if (checkout?.expired) {
      throw new PoolCheckoutTimeoutError(checkout.timeoutMs);
    }
    if (checkout) {
      checkout.connected = true;
    }
    return null;
  },
};

/**
 * slonik >= 49 queues checkouts without a deadline once every connection is
 * busy; slonik 33 (pg-pool) rejected them after `connectionTimeout`. Admit at
 * most `maxPoolSize` calls at a time so slonik rarely queues, and reject a
 * call that has no connection after `timeoutMs`. A rejected call never runs:
 * it leaves the gate's queue, or, if it already waits inside slonik (slonik
 * returns a connection to the pool only after the call that used it has
 * resolved), the interceptor refuses the connection it is eventually given.
 */
export const createCheckoutLimitedPool = async (
  connectionUri: string,
  configuration: ClientConfigurationInput & { maxPoolSize: number },
  timeoutMs: number,
): Promise<DatabasePool> => {
  const pool = await createPool(connectionUri, {
    ...configuration,
    interceptors: [checkoutDeadline, ...(configuration.interceptors ?? [])],
  });
  const maxPoolSize = configuration.maxPoolSize;
  let active = 0;
  const waiters: Waiter[] = [];

  const acquire = (waitMs: number): Promise<void> => {
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
      }, waitMs);
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
        const deadline = Date.now() + timeoutMs;
        await acquire(timeoutMs);
        const checkout: Checkout = {
          connected: false,
          expired: false,
          timeoutMs,
        };
        // the slot stays taken until slonik is done with the call, even
        // after its caller has been rejected
        const call = checkouts
          .run(checkout, () =>
            (value as (...a: unknown[]) => Promise<unknown>).apply(
              target,
              args,
            ),
          )
          .finally(release);
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => {
              if (!checkout.connected) {
                checkout.expired = true;
                reject(new PoolCheckoutTimeoutError(timeoutMs));
              }
            },
            Math.max(0, deadline - Date.now()),
          );
          call.then(
            (result) => {
              clearTimeout(timer);
              resolve(result);
            },
            (error: unknown) => {
              clearTimeout(timer);
              reject(error);
            },
          );
        });
      };
    },
  });
};
