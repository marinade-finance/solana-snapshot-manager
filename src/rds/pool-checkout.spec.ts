import { createPool, DatabasePool, sql } from 'slonik';
import {
  createCheckoutLimitedPool,
  PoolCheckoutTimeoutError,
} from './pool-checkout';

const postgresUrl = process.env.POSTGRES_TEST_URL;
const describeWithPostgres = postgresUrl ? describe : describe.skip;

const timeoutMs = 300;

describeWithPostgres('createCheckoutLimitedPool', () => {
  let admin: DatabasePool;
  const pools: DatabasePool[] = [];

  const limitedPool = async (
    maxPoolSize: number,
    resetConnection?: () => Promise<void>,
  ) => {
    const pool = await createCheckoutLimitedPool(
      postgresUrl as string,
      { maxPoolSize, ...(resetConnection ? { resetConnection } : {}) },
      timeoutMs,
    );
    pools.push(pool);
    return pool;
  };
  const busy = (pool: DatabasePool, seconds: number) =>
    pool.query(sql.unsafe`SELECT pg_sleep(${seconds})`);
  const probeRows = async () =>
    await admin.oneFirst(
      sql.unsafe`SELECT count(*)::int FROM pool_checkout_probe`,
    );
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  beforeAll(async () => {
    admin = await createPool(postgresUrl as string);
    await admin.query(
      sql.unsafe`CREATE TABLE IF NOT EXISTS pool_checkout_probe (id int)`,
    );
  });

  beforeEach(async () => {
    await admin.query(sql.unsafe`TRUNCATE pool_checkout_probe`);
  });

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  afterAll(async () => {
    await admin?.query(sql.unsafe`DROP TABLE IF EXISTS pool_checkout_probe`);
    await admin?.end();
  });

  it('a bare slonik pool queues past the deadline', async () => {
    const pool = await createPool(postgresUrl as string, { maxPoolSize: 1 });
    pools.push(pool);
    const holder = busy(pool, 1);
    const started = Date.now();
    await pool.query(sql.unsafe`SELECT 1`);
    expect(Date.now() - started).toBeGreaterThan(timeoutMs * 2);
    await holder;
  });

  it('rejects at the deadline and the timed-out insert never lands', async () => {
    const pool = await limitedPool(2);
    const holders = [busy(pool, 1.5), busy(pool, 1.5)];

    const started = Date.now();
    await expect(
      pool.query(sql.unsafe`INSERT INTO pool_checkout_probe VALUES (1)`),
    ).rejects.toBeInstanceOf(PoolCheckoutTimeoutError);
    expect(Date.now() - started).toBeLessThan(1_000);

    await Promise.all(holders);
    expect(await probeRows()).toBe(0);
    await pool.query(sql.unsafe`INSERT INTO pool_checkout_probe VALUES (2)`);
    expect(await probeRows()).toBe(1);
  });

  it('times out a call queued inside slonik while a connection is released', async () => {
    const pool = await limitedPool(1, () => sleep(1_000));
    await pool.query(sql.unsafe`SELECT 1`);

    const started = Date.now();
    await expect(
      pool.query(sql.unsafe`INSERT INTO pool_checkout_probe VALUES (1)`),
    ).rejects.toBeInstanceOf(PoolCheckoutTimeoutError);
    expect(Date.now() - started).toBeLessThan(800);

    await sleep(1_500);
    expect(await probeRows()).toBe(0);
  });

  it('times out a call that waited in the gate and then inside slonik', async () => {
    const pool = await limitedPool(1, () => sleep(1_000));
    const holder = busy(pool, 0.2);

    const started = Date.now();
    await expect(
      pool.query(sql.unsafe`INSERT INTO pool_checkout_probe VALUES (1)`),
    ).rejects.toBeInstanceOf(PoolCheckoutTimeoutError);
    expect(Date.now() - started).toBeLessThan(800);

    await holder;
    await sleep(1_500);
    expect(await probeRows()).toBe(0);
  });

  it('runs every call queued in the gate once a slot frees', async () => {
    const pool = await limitedPool(2);
    const running = await Promise.all(
      Array.from({ length: 6 }, () =>
        pool.oneFirst(
          sql.unsafe`SELECT count(*)::int FROM pg_stat_activity, pg_sleep(0.05)
            WHERE query LIKE '%pool_gate_probe%' AND state = 'active'`,
        ),
      ),
    );
    expect(Math.max(...running.map(Number))).toBeLessThanOrEqual(2);
    await expect(pool.oneFirst(sql.unsafe`SELECT 1`)).resolves.toBe(1);
  });

  it('gates a transaction like any call and frees its slot on rollback', async () => {
    const pool = await limitedPool(1);
    const committed = pool.transaction(async (tx) => {
      await tx.query(sql.unsafe`INSERT INTO pool_checkout_probe VALUES (1)`);
      await tx.query(sql.unsafe`SELECT pg_sleep(0.1)`);
      await tx.query(sql.unsafe`INSERT INTO pool_checkout_probe VALUES (2)`);
    });
    const queued = pool.oneFirst(
      sql.unsafe`SELECT count(*)::int FROM pool_checkout_probe`,
    );
    await committed;
    expect(await queued).toBe(2);

    const holder = busy(pool, 0.6);
    await expect(
      pool.transaction(async (tx) => {
        await tx.query(sql.unsafe`INSERT INTO pool_checkout_probe VALUES (9)`);
      }),
    ).rejects.toBeInstanceOf(PoolCheckoutTimeoutError);
    await holder;

    await expect(
      pool.transaction(async (tx) => {
        await tx.query(sql.unsafe`INSERT INTO pool_checkout_probe VALUES (3)`);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(
      await pool.oneFirst(
        sql.unsafe`SELECT count(*)::int FROM pool_checkout_probe`,
      ),
    ).toBe(2);
  });

  it('lets a call that got its connection in time run past the deadline', async () => {
    const pool = await limitedPool(1);
    await expect(busy(pool, (timeoutMs * 2) / 1_000)).resolves.toBeDefined();
  });

  it('frees the slot when the query fails', async () => {
    const pool = await limitedPool(1);
    await expect(pool.query(sql.unsafe`SELECT 1/0`)).rejects.toThrow();
    await expect(pool.oneFirst(sql.unsafe`SELECT 1`)).resolves.toBe(1);
  });
});
