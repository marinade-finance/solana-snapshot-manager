import { ParseCommand } from './parse.cmd';
import { MSolTotals, ParserService } from 'src/snapshot/parser/parser.service';
import {
  SnapshotRecords,
  SnapshotService,
} from 'src/snapshot/snapshot.service';

type StoredSnapshot = {
  slot: number;
  records: SnapshotRecords;
  mSolTotals: MSolTotals;
};

const options = {
  slot: 443747021,
  sqlite: 'snapshot.sqlite',
  psqlOutput: true,
  minSupplyRatio: 0.99,
};

const parserReporting = (
  holders: [pubkey: string, amount: string][],
  totals: MSolTotals,
) =>
  ({
    parse: async function* () {
      for (const [pubkey, amount] of holders) {
        yield { pubkey, amount, source: 'WALLET', isVault: false };
      }
      return totals;
    },
    parseVeMNDE: async function* () {},
    parseNativeStakes: async function* () {},
  }) as unknown as ParserService;

const snapshotServiceRecording = (stored: StoredSnapshot[]) =>
  ({
    storeSnapshot: async (
      slot: number,
      records: SnapshotRecords,
      mSolTotals: MSolTotals,
    ) => {
      stored.push({ slot, records, mSolTotals });
      return 7;
    },
  }) as unknown as SnapshotService;

describe('ParseCommand', () => {
  it('stores nothing when the parse misses part of the mSOL supply', async () => {
    const stored: StoredSnapshot[] = [];
    const command = new ParseCommand(
      parserReporting([['holder-1', '900.0']], {
        mSolParsedAmount: '900.0',
        mSolSupply: '1000.0',
      }),
      snapshotServiceRecording(stored),
    );

    await expect(command.run([], options)).rejects.toThrow(
      'refusing to store an incomplete snapshot',
    );
    expect(stored).toEqual([]);
  });

  it('stores the figures the parser reported, not the sum of the stored holders', async () => {
    const stored: StoredSnapshot[] = [];
    const totals = {
      mSolParsedAmount: '995.0',
      mSolSupply: '1000.0',
    };
    const command = new ParseCommand(
      parserReporting(
        [
          ['holder-1', '400.0'],
          ['vault-1', '600.0'],
        ],
        totals,
      ),
      snapshotServiceRecording(stored),
    );

    await command.run([], options);

    expect(stored.map(({ mSolTotals }) => mSolTotals)).toEqual([totals]);
  });

  it('stores a shortfall the given tolerance allows', async () => {
    const stored: StoredSnapshot[] = [];
    const command = new ParseCommand(
      parserReporting([['holder-1', '600.0']], {
        mSolParsedAmount: '600.0',
        mSolSupply: '1000.0',
      }),
      snapshotServiceRecording(stored),
    );

    await command.run([], { ...options, minSupplyRatio: 0.5 });

    expect(stored).toHaveLength(1);
  });

  it('rejects a tolerance that is not a ratio', () => {
    const command = new ParseCommand(
      parserReporting([], { mSolParsedAmount: '0.0', mSolSupply: '0.0' }),
      snapshotServiceRecording([]),
    );

    expect(() => command.parseArgMinSupplyRatio('99%')).toThrow(
      '--min-supply-ratio must be a number between 0 and 1',
    );
  });

  it('rejects an empty tolerance rather than reading it as zero', () => {
    const command = new ParseCommand(
      parserReporting([], { mSolParsedAmount: '0.0', mSolSupply: '0.0' }),
      snapshotServiceRecording([]),
    );

    expect(() => command.parseArgMinSupplyRatio('  ')).toThrow(
      '--min-supply-ratio must be a number between 0 and 1',
    );
  });
});
