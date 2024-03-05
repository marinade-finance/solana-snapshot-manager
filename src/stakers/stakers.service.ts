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
    withdraw_authority: string,
    startDate?: string,
    endDate?: string,
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
    startDate?: string,
    endDate?: string,
  ): Promise<AllNativeStakeBalancesDto | null> {
    ({ startDate, endDate } = this.getStartAndEndDates(startDate, endDate));

    const result = await this.rdsService.pool.any(
      StakersService.getSqlAllNativeHolders(startDate, endDate),
    );

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
    startDate?: string,
    endDate?: string,
  ): Promise<StakerBalancesDto | null> {
    ({ startDate, endDate } = this.getStartAndEndDates(startDate, endDate));

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

        SELECT COALESCE(native_holdings.native_amount, 0) as native_amount, COALESCE(liquid_holdings.liquid_amount, 0) as liquid_amount, created_at, blocktime, slot
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
        snapshotCreatedAt: balance.blocktime,
      };

      userData.balances.push(balanceDto);
    }

    return userData;
  }

  async getAllStakersBalances(
    startDate?: string,
    endDate?: string,
  ): Promise<StakerBalancesDto[]> {
    ({ startDate, endDate } = this.getStartAndEndDates(startDate, endDate));

    const resultLiquid = this.rdsService.pool.any(
      StakersService.getSqlAllLiquidHolders(startDate, endDate),
    );
    const resultNative = this.rdsService.pool.any(
      StakersService.getSqlAllNativeHolders(startDate, endDate),
    );

    const userData: Map<string, StakerBalancesDto> = new Map();
    const getStakerDto = (owner: string): StakerBalancesDto => {
      let stakerDto = userData.get(owner);
      if (!stakerDto) {
        stakerDto = {
          owner,
          balances: [],
        };
        userData.set(owner, stakerDto);
      }
      return stakerDto;
    };

    // expecting DB consistency where there is only one item per crated at time
    for (const balance of await resultLiquid) {
      const stakerDto = getStakerDto(balance.owner);
      const foundRecord = stakerDto.balances.find(
        (b) => b.createdAt === balance.created_at,
      );
      if (foundRecord) {
        if (foundRecord.liquid_amount !== '0') {
          this.logger.error(
            `foundRecord: ${JSON.stringify(
              foundRecord,
            )}, balance: ${JSON.stringify(balance)}`,
          );
          throw new Error('Duplicate liquid balance for the same time');
        }
        foundRecord.liquid_amount = balance.amount;
      } else {
        stakerDto.balances.push({
          liquid_amount: balance.amount,
          native_amount: '0',
          slot: Number(balance.slot),
          createdAt: balance.created_at,
          snapshotCreatedAt: balance.blocktime,
        });
      }
    }
    for (const balance of await resultNative) {
      const stakerDto = getStakerDto(balance.withdraw_authority);
      const foundRecord = stakerDto.balances.find(
        (b) => b.createdAt === balance.created_at,
      );
      if (foundRecord) {
        if (foundRecord.native_amount !== '0') {
          this.logger.error(
            `foundRecord: ${JSON.stringify(
              foundRecord,
            )}, balance: ${JSON.stringify(balance)}`,
          );
          throw new Error(`Duplicate native balance for the same time`);
        }
        foundRecord.native_amount = balance.amount;
      } else {
        stakerDto.balances.push({
          liquid_amount: '0',
          native_amount: balance.amount,
          slot: Number(balance.slot),
          createdAt: balance.created_at,
          snapshotCreatedAt: balance.blocktime,
        });
      }
    }

    return Array.from(userData.values());
  }

  private static getSqlDistinctSnapshots(startDate: string, endDate: string) {
    return sql.fragment`
      SELECT DISTINCT snapshot_id, created_at, blocktime, slot
      FROM snapshots
      WHERE created_at BETWEEN ${startDate} AND ${endDate}
    `;
  }

  private static getSqlAllNativeHolders(startDate: string, endDate: string) {
    return sql.unsafe`
      WITH snapshots_filtered AS (
        ${StakersService.getSqlDistinctSnapshots(startDate, endDate)}
      ),
      native_holdings AS (
          SELECT 
              withdraw_authority, 
              native_stake_accounts.snapshot_id AS native_snapshot_id, 
              COALESCE(native_stake_accounts.amount, 0) as amount
          FROM native_stake_accounts
          INNER JOIN snapshots_filtered ON native_stake_accounts.snapshot_id = snapshots_filtered.snapshot_id
      ),
      distinct_authorities AS (
          SELECT DISTINCT withdraw_authority
          FROM native_holdings
      )

      SELECT 
          distinct_authorities.withdraw_authority,
          COALESCE(nh.amount, 0) as amount,
          sf.created_at,
          sf.blocktime,
          sf.slot
      FROM distinct_authorities
      CROSS JOIN snapshots_filtered sf
      LEFT JOIN native_holdings nh ON distinct_authorities.withdraw_authority = nh.withdraw_authority
        AND sf.snapshot_id = nh.native_snapshot_id
      ORDER BY sf.created_at;
    `;
  }

  private static getSqlAllLiquidHolders(startDate: string, endDate: string) {
    return sql.unsafe`
      WITH snapshots_filtered AS (
        ${StakersService.getSqlDistinctSnapshots(startDate, endDate)}
      ),
      liquid_holdings AS (
          SELECT 
              msol_holders.owner, 
              msol_holders.snapshot_id AS liquid_snapshot_id,
              COALESCE(msol_holders.amount, 0) as amount
          FROM msol_holders
          INNER JOIN snapshots_filtered ON msol_holders.snapshot_id = snapshots_filtered.snapshot_id
      ),
      distinct_owners AS (
          SELECT DISTINCT owner FROM liquid_holdings
      )

      SELECT 
          distinct_owners.owner,
          COALESCE(lh.amount, 0) as amount,
          sf.created_at,
          sf.blocktime,
          sf.slot
      FROM distinct_owners
      CROSS JOIN snapshots_filtered sf
      LEFT JOIN liquid_holdings lh ON distinct_owners.owner = lh.owner
        AND sf.snapshot_id = lh.liquid_snapshot_id
      ORDER BY sf.created_at;
    `;
  }

  private getStartAndEndDates(
    startDate?: string,
    endDate?: string,
  ): { startDate: string; endDate: string } {
    if (!startDate) {
      startDate = new Date(0).toISOString();
    }
    if (!endDate) {
      endDate = new Date(Date.now()).toISOString();
    }
    return {
      startDate,
      endDate,
    };
  }
}
