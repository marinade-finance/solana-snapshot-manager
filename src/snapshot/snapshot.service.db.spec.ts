import { DatabasePool, createPool, sql } from 'slonik';
import { RdsService, typeParsers } from 'src/rds/rds.service';
import { SolanaService } from 'src/solana/solana.service';
import { SnapshotService } from './snapshot.service';

const postgresUrl = process.env.POSTGRES_TEST_URL;
if (process.env.CI && !postgresUrl) {
  throw new Error('POSTGRES_TEST_URL is required in CI');
}
const describeWithPostgres = postgresUrl ? describe : describe.skip;

type SnapshotFixture = {
  slot: number;
  blocktime: string;
  holders: [owner: string, amount: number][];
};

const SNAPSHOTS_AROUND_THE_OUTAGE: SnapshotFixture[] = [
  {
    slot: 442351854,
    blocktime: '2026-08-28T13:45:59Z',
    holders: [
      ['whale', 100],
      ['other', 5],
    ],
  },
  {
    slot: 442552086,
    blocktime: '2026-08-29T07:40:29Z',
    holders: [
      ['whale', 100],
      ['other', 5],
    ],
  },
  {
    slot: 443652525,
    blocktime: '2026-09-02T08:36:09Z',
    holders: [['other', 5]],
  },
  { slot: 443952803, blocktime: '2026-09-03T10:51:44Z', holders: [] },
  {
    slot: 444254105,
    blocktime: '2026-09-04T13:15:07Z',
    holders: [
      ['whale', 42],
      ['other', 5],
      ['newcomer', 7],
    ],
  },
];

const SNAPSHOT_BEFORE_THE_WINDOW: SnapshotFixture[] = [
  {
    slot: 438000001,
    blocktime: '2026-08-10T09:00:00Z',
    holders: [['departed', 13]],
  },
];

const seed = async (pool: DatabasePool, snapshots: SnapshotFixture[]) => {
  for (const { slot, blocktime, holders } of snapshots) {
    const { snapshot_id: snapshotId } = await pool.one(sql.unsafe`
      INSERT INTO snapshots (slot, blocktime)
      VALUES (${slot}, ${blocktime})
      RETURNING snapshot_id`);
    for (const [owner, amount] of holders) {
      await pool.query(sql.unsafe`
        INSERT INTO msol_holders (snapshot_id, owner, amount, sources, amounts)
        VALUES (${snapshotId}, ${owner}, ${amount}, ${sql.array(
          ['WALLET'],
          'text',
        )}, ${sql.array([amount], 'numeric')})`);
    }
  }
};

const rewriteRowSoItIsScannedLast = async (
  pool: DatabasePool,
  slot: number,
) => {
  await pool.query(
    sql.unsafe`UPDATE snapshots SET slot = slot WHERE slot = ${slot}`,
  );
};

