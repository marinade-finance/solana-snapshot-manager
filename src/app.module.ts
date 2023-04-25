import { Module } from '@nestjs/common';
import { SnapshotModule } from './snapshot/snapshot.module';
import { RdsModule } from './rds/rds.module';
import { ConfigModule } from './config/config.module';

@Module({
  imports: [SnapshotModule, RdsModule, ConfigModule],
})
export class AppModule {}
