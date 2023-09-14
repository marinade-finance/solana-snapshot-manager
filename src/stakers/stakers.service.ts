import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'slonik';
import { RdsService } from 'src/rds/rds.service';
import {
  NativeStakeBalanceDto,
  AllNativeStakeBalancesDto,
  StakerBalancesDto,
} from '../snapshot/snapshot.dto';

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

  async getAllNativeStakeBalances(
    startDate: string,
    endDate: string,
  ): Promise<AllNativeStakeBalancesDto | null> {
    if (!startDate) {
      startDate = new Date(0).toISOString();
    }

    if (!endDate) {
      endDate = new Date(Date.now()).toISOString();
    }

    const result = await this.rdsService.pool.any(sql.unsafe`
        SELECT *
        FROM native_stake_accounts
        LEFT JOIN snapshots ON snapshots.snapshot_id = native_stake_accounts.snapshot_id
        WHERE snapshots.created_at >= ${startDate} AND snapshots.created_at <= ${endDate}
      `);

    if (!result || result.length === 0) {
      this.logger.warn('Stakes not found!');
      return null;
    }

    const ownerBalances: AllNativeStakeBalancesDto = {};

    for (const balance of result) {
      const balanceDto = {
        amount: balance.amount,
        slot: balance.slot,
        createdAt: balance.created_at,
      };

      if (!ownerBalances[balance.withdraw_authority]) {
        ownerBalances[balance.withdraw_authority] = [];
      }

      ownerBalances[balance.withdraw_authority]?.push(balanceDto);
    }

    return ownerBalances;
  }

  async getAllStakeBalances(
    pubkey: string,
    startDate: string,
    endDate: string,
  ): Promise<StakerBalancesDto | null> {
    if (!startDate) {
      startDate = new Date(0).toISOString();
    }

    if (!endDate) {
      endDate = new Date(Date.now()).toISOString();
    }

    const result = await this.rdsService.pool.any(sql.unsafe`
        WITH native_holdings AS (
          SELECT native_stake_accounts.snapshot_id AS native_snapshot_id, COALESCE(native_stake_accounts.amount, 0) as native_amount
          FROM native_stake_accounts
          JOIN snapshots ON native_stake_accounts.snapshot_id = snapshots.snapshot_id
          WHERE native_stake_accounts.withdraw_authority = ${pubkey}
        )

        SELECT msol_holders.snapshot_id, msol_holders.owner AS owner, COALESCE(amount, 0) as liquid_amount,
        COALESCE(native_amount, 0) as native_amount, slot, created_at
        FROM msol_holders
        LEFT JOIN native_holdings ON msol_holders.snapshot_id = native_holdings.native_snapshot_id
        LEFT JOIN snapshots ON msol_holders.snapshot_id = snapshots.snapshot_id
        WHERE msol_holders.owner = ${pubkey} AND snapshots.created_at BETWEEN ${startDate} AND ${endDate}
      `);

    if (!result || result.length === 0) {
      this.logger.warn('Stakes not found!');
      return null;
    }

    const userData: StakerBalancesDto = {
      owner: pubkey,
      balances: [],
    };

    for (const balance of result) {
      const balanceDto = {
        liquid_amount: balance.liquid_amount,
        native_amount: balance.native_amount,
        slot: balance.slot,
        createdAt: balance.created_at,
      };

      userData.balances.push(balanceDto);
    }

    return userData;
  }
}
