import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'slonik';
import { RdsService } from 'src/rds/rds.service';
import { NativeStakeBalanceDto } from '../snapshot/snapshot.dto';

@Injectable()
export class StakersService {
  private readonly logger = new Logger(StakersService.name);

  constructor(private readonly rdsService: RdsService) {}

  async getNativeStakeBalances(
    startDate: string,
    endDate: string,
    withdraw_authority: string,
  ): Promise<NativeStakeBalanceDto[] | null> {
    if (!startDate) {
      startDate = new Date(0).toISOString();
    }

    if (!endDate) {
      endDate = new Date(Date.now()).toISOString();
    }
    const balances: NativeStakeBalanceDto[] = [];
    const result = await this.rdsService.pool.any(sql.unsafe`
          SELECT *
          FROM native_stake_accounts
          LEFT JOIN snapshots ON snapshots.snapshot_id = native_stake_accounts.snapshot_id
          WHERE snapshots.created_at >= ${startDate} AND snapshots.created_at <= ${endDate} AND withdraw_authority = ${withdraw_authority}
        `);
    if (!result) {
      this.logger.warn('Staker not found!', { withdraw_authority });
      return null;
    }

    for (const balance of result) {
      balances.push({
        amount: balance.amount,
        slot: balance.slot,
        createdAt: balance.created_at,
      });
    }

    this.logger.log('Staker data fetched', { withdraw_authority, result });
    return balances;
  }
}