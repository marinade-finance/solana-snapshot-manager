import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'slonik';
import { RdsService } from 'src/rds/rds.service';
import {
  NativeStakeBalanceDto,
  AllNativeStakeBalancesDto,
  AllStakeBalancesDto,
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
  ): Promise<AllStakeBalancesDto | null> {
    if (!startDate) {
      startDate = new Date(0).toISOString();
    }

    if (!endDate) {
      endDate = new Date(Date.now()).toISOString();
    }

    const result = await this.rdsService.pool.any(sql.unsafe`
        SELECT 
            COALESCE(msol_holders.owner, native_stake_accounts.withdraw_authority) AS owner, 
            COALESCE(native_stake_accounts.amount, 0) AS native_amount,
            COALESCE(msol_holders.amount, 0) AS liquid_amount,
            snapshots.slot AS slot,
            snapshots.created_at AS created_at
        FROM snapshots
        LEFT JOIN msol_holders ON snapshots.snapshot_id = msol_holders.snapshot_id
        AND msol_holders.owner = ${pubkey}
        LEFT JOIN native_stake_accounts ON snapshots.snapshot_id = native_stake_accounts.snapshot_id
        AND native_stake_accounts.withdraw_authority = ${pubkey}
        WHERE snapshots.created_at BETWEEN ${startDate} AND ${endDate}
      `);

    if (!result || result.length === 0) {
      this.logger.warn('Stakes not found!');
      return null;
    }

    const ownerBalances: AllStakeBalancesDto = {};

    for (const balance of result) {
      const balanceDto = {
        liquid_amount: balance.liquid_amount,
        native_amount: balance.native_amount,
        slot: balance.slot,
        createdAt: balance.created_at,
      };

      if (!ownerBalances[balance.owner]) {
        ownerBalances[balance.owner] = [];
      }

      ownerBalances[balance.owner]?.push(balanceDto);
    }

    return ownerBalances;
  }
}
