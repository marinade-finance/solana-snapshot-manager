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
        snapshotCreatedAt: balance.blocktime,
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
        WITH native_holdings AS (
            SELECT 
                withdraw_authority, 
                native_stake_accounts.snapshot_id AS native_snapshot_id, 
                COALESCE(native_stake_accounts.amount, 0) as amount
            FROM native_stake_accounts
        ),
        distinct_authorities AS (
            SELECT DISTINCT withdraw_authority
            FROM native_holdings
        ),
        snapshots_filtered AS (
            SELECT snapshot_id, created_at, blocktime, slot
            FROM snapshots
            WHERE created_at BETWEEN ${startDate} AND ${endDate}
        )

        SELECT 
            da.withdraw_authority,
            COALESCE(nh.amount, 0) as amount,
            sf.created_at,
            sf.blocktime,
            sf.slot
        FROM distinct_authorities da
        CROSS JOIN snapshots_filtered sf
        LEFT JOIN native_holdings nh ON da.withdraw_authority = nh.withdraw_authority AND sf.snapshot_id = nh.native_snapshot_id
        ORDER BY sf.created_at;
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
        snapshotCreatedAt: balance.blocktime,
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
        WITH 
            native_holdings AS (
                  SELECT native_stake_accounts.snapshot_id AS native_snapshot_id, COALESCE(native_stake_accounts.amount, 0) as native_amount
                  FROM native_stake_accounts
                  WHERE native_stake_accounts.withdraw_authority = ${pubkey}
                ),
            liquid_holdings AS (
                SELECT msol_holders.snapshot_id as liquid_snapshot_id, COALESCE(msol_holders.amount, 0) as liquid_amount
                FROM msol_holders
                WHERE msol_holders.owner = ${pubkey}
            )

        SELECT COALESCE(native_holdings.native_amount, 0) as native_amount, COALESCE(liquid_holdings.liquid_amount, 0) as liquid_amount, created_at, slot
        FROM snapshots
        LEFT JOIN native_holdings ON snapshots.snapshot_id = native_holdings.native_snapshot_id
        LEFT JOIN liquid_holdings ON snapshots.snapshot_id = liquid_holdings.liquid_snapshot_id
        WHERE snapshots.created_at BETWEEN ${startDate} AND ${endDate}
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
