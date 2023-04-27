import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'slonik';
import { batches, RdsService } from 'src/rds/rds.service';
import { MsolBalanceDto } from './snapshot.dto';

export type HolderRecord = {
  holder: string;
  amount: number;
  sources: string[];
  amounts: number[];
};

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(private readonly rdsService: RdsService) {}

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
                INSERT INTO msol_holders (snapshot_id, owner, amount, sources, amounts)
                SELECT *
                FROM jsonb_to_recordset(${sql.jsonb(
                  batch.map(({ holder, amount, sources, amounts }) => ({
                    snapshotId,
                    holder,
                    amount,
                    sources,
                    amounts,
                  })),
                )})
                AS t ("snapshotId" integer, holder text, amount numeric, sources text[], amounts numeric[])`);
      this.logger.log('Batch inserted', { snapshotId, len: batch.length });
    }
  }
}
