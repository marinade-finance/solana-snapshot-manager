import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { RdsModule } from 'src/rds/rds.module';
import { ParserService } from './parser.service';
import { SnapshotController } from './snapshot.controller';
import { SnapshotService } from './snapshot.service';
import { SolanaModule } from 'src/solana/solana.module';

@Module({
  imports: [RdsModule, CacheModule.register(), SolanaModule],
  controllers: [SnapshotController],
  providers: [SnapshotService, ParserService],
  exports: [SnapshotService, ParserService],
})
export class SnapshotModule {}
