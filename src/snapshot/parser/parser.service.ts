import { Injectable, Logger } from '@nestjs/common';
import SQLite from 'better-sqlite3';
import BN from 'bn.js';
import 'isomorphic-fetch';
import { mlamportsToMsol, mndelamportsToMNDE } from 'src/util';
import { SolanaService } from 'src/solana/solana.service';
import { PublicKey } from '@solana/web3.js';
import vaults from 'src/vaults/vaults';

const enum Source {
  WALLET = 'WALLET',
}

type SnapshotRecord = {
  pubkey: string;
  amount: string;
  source: Source;
  isVault: boolean;
};
type VeMNDESnapshotRecord = { pubkey: string; amount: string };
type NativeStakeSnapshotRecord = { pubkey: string; amount: string };

const VSR_PROGRAM = '5zgEgPbWKsAAnLPjSM56ZsbLPfVM6nUzh3u45tCnm97D';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const MSOL_MINT = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);

  constructor(private readonly solanaService: SolanaService) {}

  async *parsedRecords(
    db: SQLite.Database,
    slot: number,
  ): AsyncGenerator<[Record<string, BN>, Source]> {
    const slotTimestamp = await this.getBlockTime(slot);
    if (slotTimestamp === null) {
      throw new Error('Failed to get timestamp for the slot: ' + slot);
    }

    yield [this.mSolHolders(db), Source.WALLET];
  }

  async *parseVeMNDERecords(
    db: SQLite.Database,
  ): AsyncGenerator<Record<string, BN>> {
    yield this.vemnde(db);
  }

  async *parseNativeStakesRecords(
    db: SQLite.Database,
  ): AsyncGenerator<Record<string, BN>> {
    yield this.native_stakes(db);
  }

  async getFilters() {
    const vsr_registrar_info =
      await this.solanaService.connection.getAccountInfo(
        new PublicKey(VSR_PROGRAM),
      );
    if (!vsr_registrar_info) {
      throw new Error('Failed to get VSR Registrar Data!');
    }

    return {
      account_owners: SYSTEM_PROGRAM,
      account_mints: [MSOL_MINT].join(','),
      vsr_registrar_data: vsr_registrar_info.data.toString('base64'),
    };
  }
  async *parse(sqlite: string, slot: number): AsyncGenerator<SnapshotRecord> {
    this.logger.log('Opening the SQLite DB', { sqlite });
    const db = SQLite(sqlite, { readonly: true });

    let mSolParsedAmount = new BN(0);
    const mSolSupply = this.getMintSupply(db, MSOL_MINT);
    if (!mSolSupply) {
      throw new Error('Failed to get mSOL supply!');
    }

    for await (const [partialRecords, source] of this.parsedRecords(db, slot)) {
      const sum = Object.entries(partialRecords).reduce((sum, [key, value]) => {
        return vaults.includes(key) ? sum : sum.add(value);
      }, new BN(0));
      mSolParsedAmount = mSolParsedAmount.add(sum);
      this.logger.log('Parsed records received', {
        source,
        sum: mlamportsToMsol(sum),
      });
      for (const [pubkey, amount] of Object.entries(partialRecords)) {
        yield {
          pubkey,
          amount: mlamportsToMsol(amount),
          source,
          isVault: vaults.includes(pubkey),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.logger.log('Finished parsing', {
      mSolParsedAmount: mlamportsToMsol(mSolParsedAmount),
      mSolSupply: mlamportsToMsol(mSolSupply),
      missingMSol: mlamportsToMsol(mSolSupply.sub(mSolParsedAmount)),
    });

    db.close();
  }

  async *parseVeMNDE(sqlite: string): AsyncGenerator<VeMNDESnapshotRecord> {
    this.logger.log('Parse veMNDE: opening the SQLite DB', { sqlite });
    const db = SQLite(sqlite, { readonly: true });
    for await (const record of this.parseVeMNDERecords(db)) {
      for (const [pubkey, amount] of Object.entries(record)) {
        yield { pubkey, amount: mndelamportsToMNDE(amount) };
      }
    }
  }

  async *parseNativeStakes(
    sqlite: string,
  ): AsyncGenerator<NativeStakeSnapshotRecord> {
    this.logger.log('Parse native stakes: opening the SQLite DB', { sqlite });
    const db = SQLite(sqlite, { readonly: true });
    for await (const record of this.parseNativeStakesRecords(db)) {
      for (const [pubkey, amount] of Object.entries(record)) {
        yield { pubkey, amount: mndelamportsToMNDE(amount) };
      }
    }
  }

  private getSystemOwnedTokenAccountsByMint(
    db: SQLite.Database,
    mint: string,
  ): { owner: string; amount: string; pubkey: string }[] {
    return db
      .prepare(
        `
          SELECT token_account.owner, cast(token_account.amount as text) as amount, account.pubkey
          FROM token_account, account
          WHERE token_account.mint = ? AND token_account.owner = account.pubkey AND account.owner = ? AND token_account.amount > 0
          ORDER BY token_account.amount DESC
        `,
      )
      .all([mint, SYSTEM_PROGRAM]) as {
      owner: string;
      amount: string;
      pubkey: string;
    }[];
  }

  private getTokenAccountsByMint(
    db: SQLite.Database,
    mint: string,
  ): { owner: string; amount: string }[] {
    return db
      .prepare(
        `
          SELECT token_account.owner, cast(token_account.amount as text) as amount
          FROM token_account
          WHERE token_account.mint = ? AND token_account.amount > 0
          ORDER BY token_account.amount DESC
        `,
      )
      .all([mint]) as {
      owner: string;
      amount: string;
    }[];
  }

  private getMintSupply(db: SQLite.Database, mint: string): BN | null {
    const [record] = db
      .prepare(
        `SELECT cast(supply as text) as supply FROM token_mint WHERE pubkey = ?`,
      )
      .all(mint) as { supply: string }[];

    return record ? new BN(record.supply) : null;
  }

  private async getBlockTime(slot: number): Promise<number | null> {
    return await this.solanaService.connection.getBlockTime(slot);
  }

  private mSolHolders(db: SQLite.Database): Record<string, BN> {
    const buf: Record<string, BN> = {};
    this.logger.log('Parsing mSOL holders');
    const tokenAccounts = this.getTokenAccountsByMint(db, MSOL_MINT);
    tokenAccounts.forEach((tokenAccount) => {
      buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(
        new BN(tokenAccount.amount),
      );
    });
    return buf;
  }

  private vemnde(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing VeMNDE');
    const buf: Record<string, BN> = {};
    const result = db
      .prepare(
        `SELECT pubkey, voter_authority, voting_power FROM vemnde_accounts`,
      )
      .all() as {
      pubkey: string;
      voter_authority: string;
      voting_power: string;
    }[];
    result.forEach((row) => {
      const voting_power = new BN(row.voting_power);
      buf[row.voter_authority] = (buf[row.voter_authority] ?? new BN(0)).add(
        voting_power,
      );
    });
    return buf;
  }

  private native_stakes(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Native Stakes');
    const buf: Record<string, BN> = {};
    const result = db
      .prepare(
        `SELECT pubkey, withdraw_authority, amount FROM native_stake_accounts`,
      )
      .all() as {
      pubkey: string;
      withdraw_authority: string;
      amount: string;
    }[];
    result.forEach((row) => {
      const total_amount = new BN(row.amount);
      buf[row.withdraw_authority] = (
        buf[row.withdraw_authority] ?? new BN(0)
      ).add(total_amount);
    });
    return buf;
  }
}
