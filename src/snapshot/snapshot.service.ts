import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'slonik';
import { batches, RdsService } from 'src/rds/rds.service';
import {
  MsolBalanceDto,
  MsolBalanceHistoryItemDto,
  NativeStakeBalanceDto,
  VeMNDEBalanceDto,
  VeMNDEBalanceHistoryItemDto,
} from './snapshot.dto';
import { SolanaService } from 'src/solana/solana.service';

export type HolderRecord = {
  holder: string;
  amount: number;
  sources: string[];
  amounts: number[];
  isVault: boolean;
};

export type VeMNDEHolderRecord = {
  holder: string;
  amount: number;
};

export type NativeStakerRecord = {
  withdraw_authority: string;
  amount: number;
};

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    private readonly rdsService: RdsService,
    private readonly solanaService: SolanaService,
  ) {}

  async getNativeStakeBalanceFromLastSnaphot(
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
    const result = await this.rdsService.pool.maybeOne(sql.unsafe`
          SELECT *
          FROM native_stake_accounts
          LEFT JOIN snapshots ON snapshots.snapshot_id = native_stake_accounts.snapshot_id
          WHERE created_at >= ${startDate} AND created_at <= ${endDate} AND withdraw_authority = ${withdraw_authority}
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

  async getMsolBalanceFromLastSnaphot(
    owner: string,
  ): Promise<MsolBalanceDto | null> {
    this.logger.log(
      `Fetching getMsolBalanceFromLastSnaphot for owner ${owner}`,
    );
    const result = await this.rdsService.pool.maybeOne(sql.unsafe`
            WITH last_snapshot AS (
                SELECT *
                FROM snapshots
                WHERE snapshot_id = (SELECT MAX(snapshot_id) FROM snapshots)
            )
            SELECT *
            FROM msol_holders
            INNER JOIN last_snapshot ON msol_holders.snapshot_id = last_snapshot.snapshot_id
            WHERE owner = ${owner}
        `);
    if (!result) {
      this.logger.warn('Msol holder not found!', { owner });
      return null;
    }

    this.logger.log('Msol holder data fetched', { owner, result });
    return {
      amount: result.amount,
      slot: result.slot,
      createdAt: result.created_at,
    };
  }

  async getVeMNDEBalanceFromLastSnaphot(
    owner: string,
  ): Promise<VeMNDEBalanceDto | null> {
    this.logger.log(
      `Fetching getVeMNDEBalanceFromLastSnaphot for owner ${owner}`,
    );
    const result = await this.rdsService.pool.maybeOne(sql.unsafe`
            WITH last_snapshot AS (
                SELECT *
                FROM snapshots
                WHERE snapshot_id = (SELECT MAX(snapshot_id) FROM snapshots)
            )
            SELECT *
            FROM vemnde_holders
            INNER JOIN last_snapshot ON vemnde_holders.snapshot_id = last_snapshot.snapshot_id
            WHERE owner = ${owner}
        `);
    if (!result) {
      this.logger.warn('VeMNDE holder not found!', { owner });
      return null;
    }

    this.logger.log('VeMNDE holder data fetched', { owner, result });
    return {
      amount: result.amount,
      slot: result.slot,
      createdAt: result.created_at,
    };
  }

  // Resolves an optional [startDate, endDate] range to a concrete window,
  // defaulting to the last month when bounds are missing.
  private resolveHistoryRange(
    startDate?: string,
    endDate?: string,
  ): { startDate: string; endDate: string } {
    const end = endDate ? new Date(endDate) : new Date();
    let start: Date;
    if (startDate) {
      start = new Date(startDate);
    } else {
      start = new Date(end);
      start.setMonth(start.getMonth() - 1);
    }
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }

  async getMsolBalanceHistory(
    owner: string,
    startDate?: string,
    endDate?: string,
  ): Promise<MsolBalanceHistoryItemDto[]> {
    const range = this.resolveHistoryRange(startDate, endDate);
    this.logger.log(
      `Fetching getMsolBalanceHistory for owner ${owner} [${range.startDate},${range.endDate}]`,
    );
    const result = await this.rdsService.pool.any(sql.unsafe`
            SELECT msol_holders.amount, snapshots.slot, snapshots.created_at, snapshots.blocktime
            FROM msol_holders
            INNER JOIN snapshots ON snapshots.snapshot_id = msol_holders.snapshot_id
            WHERE snapshots.blocktime >= ${range.startDate}
              AND snapshots.blocktime <= ${range.endDate}
              AND msol_holders.owner = ${owner}
            ORDER BY snapshots.blocktime ASC
        `);

    this.logger.log('Msol holder history fetched', {
      owner,
      count: result.length,
    });
    return result.map((row) => ({
      amount: row.amount,
      slot: row.slot,
      createdAt: row.created_at,
      snapshotCreatedAt: row.blocktime,
    }));
  }

  async getVeMNDEBalanceHistory(
    owner: string,
    startDate?: string,
    endDate?: string,
  ): Promise<VeMNDEBalanceHistoryItemDto[]> {
    const range = this.resolveHistoryRange(startDate, endDate);
    this.logger.log(
      `Fetching getVeMNDEBalanceHistory for owner ${owner} [${range.startDate},${range.endDate}]`,
    );
    const result = await this.rdsService.pool.any(sql.unsafe`
            SELECT vemnde_holders.amount, snapshots.slot, snapshots.created_at, snapshots.blocktime
            FROM vemnde_holders
            INNER JOIN snapshots ON snapshots.snapshot_id = vemnde_holders.snapshot_id
            WHERE snapshots.blocktime >= ${range.startDate}
              AND snapshots.blocktime <= ${range.endDate}
              AND vemnde_holders.owner = ${owner}
            ORDER BY snapshots.blocktime ASC
        `);

    this.logger.log('VeMNDE holder history fetched', {
      owner,
      count: result.length,
    });
    return result.map((row) => ({
      amount: row.amount,
      slot: row.slot,
      createdAt: row.created_at,
      snapshotCreatedAt: row.blocktime,
    }));
  }

  async createSnapshot(slot: number): Promise<number> {
    const blockTime = await this.solanaService.getBlockTime(slot);
    const { snapshot_id: snapshotId } = await this.rdsService.pool.one(
      sql.unsafe`INSERT INTO snapshots (slot, blocktime) VALUES (${slot}, ${blockTime.toISOString()}) RETURNING snapshot_id`,
    );

    return snapshotId;
  }
  async storeSnapshotRecords(
    snapshotId: number,
    holders: HolderRecord[],
  ): Promise<void> {
    const BATCH_SIZE = 1000;
    for (const batch of batches(holders, BATCH_SIZE)) {
      await this.rdsService.pool.query(sql.unsafe`
                INSERT INTO msol_holders (snapshot_id, owner, amount, sources, amounts, is_vault)
                SELECT *
                FROM jsonb_to_recordset(${sql.jsonb(
                  batch.map(
                    ({ holder, amount, sources, amounts, isVault }) => ({
                      snapshotId,
                      holder,
                      amount,
                      sources,
                      amounts,
                      is_vault: isVault,
                    }),
                  ),
                )})
                AS t ("snapshotId" integer, holder text, amount numeric, sources text[], amounts numeric[], is_vault boolean)`);
      this.logger.log('mSOL Holders Batch inserted', {
        snapshotId,
        len: batch.length,
      });
    }
  }
  async storeSnapshotVeMNDERecords(
    snapshotId: number,
    holders: VeMNDEHolderRecord[],
  ): Promise<void> {
    const BATCH_SIZE = 1000;
    for (const batch of batches(holders, BATCH_SIZE)) {
      await this.rdsService.pool.query(sql.unsafe`
                INSERT INTO vemnde_holders (snapshot_id, owner, amount)
                SELECT *
                FROM jsonb_to_recordset(${sql.jsonb(
                  batch.map(({ holder, amount }) => ({
                    snapshotId,
                    holder,
                    amount,
                  })),
                )})
                AS t ("snapshotId" integer, holder text, amount numeric)`);
      this.logger.log('VeMNDE Holders Batch inserted', {
        snapshotId,
        len: batch.length,
      });
    }
  }
  async storeSnapshotNativeStakerRecords(
    snapshotId: number,
    holders: NativeStakerRecord[],
  ): Promise<void> {
    const BATCH_SIZE = 1000;
    for (const batch of batches(holders, BATCH_SIZE)) {
      await this.rdsService.pool.query(sql.unsafe`
                INSERT INTO native_stake_accounts (snapshot_id, withdraw_authority, amount)
                SELECT *
                FROM jsonb_to_recordset(${sql.jsonb(
                  batch.map(({ withdraw_authority, amount }) => ({
                    snapshotId,
                    withdraw_authority,
                    amount,
                  })),
                )})
                AS t ("snapshotId" integer, withdraw_authority text, amount numeric)`);
      this.logger.log('Native Stakers Batch inserted', {
        snapshotId,
        len: batch.length,
      });
    }
  }
}
