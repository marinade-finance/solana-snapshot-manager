import { Injectable, Logger } from '@nestjs/common';
import {
  Connection,
  SolanaJSONRPCError,
  SolanaJSONRPCErrorCode,
} from '@solana/web3.js';
import { ConfigService } from 'src/config/config.service';

@Injectable()
export class SolanaService {
  constructor(private readonly configService: ConfigService) {}
  private readonly MAX_ATTEMPTS = 100;
  private readonly logger = new Logger(SolanaService.name);
  public readonly connection = new Connection(this.configService.rpcUrl);

  async getBlockTime(initialSlot: number): Promise<Date> {
    let attempts = 0;
    let slot = initialSlot;

    while (attempts < this.MAX_ATTEMPTS) {
      try {
        const timeInMs = await this.connection.getBlockTime(slot); //220268188 skipped slot example
        if (timeInMs) {
          return new Date(timeInMs * 1000);
        }
      } catch (error) {
        if (!(error instanceof SolanaJSONRPCError)) {
          throw error;
        }
        if (
          error.code !=
            SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_SLOT_SKIPPED &&
          error.code !=
            SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_LONG_TERM_STORAGE_SLOT_SKIPPED
        ) {
          throw error;
        }
        this.logger.error(
          `${slot} is skipped or not present in long-term storage. Trying with ${
            slot - 1
          }`,
        );
        slot--;
        attempts++;
      }
    }
    throw new Error(`Failed to get blocktime after ${attempts} attempts.`);
  }
}
