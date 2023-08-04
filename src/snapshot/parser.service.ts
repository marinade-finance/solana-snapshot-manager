import { Injectable, Logger } from '@nestjs/common';
import SQLite from 'better-sqlite3';
import * as whirlpool from '@orca-so/whirlpools-sdk';
import {
  ApiAmmV3Pools,
  LiquidityMath,
  SqrtPriceMath,
} from '@raydium-io/raydium-sdk';
import BN from 'bn.js';
import {
  DEFAULT_PORT_LENDING_MARKET,
  Environment,
  PortProfileParser,
  PORT_PROFILE_DATA_SIZE,
} from '@port.finance/port-sdk';
import 'isomorphic-fetch';
import { mlamportsToMsol, mndelamportsToMNDE } from 'src/util';
import { SolanaService } from 'src/solana/solana.service';
import { PublicKey } from '@solana/web3.js';

const enum Source {
  WALLET = 'WALLET',
  ORCA = 'ORCA',
  RAYDIUM_V2 = 'RAYDIUM_V2',
  RAYDIUM_V3 = 'RAYDIUM_V3',
  SOLEND = 'SOLEND',
  TULIP = 'TULIP',
  MERCURIAL = 'MERCURIAL',
  SABER = 'SABER',
  FRIKTION = 'FRIKTION',
  PORT = 'PORT',
  DRIFT = 'DRIFT',
  MRGN = 'MRGN',
}

type SnapshotRecord = { pubkey: string; amount: string; source: Source };
type VeMNDESnapshotRecord = { pubkey: string; amount: string };
type NativeStakeSnapshotRecord = { pubkey: string; amount: string };

const VSR_PROGRAM = '5zgEgPbWKsAAnLPjSM56ZsbLPfVM6nUzh3u45tCnm97D';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const MSOL_MINT = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';
const TUM_SOL_MINT = '8cn7JcYVjDZesLa3RTt3NXne4WcDw9PdUneQWuByehwW';
const FRIKTION_MINT = '6UA3yn28XecAHLTwoCtjfzy3WcyQj1x13bxnH8urUiKt';
const SABER_MSOL_SUPPLY = 'SoLEao8wTzSfqhuou8rcYsVoLjthVmiXuEjzdNPMnCz';
const SOLEND_MSOL_MINT = '3JFC4cB56Er45nWVe29Bhnn5GnwQzSmHVf6eUq9ac91h';
const DRIFT_MSOL_MARKET_ADDR = 'Mr2XZwj1NisUur3WZWdERdqnEUMoa9F9pUr52vqHyqj';
const MRGN_BANK_ADDR = '22DcjMZrMwC5Bpa5AGBsmjc5V9VuQrXG6N9ZtdUNyYGE';

