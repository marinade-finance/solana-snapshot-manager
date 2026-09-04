import { DatabasePool, QuerySqlToken, createMockQueryResult } from 'slonik';
import { RdsService } from 'src/rds/rds.service';
import { SolanaService } from 'src/solana/solana.service';
import { SnapshotRecords, SnapshotService } from './snapshot.service';

const records: SnapshotRecords = {
  holders: [
    {
      holder: 'holder-1',
      amount: 1,
      sources: ['wallet'],
      amounts: [1],
      isVault: false,
    },
  ],
  veMNDEHolders: [{ holder: 'voter-1', amount: 2 }],
  nativeStakers: [{ withdraw_authority: 'staker-1', amount: 3 }],
};

const targetTable = (query: QuerySqlToken): string => {
  const [, table] = /INSERT INTO (\w+)/.exec(query.sql) ?? [];
  if (!table) {
    throw new Error(`unexpected statement: ${query.sql}`);
  }

  return table;
};

const serviceRecording = (events: string[], failOn?: string) => {
  const db = {
    one: async (query: QuerySqlToken) => {
      events.push(targetTable(query));
      return { snapshot_id: 7 };
    },
    query: async (query: QuerySqlToken) => {
      const table = targetTable(query);
      events.push(table);
      if (table === failOn) {
        throw new Error(`insert into ${table} failed`);
      }
      return createMockQueryResult([]);
    },
  };

  // exposes transaction only, so a write reaching for the pool instead of the handle throws
  const pool = {
    transaction: async <T>(handler: (handle: unknown) => Promise<T>) => {
      events.push('BEGIN');
      try {
        const result = await handler(db);
        events.push('COMMIT');
        return result;
      } catch (error) {
        events.push('ROLLBACK');
        throw error;
      }
    },
  };

  const solanaService = {
    getBlockTime: async () => {
      events.push('getBlockTime');
      return new Date('2026-09-04T00:00:00Z');
    },
  };

  return new SnapshotService(
    { pool: pool as unknown as DatabasePool } as RdsService,
    solanaService as unknown as SolanaService,
  );
};

describe('SnapshotService.storeSnapshot', () => {
  it('resolves the blocktime before opening the transaction', async () => {
    const events: string[] = [];

    await serviceRecording(events).storeSnapshot(443747021, records);

    expect(events.indexOf('getBlockTime')).toBeLessThan(
      events.indexOf('BEGIN'),
    );
  });

  it('writes the snapshot row and every child table in one transaction', async () => {
    const events: string[] = [];

    await serviceRecording(events).storeSnapshot(443747021, records);

    expect(events).toEqual([
      'getBlockTime',
      'BEGIN',
      'snapshots',
      'native_stake_accounts',
      'vemnde_holders',
      'msol_holders',
      'COMMIT',
    ]);
  });

  it('rolls back and propagates when a child insert fails', async () => {
    const events: string[] = [];

    await expect(
      serviceRecording(events, 'msol_holders').storeSnapshot(
        443747021,
        records,
      ),
    ).rejects.toThrow('insert into msol_holders failed');

    expect(events).toContain('ROLLBACK');
    expect(events).not.toContain('COMMIT');
  });
});
