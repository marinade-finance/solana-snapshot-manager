import { Command, CommandRunner, Option } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { VotesService } from 'src/votes/votes.service';

@Command({
  name: 'record-msol-votes',
  description: 'Stores mSol votes to DB',
})
export class RecordMSolVotesCommand extends CommandRunner {
  private readonly logger = new Logger(RecordMSolVotesCommand.name);

  constructor(
    private readonly votesService: VotesService,
  ) {
    super();
  }

  async run(): Promise<void> {
    const batchId = await this.votesService.createMSolBatch()
    const voteRecords = await this.votesService.getVoteRecordsFromChain()
    await this.votesService.storeVoteRecords(batchId, voteRecords)
  }
}
