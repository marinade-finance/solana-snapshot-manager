import { Injectable } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { ConfigService } from 'src/config/config.service';

@Injectable()
export class SolanaService {
  constructor (private readonly configService: ConfigService) {}

  public readonly connection = new Connection(this.configService.rpcUrl)
}
