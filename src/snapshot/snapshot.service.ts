import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'slonik';
import { batches, RdsService } from 'src/rds/rds.service';
import {
  MsolBalanceDto,
  NativeStakeBalanceDto,
  VeMNDEBalanceDto,
} from './snapshot.dto';

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

  constructor(private readonly rdsService: RdsService) {}

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
      });
    }

    this.logger.log('Staker data fetched', { withdraw_authority, result });
    return balances;
  }

  async getMsolBalanceFromLastSnaphot(
    owner: string,
  ): Promise<MsolBalanceDto | null> {
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
      this.logger.warn('Holder not found!', { owner });
      return null;
    }

    this.logger.log('Holder data fetched', { owner, result });
    return {
      amount: result.amount,
      slot: result.slot,
      createdAt: result.created_at,
    };
  }

  async getVeMNDEBalanceFromLastSnaphot(
    owner: string,
  ): Promise<VeMNDEBalanceDto | null> {
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
      this.logger.warn('Holder not found!', { owner });
      return null;
    }

    this.logger.log('Holder data fetched', { owner, result });
    return {
      amount: result.amount,
      slot: result.slot,
      createdAt: result.created_at,
    };
  }

  async createSnapshot(slot: number): Promise<number> {
    const { snapshot_id: snapshotId } = await this.rdsService.pool.one(
      sql.unsafe`INSERT INTO snapshots (slot) VALUES (${slot}) RETURNING snapshot_id`,
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
                      isVault,
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
