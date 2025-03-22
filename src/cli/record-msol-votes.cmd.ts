import { Command, CommandRunner } from 'nest-commander';
import { VotesService } from 'src/votes/votes.service';

@Command({
  name: 'record-msol-votes',
  description: 'Stores mSol votes to DB',
})
export class RecordMSolVotesCommand extends CommandRunner {

  constructor(private readonly votesService: VotesService) {
    super();
  }

  async run(): Promise<void> {
    const batchId = await this.votesService.createMSolBatch();
    const voteRecords = await this.votesService.getVoteRecordsFromChain();
    await this.votesService.storeVoteRecords(batchId, voteRecords);
  }
}
