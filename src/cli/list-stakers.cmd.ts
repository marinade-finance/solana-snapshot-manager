import { Command, CommandRunner, Option } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { StakersService } from 'src/stakers/stakers.service';
import fs from 'fs/promises';

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
      'When not defined current date is taken. ' +
      'The start date is inclusive, the date is calculated into range.',
  })
  parseArgStartDate(val: string): string {
    return val;
  }

  @Option({
    flags: '--end-date <string>',
    description:
      'End date (e.g., 2023-01-18) till the snapshots taken time for fetching stakers data. ' +
      'When not defined current date is taken. ' +
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

    this.logger.log(
      `Listing all stakers (liquid and native) for ${startDate || 'now'} - ${
        endDate || 'now'
      }`,
    );
    const allStakers = await this.stakersService.getAllStakersBalances(
      startDate,
      endDate,
    );

    this.logger.log(`Saving data as JSON to '${output}'`);
    await fs.writeFile(output, JSON.stringify(allStakers, null, 0));
  }
}
