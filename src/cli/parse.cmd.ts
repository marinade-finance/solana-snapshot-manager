import { Command, CommandRunner, Option } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { ParserService } from '../snapshot/parser.service';
import * as fs from 'fs';
import * as csv from 'csv';
import { HolderRecord, SnapshotService } from 'src/snapshot/snapshot.service';

type ParseCommandOptions = {
  slot?: number;
  sqlite: string;
  csvOutput?: string;
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
});
const updateRecord = (
  holderRecord: HolderRecord,
  amount: number,
  source: string,
): HolderRecord => ({
  holder: holderRecord.holder,
  amount: holderRecord.amount + amount,
  sources: [...holderRecord.sources, source],
  amounts: [...holderRecord.amounts, amount],
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
    { slot, sqlite, csvOutput }: ParseCommandOptions,
  ): Promise<void> {
    const csvWriter = csvOutput ? prepareCsvWriter(csvOutput) : null;
    const holders: Record<string, HolderRecord> = {};

    for await (const parsedRecord of this.parserService.parse(sqlite)) {
      csvWriter?.write(parsedRecord);
      const holderRecord =
        holders[parsedRecord.pubkey] ??
        defaultHolderRecord(parsedRecord.pubkey);
      holders[parsedRecord.pubkey] = updateRecord(
        holderRecord,
        Number(parsedRecord.amount),
        parsedRecord.source,
      );
    }

    csvWriter?.on('finish', () =>
      this.logger.log('Parsed records written to the CSV', { csv: csvOutput }),
    );
    csvWriter?.end();

    if (slot) {
      const snapshotId = await this.snapshotService.createSnapshot(slot);
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
}
