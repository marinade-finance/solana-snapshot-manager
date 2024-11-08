import { Injectable, Logger } from '@nestjs/common';
import {
  DirectedStakeSdk,
  findVoteRecords,
  DirectedStakeVoteRecord,
} from '@marinade.finance/directed-stake-sdk';
import { SolanaService } from 'src/solana/solana.service';
import { Keypair } from '@solana/web3.js';
import { batches, RdsService } from 'src/rds/rds.service';
import { sql } from 'slonik';
import {
  MSolVoteRecordDto,
  MSolVoteRecordsDto,
  MSolVoteSnapshotsDto,
  VeMNDEVoteRecordDto,
  VeMNDEVoteRecordsDto,
  VeMNDEVoteSnapshotsDto,
} from './votes.dto';

@Injectable()
export class VotesService {
  private readonly logger = new Logger(VotesService.name);

  constructor(
    private readonly solanaServive: SolanaService,
    private readonly rdsService: RdsService,
  ) {}

  async getVoteRecordsFromChain(): Promise<DirectedStakeVoteRecord[]> {
    this.logger.log('Fetching votes from the chain...');
    const sdk = new DirectedStakeSdk({
      connection: this.solanaServive.connection,
      wallet: Keypair.generate(),
    });
    const votes = await findVoteRecords({ sdk });

    return votes.map((vote) => vote.account);
  }

  async getLatestMSolVotes(): Promise<MSolVoteRecordsDto | null> {
    this.logger.log('Fetching latest mSOL votes from DB...');
    const result = await this.rdsService.pool.any(sql.unsafe`
            WITH last_batch AS (
                SELECT *
                FROM msol_votes_batches
                WHERE batch_id = (SELECT MAX(batch_id) FROM msol_votes_batches)
            ),
            last_snapshot AS (
                SELECT *
                FROM snapshots
                WHERE snapshot_id = (SELECT MAX(snapshot_id) FROM snapshots)
            )
            SELECT
              last_snapshot.created_at as msol_snapshot_created_at,
              last_batch.created_at as vote_records_created_at,
              amount,
              msol_votes.owner as owner,
              msol_votes.vote_account as vote_account
            FROM msol_holders
            INNER JOIN last_snapshot ON msol_holders.snapshot_id = last_snapshot.snapshot_id
            RIGHT JOIN msol_votes ON msol_votes.owner = msol_holders.owner
            INNER JOIN last_batch ON msol_votes.batch_id = last_batch.batch_id
        `);

    this.logger.log('Latest MSOL vote records fetched', {
      count: result.length,
    });

    if (result.length === 0) {
      return null;
    }

    return {
      mSolSnapshotCreatedAt: result[0].msol_snapshot_created_at,
      voteRecordsCreatedAt: result[0].vote_records_created_at,
      records: result.map(({ amount, owner, vote_account }) => ({
        amount,
        tokenOwner: owner,
        validatorVoteAccount: vote_account,
      })),
    };
  }

