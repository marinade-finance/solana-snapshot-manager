import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from 'src/config/config.module';
import { RdsModule } from 'src/rds/rds.module';
import { StakersService } from './stakers.service';
import { StakersController } from './stakers.controller';

@Module({
  imports: [ConfigModule, RdsModule, CacheModule.register()],
  providers: [StakersService],
  controllers: [StakersController],
  exports: [StakersService],
})
export class StakersModule {}
