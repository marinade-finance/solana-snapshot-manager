import { Command, CommandRunner, Option } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { ParserService } from '../snapshot/parser/parser.service';
import * as fs from 'fs';

type FiltersCommandOptions = {
  jsonOutput: string;
};

@Command({
  name: 'filters',
  description:
    'Prepares filters for snapshot parser (project: marinade-snapshot-etl)',
})
export class FiltersCommand extends CommandRunner {
  private readonly _logger = new Logger(FiltersCommand.name);

  constructor(private readonly parserService: ParserService) {
    super();
  }

  async run(
    _passedParam: string[],
    { jsonOutput }: FiltersCommandOptions,
  ): Promise<void> {
    const filters = await this.parserService.getFilters();
    fs.writeFileSync(jsonOutput, JSON.stringify(filters, null, 2));
  }

  @Option({
    flags: '--json-output <string>',
    description: 'Path to jsonOutput JSON',
    required: true,
  })
  parseArgCsv(val: string): string {
    return val;
  }
}
