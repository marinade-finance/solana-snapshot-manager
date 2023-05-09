import { Module } from '@nestjs/common';
import { ConfigModule } from 'src/config/config.module';
import { poolFactory, PSQL_POOL_PROVIDER, RdsService } from './rds.service';

@Module({
  imports: [ConfigModule],
  providers: [poolFactory, RdsService],
  exports: [RdsService, PSQL_POOL_PROVIDER],
})
export class RdsModule {}
