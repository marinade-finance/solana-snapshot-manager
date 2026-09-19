import { DatabasePool, createPool, sql } from 'slonik';
import { RdsService, typeParsers } from 'src/rds/rds.service';
import { StakersService } from './stakers.service';

const postgresUrl = process.env.POSTGRES_TEST_URL;
if (process.env.CI && !postgresUrl) {
  throw new Error('POSTGRES_TEST_URL is required in CI');
}
const describeWithPostgres = postgresUrl ? describe : describe.skip;

const STAKER = 'BCuaq25akaBFKG73iC896zGBZDYTKx9UgLskwHFnb37q';

type SnapshotFixture = {
  slot: number;
  blocktime: string;
  createdAt: string;
  amount: number;
};

const SNAPSHOTS_TAKEN_IN_PRODUCTION: SnapshotFixture[] = [
  {
    slot: 443652525,
    blocktime: '2026-09-02T08:36:09Z',
    createdAt: '2026-09-02T17:17:24.724Z',
    amount: 0.351937378,
  },
  {
    slot: 443952803,
    blocktime: '2026-09-03T10:51:44Z',
    createdAt: '2026-09-03T15:03:50.880Z',
    amount: 0.351937378,
  },
  {
    slot: 444254105,
    blocktime: '2026-09-04T13:15:07Z',
    createdAt: '2026-09-04T19:54:20.135Z',
    amount: 0.352012657,
  },
  {
    slot: 444455191,
    blocktime: '2026-09-05T06:51:50Z',
    createdAt: '2026-09-05T16:13:15.520Z',
    amount: 0.35208824,
  },
];

const sortedSlots = (rows: { slot: number }[] | null | undefined): string[] =>
  (rows ?? []).map(({ slot }) => String(slot)).sort();

const seed = async (pool: DatabasePool, snapshots: SnapshotFixture[]) => {
  for (const { slot, blocktime, createdAt, amount } of snapshots) {
    const { snapshot_id: snapshotId } = await pool.one(sql.unsafe`
      INSERT INTO snapshots (slot, blocktime, created_at)
      VALUES (${slot}, ${blocktime}, ${createdAt})
      RETURNING snapshot_id`);
    await pool.query(sql.unsafe`
      INSERT INTO native_stake_accounts (snapshot_id, withdraw_authority, amount)
      VALUES (${snapshotId}, ${STAKER}, ${amount})`);
    await pool.query(sql.unsafe`
      INSERT INTO msol_holders (snapshot_id, owner, amount, sources, amounts)
      VALUES (${snapshotId}, ${STAKER}, ${amount}, ${sql.array(
        ['WALLET'],
        'text',
      )}, ${sql.array([amount], 'numeric')})`);
  }
};

describeWithPostgres('StakersService date interval', () => {
  let pool: DatabasePool;
  let service: StakersService;

  beforeAll(async () => {
    pool = await createPool(postgresUrl as string, { typeParsers });
    service = new StakersService({ pool } as RdsService);
  });

  beforeEach(async () => {
    await pool.query(sql.unsafe`
      TRUNCATE msol_holders, vemnde_holders, native_stake_accounts, snapshots
      RESTART IDENTITY CASCADE`);
    await seed(pool, SNAPSHOTS_TAKEN_IN_PRODUCTION);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('includes a native stake snapshot recorded later on the end date', async () => {
    const balances = await service.getNativeStakeBalances(
      STAKER,
      '2026-09-01',
      '2026-09-05',
    );

    expect(sortedSlots(balances)).toEqual([
      '443652525',
      '443952803',
      '444254105',
      '444455191',
    ]);
  });

  it('includes an all-stakes snapshot recorded later on the end date', async () => {
    const result = await service.getAllStakeBalances(
      STAKER,
      '2026-09-01',
      '2026-09-05',
    );

    expect(sortedSlots(result?.balances)).toEqual([
      '443652525',
      '443952803',
      '444254105',
      '444455191',
    ]);
  });

  it('includes an all-native-stakes snapshot recorded later on the end date', async () => {
    const result = await service.getAllNativeStakeBalances(
      '2026-09-01',
      '2026-09-05',
    );

    expect(sortedSlots(result?.[STAKER])).toEqual([
      '443652525',
      '443952803',
      '444254105',
      '444455191',
    ]);
  });

  it('stops at the end date and does not reach into the day after', async () => {
    const balances = await service.getNativeStakeBalances(
      STAKER,
      '2026-09-01',
      '2026-09-04',
    );

    expect(sortedSlots(balances)).not.toContain('444455191');
  });

  it('starts at the start date rather than the day before', async () => {
    const balances = await service.getNativeStakeBalances(
      STAKER,
      '2026-09-04',
      '2026-09-05',
    );

    expect(sortedSlots(balances)).toEqual(['444254105', '444455191']);
  });
});