type OrcaTokenAmountSelector = (_: whirlpool.TokenAmounts) => BN;

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);

  constructor(private readonly solanaService: SolanaService) {}

  async *parsedRecords(
    db: SQLite.Database,
  ): AsyncGenerator<[Record<string, BN>, Source]> {
    yield [this.mSolHolders(db), Source.WALLET];
    yield [await this.orcaWhrilpools(db), Source.ORCA];
    yield [await this.raydiumV2(db), Source.RAYDIUM_V2];
    yield [await this.raydiumV3(db), Source.RAYDIUM_V3];
    yield [this.solend(db), Source.SOLEND];
    yield [this.tulip(db), Source.TULIP];
    yield [this.mercurial(db), Source.MERCURIAL];
    yield [this.saber(db), Source.SABER];
    yield [this.friktion(db), Source.FRIKTION];
    yield [this.port(db), Source.PORT];
    yield [this.drift(db), Source.DRIFT];
    yield [this.mrgn(db), Source.MRGN];
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
    const whirlpools = await this.getOrcaWhirlpools();
    const raydiumLiquidityPools = (
      await this.getRaydiumLiquidityLpsAndMsolVaults()
    ).map(({ lp }) => lp);
    const mercurialMints = this.getMercurialLpsAndMsolVaults().map(
      ({ lp }) => lp,
    );
    const vsr_registrar_info =
      await this.solanaService.connection.getAccountInfo(
        new PublicKey(VSR_PROGRAM),
      );
    if (!vsr_registrar_info) {
      throw new Error('Failed to get VSR Registrar Data!');
    }
    const drift_cumulative_interest =
      await this.solanaService.connection.getAccountInfo(
        new PublicKey(DRIFT_MSOL_MARKET_ADDR),
        {
          dataSlice: {
            length: 16,
            offset: 464,
          },
        },
      );
    if (!drift_cumulative_interest) {
      throw new Error('Failed to get Drift Cumulative Interest Data!');
    }
    const mrgn_bank_info = await this.solanaService.connection.getAccountInfo(
      new PublicKey(MRGN_BANK_ADDR),
    );
    if (!mrgn_bank_info) {
      throw new Error('Failed to get MRGN Bank Data!');
    }

    return {
      account_owners: SYSTEM_PROGRAM,
      account_mints: [
        MSOL_MINT,
        SOLEND_MSOL_MINT,
        FRIKTION_MINT,
        TUM_SOL_MINT,
        SABER_MSOL_SUPPLY,
        ...raydiumLiquidityPools,
        ...mercurialMints,
      ].join(','),
      whirlpool_pool_address: whirlpools
        .map(({ address }) => address)
        .join(','),
      vsr_registrar_data: vsr_registrar_info.data.toString('base64'),
      drift_cumulative_interest:
        drift_cumulative_interest.data.toString('base64'),
      mrgn_bank_data: mrgn_bank_info.data.toString('base64'),
    };
  }

  async *parse(sqlite: string): AsyncGenerator<SnapshotRecord> {
    this.logger.log('Opening the SQLite DB', { sqlite });
    const db = SQLite(sqlite, { readonly: true });

    let mSolParsedAmount = new BN(0);
    const mSolSupply = this.getMintSupply(db, MSOL_MINT);
    if (!mSolSupply) {
      throw new Error('Failed to get mSOL supply!');
    }

    for await (const [partialRecords, source] of this.parsedRecords(db)) {
      const sum = Object.values(partialRecords).reduce(
        (sum, amount) => sum.add(amount),
        new BN(0),
      );
      mSolParsedAmount = mSolParsedAmount.add(sum);
      this.logger.log('Parsed records received', {
        source,
        sum: mlamportsToMsol(sum),
      });
      for (const [pubkey, amount] of Object.entries(partialRecords)) {
        yield { pubkey, amount: mlamportsToMsol(amount), source };
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
    this.logger.log('Opening the SQLite DB', { sqlite });
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
    this.logger.log('Opening the SQLite DB', { sqlite });
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

  private getMintSupply(db: SQLite.Database, mint: string): BN | null {
    const [record] = db
      .prepare(
        `SELECT cast(supply as text) as supply FROM token_mint WHERE pubkey = ?`,
      )
      .all(mint) as { supply: string }[];

    return record ? new BN(record.supply) : null;
  }

  private getTokenAccountBalance(
    db: SQLite.Database,
    pubkey: string,
  ): BN | null {
    const [record] = db
      .prepare(
        `SELECT cast(amount as text) as amount FROM token_account WHERE pubkey = ?`,
      )
      .all(pubkey) as { amount: string }[];

    return record ? new BN(record.amount) : null;
  }

  private mSolHolders(db: SQLite.Database): Record<string, BN> {
    const buf: Record<string, BN> = {};
    this.logger.log('Parsing mSOL holders');
    const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(db, MSOL_MINT);
    tokenAccounts.forEach((tokenAccount) => {
      buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(
        new BN(tokenAccount.amount),
      );
    });
    return buf;
  }

  private async getOrcaWhirlpools() {
    const response = await fetch(
      'https://api.mainnet.orca.so/v1/whirlpool/list',
    );
    const { whirlpools } = await response.json();
    const mSolWhirlpools: {
      name: string;
      mSolAmountSelector: OrcaTokenAmountSelector;
      address: string;
    }[] = [];
    for (const { tokenA, tokenB, address } of whirlpools) {
      const tokensWithVaultSelectors: [string, OrcaTokenAmountSelector][] = [
        [tokenA.mint, ({ tokenA }) => new BN(tokenA.toString())],
        [tokenB.mint, ({ tokenB }) => new BN(tokenB.toString())],
      ];
      for (const [token, tokenAmountSelector] of tokensWithVaultSelectors) {
        if (token === MSOL_MINT) {
          const name = `${tokenA.symbol}/${tokenB.symbol}`;
          this.logger.log('Whirlpool found', { name, address });
          mSolWhirlpools.push({
            name,
            mSolAmountSelector: tokenAmountSelector,
            address,
          });
        }
      }
    }

    return mSolWhirlpools;
  }

  private async orcaWhrilpools(
    db: SQLite.Database,
  ): Promise<Record<string, BN>> {
    this.logger.log('Parsing Orca Whirlpools');
    const buf: Record<string, BN> = {};

    const whirlpools = await this.getOrcaWhirlpools();

    const whirlpoolSnapshots: {
      pubkey: string;
      token_a: string;
      token_b: string;
      sqrt_price: string;
    }[] = [];
    for (const whirlpool of whirlpools) {
      const [whirlpoolSnapshot] = db
        .prepare(
          `
          SELECT pubkey, token_a, token_b, cast(sqrt_price as text) as sqrt_price
          FROM whirlpool_pools
          WHERE pubkey = ?
      `,
        )
        .all(whirlpool.address) as {
        pubkey: string;
        token_a: string;
        token_b: string;
        sqrt_price: string;
      }[];
      if (whirlpoolSnapshot) {
        whirlpoolSnapshots.push(whirlpoolSnapshot);
      }
    }
    this.logger.log('Orca whirlpools in API', { count: whirlpools.length });
    this.logger.log('Orca whirlpools in DB', {
      count: whirlpoolSnapshots.length,
    });

    for (const whirlpoolSnaphot of whirlpoolSnapshots) {
      const whirlpoolMsolSum = new BN(0);
      this.logger.log('processing Orca whirlpool', {
        pubkey: whirlpoolSnaphot.pubkey,
      });
      const { mSolAmountSelector } =
        whirlpools.find(
          (whirlpool) => whirlpool.address === whirlpoolSnaphot.pubkey,
        ) ?? {};
      if (!mSolAmountSelector) {
        throw new Error('Failed to find the mSol amount selector!');
      }
      const result = db
        .prepare(
          `
            SELECT
              cast(orca.price_lower as text) as price_lower,
              cast(orca.price_upper as text) as price_upper,
              cast(orca.liquidity as text) as liquidity,
              token_account.owner
            FROM orca, token_account
            WHERE orca.position_mint = token_account.mint AND orca.pool = ?
        `,
        )
        .all(whirlpoolSnaphot.pubkey) as {
        price_lower: string;
        price_upper: string;
        liquidity: string;
        owner: string;
      }[];
      result.forEach((row) => {
        const amounts = whirlpool.PoolUtil.getTokenAmountsFromLiquidity(
          new BN(row.liquidity),
          new BN(whirlpoolSnaphot.sqrt_price),
          new BN(row.price_lower),
          new BN(row.price_upper),
          true,
        );
        whirlpoolMsolSum.iadd(mSolAmountSelector(amounts));
        buf[row.owner] = (buf[row.owner] ?? new BN(0)).add(
          mSolAmountSelector(amounts),
        );
      });
      this.logger.log('Orce whirlpool summed', {
        sum: mlamportsToMsol(whirlpoolMsolSum),
      });
    }
    return buf;
  }

  private async getRaydiumLiquidityPools() {
    const response = await fetch(
      'https://api.raydium.io/v2/sdk/liquidity/mainnet.json',
    );
    return await response.json();
  }

  private async getRaydiumLiquidityLpsAndMsolVaults() {
    const pools = await this.getRaydiumLiquidityPools();

    const result: { lp: string; vault: string }[] = [];
    for (const pool of [...pools.official, ...pools.unOfficial]) {
      if (pool.baseMint === MSOL_MINT) {
        result.push({ lp: pool.lpMint, vault: pool.baseVault });
      } else if (pool.quoteMint === MSOL_MINT) {
        result.push({ lp: pool.lpMint, vault: pool.quoteVault });
      }
    }
    this.logger.log('Raydium mSol vaults', { count: result.length });
    return result;
  }

  private async raydiumV2(db: SQLite.Database): Promise<Record<string, BN>> {
    this.logger.log('Parsing Raydium V2');
    const buf: Record<string, BN> = {};

    const liquidityPools = await this.getRaydiumLiquidityLpsAndMsolVaults();

    for (const { lp, vault } of liquidityPools) {
      const vaultAmount = this.getTokenAccountBalance(db, vault);
      if (!vaultAmount) {
        this.logger.warn('Raydium liquidity pool mSOL vault missing from DB', {
          vault,
          lp,
        });
        continue;
      }

      const lpSupply = this.getMintSupply(db, lp);
      if (!lpSupply) {
        this.logger.warn('Raydium liquidity pool LP mint missing from DB', {
          vault,
          lp,
        });
        continue;
      }

      this.logger.log('Processing Raydium liquidity pool', { vault, lp });

      const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(db, lp);
      tokenAccounts.forEach((tokenAccount) => {
        buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(
          new BN(tokenAccount.amount).mul(vaultAmount).div(lpSupply),
        );
      });
    }
    return buf;
  }

  private async getRaydiumV3LiquidityPools(): Promise<ApiAmmV3Pools['data']> {
    const response = await fetch('https://api.raydium.io/v2/ammV3/ammPools');
    const { data } = await response.json();
    return data;
  }

  private async raydiumV3(db: SQLite.Database): Promise<Record<string, BN>> {
    this.logger.log('Parsing Raydium V3');
    const buf: Record<string, BN> = {};

    const amms = db
      .prepare(
        `
          SELECT pubkey, mint1, mint2, vault1, vault2, liquidity, sqrt_price_x64
          FROM raydium_amms
          WHERE mint1 = ? OR mint2 = ?
      `,
      )
      .all(MSOL_MINT, MSOL_MINT) as {
      pubkey: string;
      mint1: string;
      mint2: string;
      vault1: string;
      vault2: string;
      liquidity: string;
      sqrt_price_x64: string;
    }[];

    for (const amm of amms) {
      const mSolVault = amm.mint1 === MSOL_MINT ? amm.vault1 : amm.vault2;
      const mSolVaultBalance = this.getTokenAccountBalance(db, mSolVault);
      this.logger.log('Raydium AMMv3', {
        pubkey: amm.pubkey,
        mSol: mSolVaultBalance ? mlamportsToMsol(mSolVaultBalance) : null,
      });

      if (!mSolVaultBalance) {
        this.logger.warn('Vault not found!');
        continue;
      }

      const positions = db
        .prepare(
          `
            SELECT
              raydium_amm_positions.tick_lower_index,
              raydium_amm_positions.tick_upper_index,
              raydium_amm_positions.liquidity,
              token_account.owner
            FROM raydium_amm_positions, token_account
            WHERE raydium_amm_positions.nft_mint = token_account.mint AND raydium_amm_positions.pool_id = ?
        `,
        )
        .all(amm.pubkey) as {
        tick_lower_index: string;
        tick_upper_index: string;
        liquidity: string;
        owner: string;
      }[];

      let total = new BN(0);
      for (const position of positions) {
        const sqrtPriceX64A = SqrtPriceMath.getSqrtPriceX64FromTick(
          Number(position.tick_lower_index),
        );
        const sqrtPriceX64B = SqrtPriceMath.getSqrtPriceX64FromTick(
          Number(position.tick_upper_index),
        );
        const amounts = LiquidityMath.getAmountsFromLiquidity(
          new BN(amm.sqrt_price_x64),
          sqrtPriceX64A,
          sqrtPriceX64B,
          new BN(position.liquidity),
          false,
        );
        const mSolAmount =
          amm.mint1 === MSOL_MINT ? amounts.amountA : amounts.amountB;
        buf[position.owner] = (buf[position.owner] ?? new BN(0)).add(
          mSolAmount,
        );
        total = total.add(mSolAmount);
      }
      this.logger.log('calculated total amount', {
        total: mlamportsToMsol(total),
        positions: positions.length,
      });
    }
    return buf;
  }

  private solend(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Solend');
    const buf: Record<string, BN> = {};
    const result = db
      .prepare(
        `
            SELECT owner, cast(deposit_amount as text) as deposit_amount
            FROM Solend
            ORDER BY deposit_amount DESC
        `,
      )
      .all() as { owner: string; deposit_amount: string }[];
    result.forEach((row) => {
      buf[row.owner] = (buf[row.owner] ?? new BN(0)).add(
        new BN(row.deposit_amount),
      );
    });
    return buf;
  }

  private drift(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Drift');
    const buf: Record<string, BN> = {};
    const result = db
      .prepare(
        `
            SELECT owner, cast(amount as text) as amount
            FROM drift
            ORDER BY amount DESC
        `,
      )
      .all() as { owner: string; amount: string }[];
    result.forEach((row) => {
      buf[row.owner] = (buf[row.owner] ?? new BN(0)).add(new BN(row.amount));
    });
    return buf;
  }

  private mrgn(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing MRGN');
    const buf: Record<string, BN> = {};
    const result = db
      .prepare(
        `
            SELECT owner, cast(amount as text) as amount
            FROM mrgn
            ORDER BY amount DESC
        `,
      )
      .all() as { owner: string; amount: string }[];
    result.forEach((row) => {
      buf[row.owner] = (buf[row.owner] ?? new BN(0)).add(new BN(row.amount));
    });
    return buf;
  }

  private tulip(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Tulip');
    const buf: Record<string, BN> = {};
    const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(
      db,
      TUM_SOL_MINT,
    );
    tokenAccounts.forEach((tokenAccount) => {
      buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(
        new BN(tokenAccount.amount),
      );
    });
    return buf;
  }

  private getMercurialLpsAndMsolVaults() {
    return [
      {
        lp: 'B2uEs9zjnz222hfUaUuRgesryUEYwy3JGuWe31sE9gsG',
        vault: '3ifhD4Ywaa8aBZAaQSqYgN4Q1kaFArioLU8uumJMaqkE',
      },
      {
        lp: '7HqhfUqig7kekN8FbJCtQ36VgdXKriZWQ62rTve9ZmQ',
        vault: 'GM48qFn8rnqhyNMrBHyPJgUVwXQ1JvMbcu3b9zkThW9L',
      },
    ] as const;
  }

  private mercurial(db: SQLite.Database): Record<string, BN> {
    // https://app.meteora.ag/amm/pools
    this.logger.log('Parsing Mercurial');
    const buf: Record<string, BN> = {};

    for (const { lp, vault } of this.getMercurialLpsAndMsolVaults()) {
      const vaultAmount = this.getTokenAccountBalance(db, vault);
      if (!vaultAmount) {
        this.logger.warn('Mercurial pool mSOL vault missing from DB', {
          vault,
          lp,
        });
        continue;
      }

      const lpSupply = this.getMintSupply(db, lp);
      if (!lpSupply) {
        this.logger.warn('Mercurial pool LP mint missing from DB', {
          vault,
          lp,
        });
        continue;
      }

      this.logger.log('Processing Mercurial liquidity pool', { vault, lp });

      const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(db, lp);
      tokenAccounts.forEach((tokenAccount) => {
        buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(
          new BN(tokenAccount.amount).mul(vaultAmount).div(lpSupply),
        );
      });
    }

    return buf;
  }

  private saber(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Saber');
    const buf: Record<string, BN> = {};

    const vaults = [
      {
        lp: SABER_MSOL_SUPPLY,
        vault: '9DgFSWkPDGijNKcLGbr3p5xoJbHsPgXUTr6QvGBJ5vGN',
      },
    ] as const;

    for (const { lp, vault } of vaults) {
      const vaultAmount = this.getTokenAccountBalance(db, vault);
      if (!vaultAmount) {
        this.logger.warn('Saber pool mSOL vault missing from DB', {
          vault,
          lp,
        });
        continue;
      }

      const lpSupply = this.getMintSupply(db, lp);
      if (!lpSupply) {
        this.logger.warn('Seber pool LP mint missing from DB', { vault, lp });
        continue;
      }

      const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(
        db,
        SABER_MSOL_SUPPLY,
      );
      tokenAccounts.forEach((tokenAccount) => {
        buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(
          new BN(tokenAccount.amount).mul(vaultAmount).div(lpSupply),
        );
      });
    }
    return buf;
  }

  private friktion(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Friktion');
    const buf: Record<string, BN> = {};
    const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(
      db,
      FRIKTION_MINT,
    );
    tokenAccounts.forEach((tokenAccount: any) => {
      buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(
        new BN(tokenAccount.amount),
      );
    });
    return buf;
  }

  private port(db: SQLite.Database): Record<string, BN> {
    const MSOL_DEPOSIT_RESERVE = '9gDF5W94RowoDugxT8cM29cX8pKKQitTp2uYVrarBSQ7';
    this.logger.log('Parsing Port');
    const buf: Record<string, BN> = {};
    const result = db.prepare(`SELECT pubkey, owner, data FROM port`).all() as {
      pubkey: string;
      owner: string;
      data: Buffer;
    }[];
    result.forEach((row) => {
      const profile = PortProfileParser(row.data);
      if (
        profile.lendingMarket.toBase58() !==
          DEFAULT_PORT_LENDING_MARKET.toBase58() ||
        row.data.length !== PORT_PROFILE_DATA_SIZE ||
        row.owner !== Environment.forMainNet().getLendingProgramPk().toBase58()
      ) {
        return;
      }
      profile.deposits.forEach((deposit) => {
        if (deposit.depositReserve.toBase58() === MSOL_DEPOSIT_RESERVE) {
          buf[profile.owner.toBase58()] = (
            buf[profile.owner.toBase58()] ?? new BN(0)
          ).add(new BN(deposit.depositedAmount.toU64().toString()));
        }
      });
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
