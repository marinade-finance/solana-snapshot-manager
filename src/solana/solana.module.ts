import { Module } from '@nestjs/common';
import { ConfigModule } from 'src/config/config.module';
import { SolanaService } from './solana.service';

@Module({
  imports: [ConfigModule],
  providers: [SolanaService],
  exports: [SolanaService]
})
export class SolanaModule {}