  async getMSolVotes(
    startDate: string,
    endDate: string,
  ): Promise<MSolVoteSnapshotsDto | null> {
    this.logger.log(
      `Fetching all mSOL votes from DB [${startDate},${endDate}]`,
    );

    if (!startDate) {
      startDate = new Date(0).toISOString();
    }

    if (!endDate) {
      endDate = new Date(Date.now()).toISOString();
    }

    const result = await this.rdsService.pool.any(sql.unsafe`
            WITH last_snapshot AS (
                SELECT snapshot_id, created_at
                FROM (
                    SELECT snapshot_id, created_at,
                    ROW_NUMBER() OVER (PARTITION BY DATE(created_at) ORDER BY snapshot_id DESC) as rn
                    FROM snapshots
                ) t
                WHERE t.rn = 1
            )
            SELECT
                ls.snapshot_id as msol_snapshot_id,
                ls.created_at as msol_snapshot_created_at,
                vb.created_at as vote_records_created_at,
                mh.amount,
                mv.owner as owner,
                mv.vote_account as vote_account
            FROM 
                msol_votes_batches vb
            RIGHT JOIN 
                msol_votes mv ON mv.batch_id = vb.batch_id
            INNER JOIN 
                last_snapshot ls ON DATE(ls.created_at) = DATE(vb.created_at)
            INNER JOIN 
                msol_holders mh ON mh.snapshot_id = ls.snapshot_id AND mh.owner = mv.owner
            WHERE vb.created_at >= ${startDate} AND vb.created_at <= ${endDate}
            ORDER BY vb.batch_id DESC
  `);

    this.logger.log('All mSOL vote records fetched', { count: result.length });

    if (result.length === 0) {
      return null;
    }

    const groupedBySnapshotId = result.reduce((groups, row) => {
      const snapshotId = row.msol_snapshot_id;
      if (!groups[snapshotId]) {
        groups[snapshotId] = [];
      }
      groups[snapshotId].push(row);
      return groups;
    }, {});

    const snapshots = Object.entries(groupedBySnapshotId).map(([, records]) => {
      const recordsDto = new MSolVoteRecordsDto();
      recordsDto.records = (records as any)
        .map((record: any) => {
          const recordDto = new MSolVoteRecordDto();
          recordDto.validatorVoteAccount = record.vote_account;
          recordDto.amount = record.amount;
          recordDto.tokenOwner = record.owner;
          return recordDto;
        })
        .filter(
          (value: any, index: any, self: any) =>
            self.findIndex((v: any) => v.tokenOwner === value.tokenOwner) ===
            index,
        );

      recordsDto.mSolSnapshotCreatedAt = new Date(
        (records as any)[0].msol_snapshot_created_at as any,
      ).toISOString();
      recordsDto.voteRecordsCreatedAt = (
        (records as any)[0] as any
      )?.vote_records_created_at;

      return recordsDto;
    });

    const snapshotsDto = new MSolVoteSnapshotsDto();
    snapshotsDto.snapshots = snapshots;

    return snapshotsDto;
  }

  async getLatestveMNDEVotes(): Promise<VeMNDEVoteRecordsDto | null> {
    this.logger.log('Fetching latest veMNDE votes from DB...');
    const result = await this.rdsService.pool.any(sql.unsafe`
            WITH last_batch AS (
                SELECT *
                FROM msol_votes_batches
                WHERE batch_id = (SELECT MAX(batch_id) FROM msol_votes_batches)
            ),
            last_snapshot AS (
                SELECT *
                FROM snapshots
                WHERE snapshot_id = (SELECT MAX(snapshot_id) FROM snapshots)
            )
            SELECT
              last_snapshot.created_at as vemnde_snapshot_created_at,
              last_batch.created_at as vote_records_created_at,
              amount,
              msol_votes.owner as owner,
              msol_votes.vote_account as vote_account
            FROM vemnde_holders
            INNER JOIN last_snapshot ON vemnde_holders.snapshot_id = last_snapshot.snapshot_id
            RIGHT JOIN msol_votes ON msol_votes.owner = vemnde_holders.owner
            INNER JOIN last_batch ON msol_votes.batch_id = last_batch.batch_id
        `);

    this.logger.log('Latest MNDE vote records fetched', {
      count: result.length,
    });

    if (result.length === 0) {
      return null;
    }

    return {
      veMNDESnapshotCreatedAt: result[0].msol_snapshot_created_at,
      voteRecordsCreatedAt: result[0].vote_records_created_at,
      records: result.map(({ amount, owner, vote_account }) => ({
        amount,
        tokenOwner: owner,
        validatorVoteAccount: vote_account,
      })),
    };
  }

