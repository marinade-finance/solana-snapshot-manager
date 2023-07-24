import { Module } from '@nestjs/common';
import { SnapshotModule } from './snapshot/snapshot.module';
import { RdsModule } from './rds/rds.module';
import { ConfigModule } from './config/config.module';
import { VotesModule } from './votes/votes.module';
import { SolanaModule } from './solana/solana.module';
import { StakersModule } from './stakers/stakers.module';

@Module({
  imports: [
    SnapshotModule,
    RdsModule,
    ConfigModule,
    VotesModule,
    SolanaModule,
    StakersModule,
  ],
})
export class AppModule {}
