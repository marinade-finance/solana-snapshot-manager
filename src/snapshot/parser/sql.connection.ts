import { Logger } from '@nestjs/common';
import SQLite from 'better-sqlite3';
import {
  AccountInfo,
  Commitment,
  Connection,
  DataSizeFilter,
  GetMultipleAccountsConfig,
  GetParsedProgramAccountsConfig,
  GetProgramAccountsConfig,
  GetProgramAccountsFilter,
  GetProgramAccountsResponse,
  MemcmpFilter,
  ParsedAccountData,
  PublicKey,
  RpcResponseAndContext,
} from '@solana/web3.js';
import { GetAccountInfoConfig } from '@solana/web3.js';
import base58 from 'bs58';

export class SQLConnection extends Connection {
  constructor(
    readonly db: SQLite.Database,
    readonly table: string,
    readonly slot: number,
    readonly backupRpcEndpoint: string,
    readonly logger?: Logger,
  ) {
    // for any other calls than getAccountInfo, we want to to use the real RPC connection
    super(backupRpcEndpoint, {
      // faking fetch as we don't want to do any real network calls
      fetch: async (
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        input: RequestInfo | URL,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        init?: RequestInit | undefined,
      ) => {
        return new Response();
      },
    });
  }

  get rpcEndpoint(): string {
    return `SQLConnection:${this.db.name}/${this.table}`;
  }

  /**
   * Fetch all the account info for the specified public key
   */
  async getAccountInfo(
    publicKey: PublicKey,
    commitmentOrConfig?: Commitment | GetAccountInfoConfig,
  ): Promise<AccountInfo<Buffer> | null> {
    const accountInfos = await this.getMultipleAccountsInfo(
      [publicKey],
      commitmentOrConfig,
    );
    if (!accountInfos || accountInfos.length === 0 || !accountInfos[0]) {
      return null;
    } else {
      return accountInfos[0];
    }
  }

  async getAccountInfoAndContext(
    publicKey: PublicKey,
    commitmentOrConfig?: Commitment | GetAccountInfoConfig,
  ): Promise<RpcResponseAndContext<AccountInfo<Buffer> | null>> {
    return {
      context: { slot: this.slot },
      value: await this.getAccountInfo(publicKey, commitmentOrConfig),
    };
  }

  async getParsedAccountInfo(
    publicKey: PublicKey,
    commitmentOrConfig?: Commitment | GetAccountInfoConfig,
  ): Promise<
    RpcResponseAndContext<AccountInfo<Buffer | ParsedAccountData> | null>
  > {
    return await this.getAccountInfoAndContext(publicKey, commitmentOrConfig);
  }