describeWithPostgres('SnapshotService balance history', () => {
  let pool: DatabasePool;
  let service: SnapshotService;

  const historyOf = async (
    owner: string,
  ): Promise<[blocktime: string, slot: string, amount: string][]> => {
    const history = await service.getMsolBalanceHistory(
      owner,
      '2026-08-26',
      '2026-09-05',
    );
    return history.map(({ snapshotCreatedAt, slot, amount }) => [
      new Date(snapshotCreatedAt).toISOString(),
      String(slot),
      amount,
    ]);
  };

  beforeAll(async () => {
    pool = await createPool(postgresUrl as string, { typeParsers });
    service = new SnapshotService(
      { pool } as RdsService,
      {} as unknown as SolanaService,
    );
  });

  beforeEach(async () => {
    await pool.query(sql.unsafe`
      TRUNCATE msol_holders, vemnde_holders, native_stake_accounts, snapshots
      RESTART IDENTITY CASCADE`);
    await seed(pool, SNAPSHOTS_AROUND_THE_OUTAGE);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('reports zero for a snapshot that recorded no balance for the holder', async () => {
    await expect(historyOf('whale')).resolves.toEqual([
      ['2026-08-28T13:45:59.000Z', '442351854', '100'],
      ['2026-08-29T07:40:29.000Z', '442552086', '100'],
      ['2026-09-02T08:36:09.000Z', '443652525', '0'],
      ['2026-09-04T13:15:07.000Z', '444254105', '42'],
    ]);
  });

  it('emits nothing for the days the pipeline produced no snapshot', async () => {
    const days = (await historyOf('whale')).map(([blocktime]) =>
      blocktime.slice(0, 10),
    );

    expect(days).not.toContain('2026-08-30');
    expect(days).not.toContain('2026-08-31');
    expect(days).not.toContain('2026-09-01');
  });

  it('skips a snapshot that recorded no mSOL holders at all', async () => {
    const slots = (await historyOf('whale')).map(([, slot]) => slot);

    expect(slots).not.toContain('443952803');
  });

  it('starts at the first snapshot recording the holder', async () => {
    await expect(historyOf('newcomer')).resolves.toEqual([
      ['2026-09-04T13:15:07.000Z', '444254105', '7'],
    ]);
  });

  it('returns nothing for a holder absent from every snapshot', async () => {
    await expect(historyOf('stranger')).resolves.toEqual([]);
  });

  it('reports zeros across a window the holder left before', async () => {
    await seed(pool, SNAPSHOT_BEFORE_THE_WINDOW);

    await expect(historyOf('departed')).resolves.toEqual([
      ['2026-08-28T13:45:59.000Z', '442351854', '0'],
      ['2026-08-29T07:40:29.000Z', '442552086', '0'],
      ['2026-09-02T08:36:09.000Z', '443652525', '0'],
      ['2026-09-04T13:15:07.000Z', '444254105', '0'],
    ]);
  });

  it('returns nothing for a never-holder even with pre-window history', async () => {
    await seed(pool, SNAPSHOT_BEFORE_THE_WINDOW);

    await expect(historyOf('stranger')).resolves.toEqual([]);
  });

  it('includes snapshots taken later on the end date', async () => {
    const lateOnTheEndDate = await service.getMsolBalanceHistory(
      'whale',
      '2026-08-26',
      '2026-09-04',
    );

    expect(lateOnTheEndDate.map(({ slot }) => String(slot))).toContain(
      '444254105',
    );
  });

  it('defaults the window to one month before the end date', async () => {
    await seed(pool, [
      {
        slot: 439000001,
        blocktime: '2026-08-04T12:00:00Z',
        holders: [['whale', 11]],
      },
    ]);

    const defaultWindow = await service.getMsolBalanceHistory(
      'whale',
      undefined,
      '2026-09-04',
    );

    expect(defaultWindow.map(({ slot }) => String(slot))).toContain(
      '439000001',
    );
  });

  it('includes veMNDE snapshots taken later on the end date', async () => {
    const { snapshot_id: snapshotId } = await pool.one(sql.unsafe`
      INSERT INTO snapshots (slot, blocktime)
      VALUES (446000005, '2026-09-04T22:00:00Z')
      RETURNING snapshot_id`);
    await pool.query(sql.unsafe`
      INSERT INTO vemnde_holders (snapshot_id, owner, amount)
      VALUES (${snapshotId}, 'voter', 3)`);

    const history = await service.getVeMNDEBalanceHistory(
      'voter',
      '2026-08-26',
      '2026-09-04',
    );

    expect(history.map(({ slot }) => String(slot))).toEqual(['446000005']);
  });

  it('starts at the right snapshot when two share a blocktime', async () => {
    await seed(pool, [
      {
        slot: 446000001,
        blocktime: '2026-09-04T20:00:00Z',
        holders: [['other', 5]],
      },
      {
        slot: 446000002,
        blocktime: '2026-09-04T20:00:00Z',
        holders: [
          ['twin', 42],
          ['other', 5],
        ],
      },
    ]);

    await expect(historyOf('twin')).resolves.toEqual([
      ['2026-09-04T20:00:00.000Z', '446000002', '42'],
    ]);
  });

  it('orders snapshots sharing a blocktime by the order they were recorded', async () => {
    await seed(pool, [
      {
        slot: 446000003,
        blocktime: '2026-09-04T20:00:00Z',
        holders: [['twin', 1]],
      },
      {
        slot: 446000004,
        blocktime: '2026-09-04T20:00:00Z',
        holders: [['twin', 2]],
      },
    ]);
    await rewriteRowSoItIsScannedLast(pool, 446000003);

    await expect(historyOf('twin')).resolves.toEqual([
      ['2026-09-04T20:00:00.000Z', '446000003', '1'],
      ['2026-09-04T20:00:00.000Z', '446000004', '2'],
    ]);
  });
});
