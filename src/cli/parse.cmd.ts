import { Command, CommandRunner, Option } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { ParserService } from '../snapshot/parser.service';
import * as fs from 'fs';
import * as csv from 'csv';
import {
  HolderRecord,
  NativeStakerRecord,
  SnapshotService,
  VeMNDEHolderRecord,
} from 'src/snapshot/snapshot.service';

type ParseCommandOptions = {
  slot: number;
  sqlite: string;
  csvOutput?: string;
  psqlOutput?: boolean;
};

const prepareCsvWriter = (csvPath: string) => {
  const writeStream = fs.createWriteStream(csvPath, { highWaterMark: 1024 });
  const columns = ['pubkey', 'amount', 'source'];
  const csvStream = csv.stringify({ header: true, columns });
  csvStream.pipe(writeStream);

  return csvStream;
};

const defaultHolderRecord = (holder: string): HolderRecord => ({
  holder,
  amount: 0,
  sources: [],
  amounts: [],
  isVault: false,
});
const defaultVeMNDEHolderRecord = (holder: string): VeMNDEHolderRecord => ({
  holder,
  amount: 0,
});

const defaultNativeStakerRecord = (
  withdraw_authority: string,
): NativeStakerRecord => ({
  withdraw_authority,
  amount: 0,
});

const updateRecord = (
  holderRecord: HolderRecord,
  amount: number,
  source: string,
  isVault: boolean,
): HolderRecord => ({
  holder: holderRecord.holder,
  amount: holderRecord.amount + amount,
  sources: [...holderRecord.sources, source],
  amounts: [...holderRecord.amounts, amount],
  isVault: isVault,
});

const updateVeMNDERecord = (
  holderRecord: VeMNDEHolderRecord,
  amount: number,
): VeMNDEHolderRecord => ({
  holder: holderRecord.holder,
  amount: holderRecord.amount + amount,
});

const updateNativeStakerRecord = (
  stakerRecord: NativeStakerRecord,
  amount: number,
): NativeStakerRecord => ({
  withdraw_authority: stakerRecord.withdraw_authority,
  amount: stakerRecord.amount + amount,
});

@Command({
  name: 'parse',
  description: 'Parses SQLite file and prepares records to store',
})
export class ParseCommand extends CommandRunner {
  private readonly logger = new Logger(ParseCommand.name);

  constructor(
    private readonly parserService: ParserService,
    private readonly snapshotService: SnapshotService,
  ) {
    super();
  }

  async run(
    passedParam: string[],
    { slot, sqlite, csvOutput, psqlOutput }: ParseCommandOptions,
  ): Promise<void> {
    if (!slot) {
      throw new Error('--slot argument is required');
    }
    const csvWriter = csvOutput ? prepareCsvWriter(csvOutput) : null;
    const holders: Record<string, HolderRecord> = {};
    const veMNDEHolders: Record<string, VeMNDEHolderRecord> = {};
    const nativeStakers: Record<string, NativeStakerRecord> = {};

    for await (const parsedRecord of this.parserService.parse(sqlite, slot)) {
      csvWriter?.write(parsedRecord);
      const holderRecord =
        holders[parsedRecord.pubkey] ??
        defaultHolderRecord(parsedRecord.pubkey);
      holders[parsedRecord.pubkey] = updateRecord(
        holderRecord,
        Number(parsedRecord.amount),
        parsedRecord.source,
        parsedRecord.isVault,
      );
    }

    for await (const parsedVeMNDERecord of this.parserService.parseVeMNDE(
      sqlite,
    )) {
      const holderRecord =
        veMNDEHolders[parsedVeMNDERecord.pubkey] ??
        defaultVeMNDEHolderRecord(parsedVeMNDERecord.pubkey);
      veMNDEHolders[parsedVeMNDERecord.pubkey] = updateVeMNDERecord(
        holderRecord,
        Number(parsedVeMNDERecord.amount),
      );
    }

    for await (const parsedNativeStakerRecord of this.parserService.parseNativeStakes(
      sqlite,
    )) {
      const stakerRecord =
        nativeStakers[parsedNativeStakerRecord.pubkey] ??
        defaultNativeStakerRecord(parsedNativeStakerRecord.pubkey);
      nativeStakers[parsedNativeStakerRecord.pubkey] = updateNativeStakerRecord(
        stakerRecord,
        Number(parsedNativeStakerRecord.amount),
      );
    }

    csvWriter?.on('finish', () =>
      this.logger.log('Parsed records written to the CSV', { csv: csvOutput }),
    );
    csvWriter?.end();

    if (psqlOutput) {
      const snapshotId = await this.snapshotService.createSnapshot(slot);
      await this.snapshotService.storeSnapshotNativeStakerRecords(
        snapshotId,
        Object.values(nativeStakers),
      );
      await this.snapshotService.storeSnapshotVeMNDERecords(
        snapshotId,
        Object.values(veMNDEHolders),
      );
      await this.snapshotService.storeSnapshotRecords(
        snapshotId,
        Object.values(holders),
      );
    }
  }

  @Option({
    flags: '--sqlite <string>',
    description: 'A SQLite DB file to read data from',
    required: true,
  })
  parseArgSQLite(val: string): string {
    return val;
  }

  @Option({
    flags: '--csv-output <string>',
    description: 'Path to csvOutput CSV',
  })
  parseArgCsv(val: string): string {
    return val;
  }

  @Option({
    flags: '--slot <number>',
    description: 'Slot of the snapshot - if defined, stored to DB as well',
  })
  parseArgSlot(val: string): number {
    return Number(val);
  }

  @Option({
    flags: '--psql-output',
    description: 'Output will be dumped to PostgreSQL DB',
  })
  parseArgPsql(): boolean {
    return true;
  }
}
