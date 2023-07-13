import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { VotesService } from './votes.service';
import { VotesController } from './votes.controller';
import { SolanaModule } from 'src/solana/solana.module';
import { ConfigModule } from 'src/config/config.module';
import { RdsModule } from 'src/rds/rds.module';
import { InterceptorsModule } from 'src/interceptors/interceptors.module';

@Module({
  imports: [
    SolanaModule,
    ConfigModule,
    RdsModule,
    CacheModule.register(),
    InterceptorsModule,
  ],
  providers: [VotesService],
  controllers: [VotesController],
  exports: [VotesService],
})
export class VotesModule {}
