import { Module } from '@nestjs/common';
import { ConfigModule } from 'src/config/config.module';
import { ConfigService } from 'src/config/config.service';
import { poolFactory, PSQL_POOL_PROVIDER, RdsService } from './rds.service';
import { createPool, createTypeParserPreset, DatabasePool } from 'slonik';

@Module({
  imports: [ConfigModule],
  providers: [poolFactory, RdsService, ConfigService],
  exports: [RdsService, PSQL_POOL_PROVIDER],
})
export class RdsModule {}
