import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ClientConfigurationInput,
  createPool,
  DatabasePool,
  Interceptor,
} from 'slonik';

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

type Checkout = {
  connected: boolean;
  expired: boolean;
  deadline: number;
  timeoutMs: number;
};
type Waiter = { grant: () => void };

const checkouts = new AsyncLocalStorage<Checkout>();

// refuses a connection handed to a call whose caller already timed out
const checkoutDeadline: Interceptor = {
  name: 'checkout-deadline',
  afterPoolConnection: () => {
    const checkout = checkouts.getStore();
    if (checkout && (checkout.expired || Date.now() >= checkout.deadline)) {
      throw new PoolCheckoutTimeoutError(checkout.timeoutMs);
    }
    if (checkout) {
      checkout.connected = true;
    }
    return null;
  },
};

// slonik 49 queues checkouts without a deadline; cap concurrent calls and fail
// a call with no connection after timeoutMs, so it never runs late
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
        if (Date.now() >= deadline) {
          release();
          throw new PoolCheckoutTimeoutError(timeoutMs);
        }
        const checkout: Checkout = {
          connected: false,
          expired: false,
          deadline,
          timeoutMs,
        };
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
