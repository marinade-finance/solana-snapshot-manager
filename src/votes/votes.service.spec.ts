import { PublicKey } from '@solana/web3.js';
import { DatabasePool, QuerySqlToken, createMockQueryResult } from 'slonik';
import { RdsService } from 'src/rds/rds.service';
import { SolanaService } from 'src/solana/solana.service';
import { VotesService } from './votes.service';

const events: string[] = [];

jest.mock('@marinade.finance/directed-stake-sdk', () => ({
  DirectedStakeSdk: jest.fn(),
  findVoteRecords: async () => {
    events.push('findVoteRecords');
    return [
      {
        account: {
          owner: new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
          target: new PublicKey('11111111111111111111111111111111'),
        },
      },
    ];
  },
}));

const targetTable = (query: QuerySqlToken): string => {
  const [, table] = /INSERT INTO (\w+)/.exec(query.sql) ?? [];
  if (!table) {
    throw new Error(`unexpected statement: ${query.sql}`);
  }

  return table;
};

const serviceRecording = (failOn?: string) => {
  const db = {
    one: async (query: QuerySqlToken) => {
      events.push(targetTable(query));
      return { batch_id: 11 };
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

  return new VotesService(
    { connection: {} } as unknown as SolanaService,
    {
      pool: pool as unknown as DatabasePool,
    } as RdsService,
  );
};

describe('VotesService.storeVotes', () => {
  beforeEach(() => {
    events.length = 0;
  });

  it('fetches the vote records before opening the transaction', async () => {
    await serviceRecording().storeVotes();

    expect(events.indexOf('findVoteRecords')).toBeLessThan(
      events.indexOf('BEGIN'),
    );
  });

  it('writes the batch row and its votes in one transaction', async () => {
    await serviceRecording().storeVotes();

    expect(events).toEqual([
      'findVoteRecords',
      'BEGIN',
      'msol_votes_batches',
      'msol_votes',
      'COMMIT',
    ]);
  });

  it('rolls back and propagates when the vote insert fails', async () => {
    await expect(serviceRecording('msol_votes').storeVotes()).rejects.toThrow(
      'insert into msol_votes failed',
    );

    expect(events).toContain('ROLLBACK');
    expect(events).not.toContain('COMMIT');
  });
});
