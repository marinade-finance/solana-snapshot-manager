import { Module } from '@nestjs/common';
import { RdsModule } from 'src/rds/rds.module';
import { RdsService } from 'src/rds/rds.service';
import { SnapshotController } from './snapshot.controller';
import { SnapshotService } from './snapshot.service';

@Module({
  imports: [RdsModule],
  controllers: [SnapshotController],
  providers: [SnapshotService, RdsService],
})
export class SnapshotModule {}
