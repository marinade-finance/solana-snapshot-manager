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
import { MSolVoteRecordsDto, VeMNDEVoteRecordsDto } from './votes.dto';
import { readJsonFile } from 'src/util';

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
    this.logger.log('Fetching mSOL votes from DB...');
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

    this.logger.log('Vote records fetched', { count: result.length });

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

  async getLatestveMNDEVotes(): Promise<VeMNDEVoteRecordsDto | null> {
    this.logger.log('Fetching veMNDE votes from DB...');
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

    this.logger.log('Vote records fetched', { count: result.length });

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

  async getSnapshotVeMNDEVotes(): Promise<VeMNDEVoteRecordsDto | null> {
    this.logger.log('Fetching veMNDE votes from snapshot file...');
    const data: VeMNDEVoteRecordsDto = await readJsonFile('./votes-mnde.json');

    return {
      veMNDESnapshotCreatedAt: data.veMNDESnapshotCreatedAt,
      voteRecordsCreatedAt: data.veMNDESnapshotCreatedAt || '',
      records: data.records,
    };
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