  async getMultipleAccountsInfo(
    publicKeys: PublicKey[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    commitmentOrConfig?: Commitment | GetMultipleAccountsConfig,
  ): Promise<(AccountInfo<Buffer> | null)[]> {
    if (!publicKeys || publicKeys.length === 0) {
      return [];
    }

    this.logDebug(
      `Getting public keys ${publicKeys.map((pk) => pk.toBase58())}`,
    );
    const inClause = publicKeys.map(() => '?').join(',');
    const publicKeysBase58 = publicKeys.map((pk) => pk.toBase58());
    const rows = this.db
      .prepare(
        `
              SELECT
                pubkey,
                owner,
                  executable,
                  cast (lamports as text) as lamports,
                  cast (rent_epoch as text) as rent_epoch,
                  account
              FROM ${this.table}
              WHERE pubkey IN (${inClause})
          `,
      )
      .all(...publicKeysBase58) as {
        pubkey: string;
        owner: string;
        executable: boolean;
        lamports: string;
        rent_epoch: string | null;
        account: Buffer;
      }[];

    const queriedAccountInfos: Map<string, AccountInfo<Buffer>> = new Map();
    if (rows) {
      rows.forEach((row) => {
        const accountInfo: AccountInfo<Buffer> = {
          executable: row.executable,
          owner: new PublicKey(row.owner),
          lamports: Number(row.lamports),
          data: row.account,
          rentEpoch: row.rent_epoch ? Number(row.rent_epoch) : undefined,
        };
        queriedAccountInfos.set(row.pubkey, accountInfo);
      });
    }
    const result: (AccountInfo<Buffer> | null)[] = [];
    for (const publicKey of publicKeys) {
      const accountInfo = queriedAccountInfos.get(publicKey.toBase58());
      if (accountInfo) {
        result.push(accountInfo);
      } else {
        result.push(null);
      }
    }
    return result;
  }

  async getMultipleAccountsInfoAndContext(
    publicKeys: PublicKey[],
    commitmentOrConfig?: Commitment | GetMultipleAccountsConfig,
  ): Promise<RpcResponseAndContext<(AccountInfo<Buffer> | null)[]>> {
    return {
      context: { slot: this.slot },
      value: await this.getMultipleAccountsInfo(publicKeys, commitmentOrConfig),
    };
  }

  async getMultipleParsedAccounts(
    publicKeys: PublicKey[],
    rawConfig?: GetMultipleAccountsConfig,
  ): Promise<
    RpcResponseAndContext<(AccountInfo<Buffer | ParsedAccountData> | null)[]>
  > {
    return await this.getMultipleAccountsInfoAndContext(publicKeys, rawConfig);
  }

  async getProgramAccounts(
    programId: PublicKey,
    configOrCommitment: GetProgramAccountsConfig &
      Readonly<{ withContext: true }>,
  ): Promise<RpcResponseAndContext<GetProgramAccountsResponse>>;
  async getProgramAccounts(
    programId: PublicKey,
    configOrCommitment?: GetProgramAccountsConfig | Commitment,
  ): Promise<GetProgramAccountsResponse>;

  async getProgramAccounts(
    programId: PublicKey,
    configOrCommitment?: GetProgramAccountsConfig | Commitment,
  ): Promise<
    | RpcResponseAndContext<GetProgramAccountsResponse>
    | GetProgramAccountsResponse
  > {
    this.logDebug(`Getting program account data ${programId.toBase58()}`);
    const { config } = this.extractCommitmentFromConfig(configOrCommitment);
    const rows = this.db
      .prepare(
        `
            SELECT
              pubkey,
              owner,
              executable,
              cast (lamports as text) as lamports,
              cast (rent_epoch as text) as rent_epoch,
              account
            FROM ${this.table}
            WHERE owner = ?
        `,
      )
      .all(programId.toBase58()) as {
        pubkey: string;
        owner: string;
        executable: boolean;
        lamports: string;
        rent_epoch: string | null;
        account: Buffer;
      }[];

    let dataSizeFilter: DataSizeFilter | undefined = undefined;
    const memCmpFilters: { offset: number; bytes: Buffer }[] = [];
    if (config && config.filters) {
      for (const filter of config.filters) {
        if (SQLConnection.isDataSizeFilter(filter)) {
          if (dataSizeFilter === undefined) {
            dataSizeFilter = filter;
          } else {
            if (filter.dataSize !== dataSizeFilter.dataSize) {
              this.logWarn(
                `When searching for program id ${programId} data, two size filters with different values provided, ` +
                `using first one data length ${dataSizeFilter.dataSize}`,
              );
            }
          }
        }
        if (SQLConnection.isMemcmpFilter(filter)) {
          memCmpFilters.push({
            offset: filter.memcmp.offset,
            bytes: Buffer.from(base58.decode(filter.memcmp.bytes)),
          });
        }
      }
    }

    const result: Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }> =
      [];
    if (rows) {
      for (const row of rows) {
        // One data size filter check
        if (
          dataSizeFilter !== undefined &&
          row.account.length !== dataSizeFilter.dataSize
        ) {
          continue;
        }
        // All mem-filters have to match
        let shouldInvolve = true;
        for (const memCmpFilter of memCmpFilters) {
          // API: buffer1.compare( targetBuffer, targetStart, targetEnd, sourceStart, sourceEnd )
          if (
            row.account.compare(
              new Uint8Array(memCmpFilter.bytes),
              0,
              memCmpFilter.bytes.length,
              memCmpFilter.offset,
              memCmpFilter.offset + memCmpFilter.bytes.length,
            ) !== 0
          ) {
            shouldInvolve = false;
            break;
          }
        }
        if (!shouldInvolve) {
          continue;
        }
        const accountInfo: AccountInfo<Buffer> = {
          executable: row.executable,
          owner: new PublicKey(row.owner),
          lamports: Number(row.lamports),
          data: row.account,
          rentEpoch: row.rent_epoch ? Number(row.rent_epoch) : undefined,
        };
        result.push({
          pubkey: new PublicKey(row.pubkey),
          account: accountInfo,
        });
      }
    }

    if (
      configOrCommitment &&
      typeof configOrCommitment === 'object' &&
      'withContext' in configOrCommitment &&
      configOrCommitment.withContext === true
    ) {
      return {
        context: { slot: this.slot },
        value: result,
      };
    }
    return result;
  }

  async getParsedProgramAccounts(
    programId: PublicKey,
    configOrCommitment?: GetParsedProgramAccountsConfig | Commitment,
  ): Promise<
    Array<{
      pubkey: PublicKey;
      account: AccountInfo<Buffer | ParsedAccountData>;
    }>
  > {
    const ret = await this.getProgramAccounts(programId, configOrCommitment);
    const mutable: {
      account: AccountInfo<Buffer>;
      /** the account Pubkey as base-58 encoded string */
      pubkey: PublicKey;
    }[] = [];
    ret.forEach((x) => {
      mutable.push({ account: x.account, pubkey: x.pubkey });
    });
    return mutable;
  }

  private extractCommitmentFromConfig<TConfig>(
    commitmentOrConfig?: Commitment | ({ commitment?: Commitment } & TConfig),
  ) {
    let commitment: Commitment | undefined;
    let config: Omit<TConfig, 'commitment'> | undefined;
    if (typeof commitmentOrConfig === 'string') {
      commitment = commitmentOrConfig;
    } else if (commitmentOrConfig) {
      const { commitment: specifiedCommitment, ...specifiedConfig } =
        commitmentOrConfig;
      commitment = specifiedCommitment;
      config = specifiedConfig;
    }
    return { commitment, config };
  }

  private static isDataSizeFilter(
    filter: GetProgramAccountsFilter,
  ): filter is DataSizeFilter {
    return (<DataSizeFilter>filter).dataSize !== undefined;
  }

  private static isMemcmpFilter(
    filter: GetProgramAccountsFilter,
  ): filter is MemcmpFilter {
    return (<MemcmpFilter>filter).memcmp !== undefined;
  }

  private logWarn(message: string): void {
    if (this.logger) {
      this.logger.warn(message);
    } else {
      console.error(message);
    }
  }

  private logDebug(...message: string[]): void {
    if (this.logger) {
      this.logger.debug(message);
    }
  }
}