  async getVeMNDEVotes(
    startDate: string,
    endDate: string,
  ): Promise<VeMNDEVoteSnapshotsDto | null> {
    this.logger.log(
      `Fetching all veMNDE votes from DB [${startDate},${endDate}]`,
    );

    if (!startDate) {
      startDate = new Date(0).toISOString();
    }

    if (!endDate) {
      endDate = new Date().toISOString();
    }

    const result = await this.rdsService.pool.any(sql.unsafe`
            WITH last_snapshot AS (
                SELECT snapshot_id, created_at
                FROM (
                    SELECT snapshot_id, created_at,
                    ROW_NUMBER() OVER (PARTITION BY DATE(created_at) ORDER BY snapshot_id DESC) as rn
                    FROM snapshots
                ) t
                WHERE t.rn = 1
            )
            SELECT
                ls.snapshot_id as vemnde_snapshot_id,
                ls.created_at as vemnde_snapshot_created_at,
                vb.created_at as vote_records_created_at,
                vh.amount,
                mv.owner as owner,
                mv.vote_account as vote_account
            FROM 
                msol_votes_batches vb
            RIGHT JOIN 
                msol_votes mv ON mv.batch_id = vb.batch_id
            INNER JOIN 
                last_snapshot ls ON DATE(ls.created_at) = DATE(vb.created_at)
            INNER JOIN 
                vemnde_holders vh ON vh.snapshot_id = ls.snapshot_id AND vh.owner = mv.owner
            WHERE vb.created_at >= ${startDate} AND vb.created_at <= ${endDate}
            ORDER BY vb.batch_id DESC
  `);
    this.logger.log('All MNDE vote records fetched', { count: result.length });

    if (result.length === 0) {
      return null;
    }

    const groupedBySnapshotId = result.reduce((groups, row) => {
      const snapshotId = row.vemnde_snapshot_id;
      if (!groups[snapshotId]) {
        groups[snapshotId] = [];
      }
      groups[snapshotId].push(row);
      return groups;
    }, {});

    const snapshots = Object.entries(groupedBySnapshotId).map(([, records]) => {
      const recordsDto = new VeMNDEVoteRecordsDto();
      recordsDto.records = (records as any)
        .map((record: any) => {
          const recordDto = new VeMNDEVoteRecordDto();
          recordDto.validatorVoteAccount = record.vote_account;
          recordDto.amount = record.amount;
          recordDto.tokenOwner = record.owner;
          return recordDto;
        })
        .filter(
          (value: any, index: any, self: any) =>
            self.findIndex((v: any) => v.tokenOwner === value.tokenOwner) ===
            index,
        );

      recordsDto.veMNDESnapshotCreatedAt = new Date(
        (records as any)[0].vemnde_snapshot_created_at as any,
      ).toISOString();
      recordsDto.voteRecordsCreatedAt = (
        (records as any)[0] as any
      )?.vote_records_created_at;

      return recordsDto;
    });

    const snapshotsDto = new VeMNDEVoteSnapshotsDto();
    snapshotsDto.snapshots = snapshots;

    return snapshotsDto;
  }

  async createMSolBatch(): Promise<number> {
    const { batch_id: batchId } = await this.rdsService.pool.one(
      sql.unsafe`INSERT INTO msol_votes_batches DEFAULT VALUES RETURNING batch_id`,
    );

    return batchId;
  }

  async storeVoteRecords(batchId: number, records: DirectedStakeVoteRecord[]) {
    const BATCH_SIZE = 1000;
    for (const batch of batches(records, BATCH_SIZE)) {
      await this.rdsService.pool.query(sql.unsafe`
                INSERT INTO msol_votes (batch_id, owner, vote_account)
                SELECT *
                FROM jsonb_to_recordset(${sql.jsonb(
                  batch.map(({ owner, validatorVote }) => ({
                    batchId,
                    owner: owner.toBase58(),
                    voteAccount: validatorVote.toBase58(),
                  })),
                )})
                AS t ("batchId" integer, owner text, "voteAccount" text)`);
      this.logger.log('Batch inserted', { batchId, len: batch.length });
    }
  }
}
