import { Module } from '@nestjs/common';
import { SnapshotModule } from './snapshot/snapshot.module';
import { RdsModule } from './rds/rds.module';
import { ConfigModule } from './config/config.module';
import { VotesModule } from './votes/votes.module';
import { SolanaModule } from './solana/solana.module';

@Module({
  imports: [SnapshotModule, RdsModule, ConfigModule, VotesModule, SolanaModule],
})
export class AppModule {}
