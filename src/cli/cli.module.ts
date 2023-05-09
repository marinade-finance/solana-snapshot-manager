import { Module } from '@nestjs/common';
import { RdsModule } from 'src/rds/rds.module';
import { SnapshotModule } from 'src/snapshot/snapshot.module';
import { VotesModule } from 'src/votes/votes.module';
import { FiltersCommand } from './filters.cmd';
import { ParseCommand } from './parse.cmd';
import { RecordMSolVotesCommand } from './record-msol-votes.cmd';

@Module({
  imports: [SnapshotModule, RdsModule, VotesModule],
  providers: [ParseCommand, FiltersCommand, RecordMSolVotesCommand],
})
export class CliModule {}
