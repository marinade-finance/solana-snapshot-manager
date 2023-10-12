import { Module } from '@nestjs/common';
import { RdsModule } from 'src/rds/rds.module';
import { SnapshotModule } from 'src/snapshot/snapshot.module';
import { VotesModule } from 'src/votes/votes.module';
import { FiltersCommand } from './filters.cmd';
import { ParseCommand } from './parse.cmd';
import { RecordMSolVotesCommand } from './record-msol-votes.cmd';
import { ListStakersCommand } from './list-stakers.cmd';
import { StakersModule } from 'src/stakers/stakers.module';

@Module({
  imports: [SnapshotModule, RdsModule, VotesModule, StakersModule],
  providers: [
    ParseCommand,
    FiltersCommand,
    RecordMSolVotesCommand,
    ListStakersCommand,
  ],
})
export class CliModule {}
