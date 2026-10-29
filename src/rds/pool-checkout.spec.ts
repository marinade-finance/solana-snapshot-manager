import { createPool, DatabasePool, sql } from 'slonik';
import { PoolCheckoutTimeoutError, withCheckoutTimeout } from './pool-checkout';

const postgresUrl = process.env.POSTGRES_TEST_URL;
const describeWithPostgres = postgresUrl ? describe : describe.skip;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

const fakePool = () => {
  const calls: string[] = [];
  const pool = {
    state: () => 'ACTIVE',
    query: jest.fn(async (label: string, hold?: Promise<void>) => {
      calls.push(label);
      await hold;
      return label;
    }),
    transaction: jest.fn(async (routine: () => Promise<unknown>) => routine()),
  };
  return { pool: pool as unknown as DatabasePool, raw: pool, calls };
};

describe('withCheckoutTimeout', () => {
  it('admits up to maxPoolSize calls at once', async () => {
    const { pool, calls } = fakePool();
    const gated = withCheckoutTimeout(pool, 2, 1_000);
    const hold = deferred();

    const a = gated.query('a' as never, hold.promise as never);
    const b = gated.query('b' as never, hold.promise as never);
    const c = gated.query('c' as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual(['a', 'b']);

    hold.resolve();
    await expect(Promise.all([a, b, c])).resolves.toEqual(['a', 'b', 'c']);
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('rejects a call still waiting after the timeout and never runs it', async () => {
    const { pool, calls } = fakePool();
    const gated = withCheckoutTimeout(pool, 1, 50);
    const hold = deferred();

    const a = gated.query('a' as never, hold.promise as never);
    const started = Date.now();
    await expect(gated.query('late' as never)).rejects.toBeInstanceOf(
      PoolCheckoutTimeoutError,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);

    hold.resolve();
    await a;
    await expect(gated.query('next' as never)).resolves.toBe('next');
    expect(calls).toEqual(['a', 'next']);
  });

  it('frees the slot when the call throws', async () => {
    const { pool, raw } = fakePool();
    const gated = withCheckoutTimeout(pool, 1, 50);
    raw.query.mockRejectedValueOnce(new Error('boom'));

    await expect(gated.query('a' as never)).rejects.toThrow('boom');
    await expect(gated.query('b' as never)).resolves.toBe('b');
  });

  it('passes other members through untouched', () => {
    const { pool } = fakePool();
    const gated = withCheckoutTimeout(pool, 1, 50);

    expect(gated.state()).toBe('ACTIVE');
  });
});

describeWithPostgres('withCheckoutTimeout on a real pool', () => {
  const holdSeconds = 1.5;
  const timeoutMs = 300;
  let pool: DatabasePool;

  const busy = (p: DatabasePool) =>
    p.query(sql.unsafe`SELECT pg_sleep(${holdSeconds})`);
  const probeRows = async () =>
    await pool.oneFirst(
      sql.unsafe`SELECT count(*)::int FROM pool_checkout_probe`,
    );

  beforeAll(async () => {
    pool = await createPool(postgresUrl as string, { maxPoolSize: 2 });
    await pool.query(
      sql.unsafe`CREATE TABLE IF NOT EXISTS pool_checkout_probe (id int)`,
    );
    await pool.query(sql.unsafe`TRUNCATE pool_checkout_probe`);
  });

  afterAll(async () => {
    await pool?.query(sql.unsafe`DROP TABLE IF EXISTS pool_checkout_probe`);
    await pool?.end();
  });

  it('a bare slonik pool queues past the deadline', async () => {
    const holders = [busy(pool), busy(pool)];
    const started = Date.now();
    await pool.query(sql.unsafe`SELECT 1`);
    expect(Date.now() - started).toBeGreaterThan(timeoutMs * 3);
    await Promise.all(holders);
  });

  it('rejects at the deadline and the timed-out insert never lands', async () => {
    const gated = withCheckoutTimeout(pool, 2, timeoutMs);
    const holders = [busy(gated), busy(gated)];

    const started = Date.now();
    await expect(
      gated.query(sql.unsafe`INSERT INTO pool_checkout_probe VALUES (1)`),
    ).rejects.toBeInstanceOf(PoolCheckoutTimeoutError);
    expect(Date.now() - started).toBeLessThan(holdSeconds * 1_000);

    await Promise.all(holders);
    expect(await probeRows()).toBe(0);
    await gated.query(sql.unsafe`INSERT INTO pool_checkout_probe VALUES (2)`);
    expect(await probeRows()).toBe(1);
  });
});
