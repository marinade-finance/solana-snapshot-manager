import { DatabasePool, createPool, sql } from 'slonik';
import { RdsService } from 'src/rds/rds.service';
import { SolanaService } from 'src/solana/solana.service';
import { SnapshotRecords, SnapshotService } from './snapshot.service';

const postgresUrl = process.env.POSTGRES_TEST_URL;
const describeWithPostgres = postgresUrl ? describe : describe.skip;

const records: SnapshotRecords = {
  holders: [
    {
      holder: 'holder-1',
      amount: 6500000.123456789,
      sources: ['WALLET'],
      amounts: [6500000.123456789],
      isVault: false,
    },
  ],
  veMNDEHolders: [{ holder: 'voter-1', amount: 2 }],
  nativeStakers: [{ withdraw_authority: 'staker-1', amount: 3 }],
};

const mSolTotals = {
  mSolParsedAmount: '6500000.123456789',
  mSolSupply: '6500123.987654321',
};

describeWithPostgres('SnapshotService.storeSnapshot mSOL totals', () => {
  let pool: DatabasePool;
  let service: SnapshotService;

  const totalsOf = async (snapshotId: number) =>
    await pool.one(sql.unsafe`
      SELECT msol_parsed_amount::text, msol_supply::text
      FROM snapshots
      WHERE snapshot_id = ${snapshotId}`);

  beforeAll(async () => {
    pool = await createPool(postgresUrl as string);
    service = new SnapshotService(
      { pool } as RdsService,
      {
        getBlockTime: async () => new Date('2026-09-04T00:00:00Z'),
      } as unknown as SolanaService,
    );
  });

  beforeEach(async () => {
    await pool.query(sql.unsafe`
      TRUNCATE msol_holders, vemnde_holders, native_stake_accounts, snapshots
      RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('persists the parsed total and the mint supply on the snapshot row', async () => {
    const snapshotId = await service.storeSnapshot(
      443747021,
      records,
      mSolTotals,
    );

    await expect(totalsOf(snapshotId)).resolves.toEqual({
      msol_parsed_amount: mSolTotals.mSolParsedAmount,
      msol_supply: mSolTotals.mSolSupply,
    });
  });

  it('leaves both figures unset on a snapshot written without them', async () => {
    const { snapshot_id: snapshotId } = await pool.one(sql.unsafe`
      INSERT INTO snapshots (slot) VALUES (443747021) RETURNING snapshot_id`);

    await expect(totalsOf(snapshotId as number)).resolves.toEqual({
      msol_parsed_amount: null,
      msol_supply: null,
    });
  });
});
