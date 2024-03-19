import { Command, CommandRunner, Option } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { StakersService } from 'src/stakers/stakers.service';
import fs from 'fs';
import { JsonStreamStringify } from 'json-stream-stringify';

type ListStakersCommandOptions = {
  startDate: string;
  endDate: string;
  output: string;
};

@Command({
  name: 'list-stakers',
  description:
    'Listing all stakers (liquid and native) for particular time period',
})
export class ListStakersCommand extends CommandRunner {
  private readonly logger = new Logger(ListStakersCommand.name);

  @Option({
    flags: '--start-date <string>',
    description:
      'Start date (e.g., 2023-01-01) from snapshot taken time for fetching stakers data. ' +
      'When not defined <current date> is taken. ' +
      'The start date is inclusive, the date is calculated into range.',
  })
  parseArgStartDate(val: string): string {
    return val;
  }

  @Option({
    flags: '--end-date <string>',
    description:
      'End date (e.g., 2023-01-18) till the snapshots taken time for fetching stakers data. ' +
      'When not defined <current date + 1> is taken. ' +
      'The end date is exclusive, the date is not calculated into range.',
  })
  parseArgEndDate(val: string): string {
    return val;
  }

  @Option({
    flags: '--output <string>',
    description: 'Where to save the output data as JSON',
    required: true,
  })
  parseArgSlot(val: string): string {
    return val;
  }

  constructor(private readonly stakersService: StakersService) {
    super();
  }

  async run(
    passedParam: string[],
    { startDate, endDate, output }: ListStakersCommandOptions,
  ): Promise<void> {
    if (!output) {
      throw new Error('argument --output is required');
    }

    if (!startDate) {
      const currentDay = new Date().toISOString().split('T')[0];
      if (currentDay === undefined) {
        throw new Error(
          'Cannot get the current date, use --start-date parameter please',
        );
      }
      startDate = currentDay;
    }
    if (!endDate) {
      const tomorrowDay = new Date();
      tomorrowDay.setDate(tomorrowDay.getDate() + 1);
      const tomorrowDayStr = tomorrowDay.toISOString().split('T')[0];
      if (tomorrowDayStr === undefined) {
        throw new Error(
          'Cannot get the tomorrow date, use --end-date parameter please',
        );
      }
      endDate = tomorrowDayStr;
    }

    const logger = this.logger;
    logger.log(
      `Loading DB all stakers (liquid and native) in period [${startDate} (inclusive) - ${endDate} (exclusive)]`,
    );
    const dbLoadStartTime = Date.now();
    const allStakers = await this.stakersService.getAllStakersBalances(
      startDate,
      endDate,
    );
    logger.log(
      `DB loaded in '${(Date.now() - dbLoadStartTime) / 1000} seconds'`,
    );

    logger.log(`Saving data as JSON to '${output}'`);
    const jsonWriteStartTime = Date.now();
    const fileWriteStream = fs.createWriteStream(output);
    new JsonStreamStringify(allStakers)
      .pipe(fileWriteStream)
      .on('finish', () =>
        logger.log(
          `Data written into ${output} in '${
            (Date.now() - jsonWriteStartTime) / 1000
          } seconds'`,
        ),
      );
  }
}
