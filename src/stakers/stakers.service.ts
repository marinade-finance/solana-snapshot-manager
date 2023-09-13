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
          msol_holders.owner, 
          COALESCE(native_stake_accounts.amount, 0) as native_amount,
          COALESCE(msol_holders.amount, 0) as liquid_amount,
          snapshots.slot as slot,
          snapshots.created_at as created_at
        FROM msol_holders
        LEFT JOIN snapshots ON snapshots.snapshot_id = msol_holders.snapshot_id
        LEFT JOIN native_stake_accounts ON msol_holders.snapshot_id = native_stake_accounts.snapshot_id AND msol_holders.owner = native_stake_accounts.withdraw_authority
		    WHERE snapshots.created_at >= ${startDate} AND snapshots.created_at <= ${endDate} AND msol_holders.owner = ${pubkey}
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
