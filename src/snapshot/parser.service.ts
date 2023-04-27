import { Injectable, Logger } from '@nestjs/common';
import SQLite from 'better-sqlite3';
import * as whirlpool from '@orca-so/whirlpools-sdk';
import orca from '@orca-so/common-sdk';
import BN from 'bn.js';

import { PortProfileParser } from '@port.finance/port-sdk';
import 'isomorphic-fetch';
import { mlamportsToMsol } from 'src/util';

const enum Source {
  WALLET = 'WALLET',
  ORCA = 'ORCA',
  ORCA_AQUAFARMS = 'ORCA_AQUAFARMS',
  RAYDIUM_V2 = 'RAYDIUM_V2',
  SOLEND = 'SOLEND',
  TULIP = 'TULIP',
  MERCURIAL = 'MERCURIAL',
  SABER = 'SABER',
  FRIKTION = 'FRIKTION',
  PORT = 'PORT',
}

type SnapshotRecord = { pubkey: string; amount: string; source: Source };

const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const MSOL_MINT = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'
const TUM_SOL_MINT = '8cn7JcYVjDZesLa3RTt3NXne4WcDw9PdUneQWuByehwW'
const FRIKTION_MINT = '6UA3yn28XecAHLTwoCtjfzy3WcyQj1x13bxnH8urUiKt'
const SABER_MSOL_SUPPLY = 'SoLEao8wTzSfqhuou8rcYsVoLjthVmiXuEjzdNPMnCz'
const SOLEND_MSOL_MINT = '3JFC4cB56Er45nWVe29Bhnn5GnwQzSmHVf6eUq9ac91h'

type OrcaTokenAmountSelector = (_: whirlpool.TokenAmounts) => BN;

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);

  async *parsedRecords(
    db: SQLite.Database,
  ): AsyncGenerator<[Record<string, BN>, Source]> {
    yield [this.mSolHolders(db), Source.WALLET];
    yield [await this.orcaWhrilpools(db), Source.ORCA];
    yield [await this.raydiumV2(db), Source.RAYDIUM_V2]; // production check, filters check
    yield [this.solend(db), Source.SOLEND];
    yield [this.tulip(db), Source.TULIP];
    yield [this.mercurial(db), Source.MERCURIAL]; // production check, filter check
    yield [this.saber(db), Source.SABER]; // production check, filters check
    yield [this.friktion(db), Source.FRIKTION];
    yield [this.port(db), Source.PORT];
    // raydium AMMs
  }

  async getFilters() {
    const whirlpools = await this.getOrcaWhirlpools()
    const raydiumLiquidityPools = (await this.getRaydiumLiquidityLpsAndMsolVaults()).map(({ lp }) => lp)
    const mercurialMints = this.getMercurialLpsAndMsolVaults().map(({ lp }) => lp)

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
      whirlpool_pool_address: whirlpools.map(({ address }) => address).join(',')
    }
  }

  async *parse(sqlite: string): AsyncGenerator<SnapshotRecord> {
    this.logger.log('Opening the SQLite DB', { sqlite });
    const db = SQLite(sqlite, { readonly: true });
    let totalMsol = new BN(0)

    for await (const [partialRecords, source] of this.parsedRecords(db)) {
      const sum = Object.values(partialRecords).reduce(
        (sum, amount) => sum.add(amount),
        new BN(0),
      );
      totalMsol = totalMsol.add(sum)
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
      totalMsol: mlamportsToMsol(totalMsol),
    });

    db.close();
  }

  private getSystemOwnedTokenAccountsByMint(db: SQLite.Database, mint: string): { owner: string, amount: string, pubkey: string }[] {
    return db
      .prepare(
        `
          SELECT token_account.owner, cast(token_account.amount as text) as amount, account.pubkey
          FROM token_account, account
          WHERE token_account.mint = ? AND token_account.owner = account.pubkey AND account.owner = ? AND token_account.amount > 0
          ORDER BY token_account.amount DESC
        `,
      )
      .all([mint, SYSTEM_PROGRAM]) as { owner: string, amount: string, pubkey: string }[];
  }

  private mSolHolders(db: SQLite.Database): Record<string, BN> {
    const buf: Record<string, BN> = {};
    this.logger.log('Parsing mSOL holders');
    const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(db, MSOL_MINT)
    tokenAccounts.forEach((tokenAccount) => {
      buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(new BN(tokenAccount.amount));
    });
    return buf;
  }

  private async getOrcaWhirlpools() {
    const response = await fetch('https://api.mainnet.orca.so/v1/whirlpool/list');
    const { whirlpools } = await response.json();
    const mSolWhirlpools: {
      name: string;
      mSolAmountSelector: OrcaTokenAmountSelector;
      address: string;
    }[] = [];
    for (const { tokenA, tokenB, address } of whirlpools) {
      const tokensWithVaultSelectors: [String, OrcaTokenAmountSelector][] = [
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

    return mSolWhirlpools
  }

  private async orcaWhrilpools(db: SQLite.Database): Promise<Record<string, BN>> {
    this.logger.log('Parsing Orca Whirlpools');
    const buf: Record<string, BN> = {};

    const whirlpools = await this.getOrcaWhirlpools()

    const whirlpoolSnapshots: { pubkey: string, token_a: string, token_b: string, sqrt_price: string }[] = []
    for (const whirlpool of whirlpools) {
      const [whirlpoolSnapshot] = db
        .prepare(
          `
          SELECT pubkey, token_a, token_b, cast(sqrt_price as text) as sqrt_price
          FROM whirlpool_pools
          WHERE pubkey = ?
      `,
        )
        .all(whirlpool.address) as { pubkey: string, token_a: string, token_b: string, sqrt_price: string }[];
      if (whirlpoolSnapshot) {
        whirlpoolSnapshots.push(whirlpoolSnapshot)
      }
    }
    this.logger.log('Orca whirlpools in API', { count: whirlpools.length })
    this.logger.log('Orca whirlpools in DB', { count: whirlpoolSnapshots.length })

    for (const whirlpoolSnaphot of whirlpoolSnapshots) {
      let whirlpoolMsolSum = new BN(0)
      this.logger.log('processing Orca whirlpool', { pubkey: whirlpoolSnaphot.pubkey })
      const { mSolAmountSelector } = whirlpools.find((whirlpool) => whirlpool.address === whirlpoolSnaphot.pubkey) ?? {}
      if (!mSolAmountSelector) {
        throw new Error('Failed to find the mSol amount selector!')
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
        .all(whirlpoolSnaphot.pubkey) as { price_lower: string, price_upper: string, liquidity: string, owner: string }[];
      result.forEach((row) => {
        const amounts = whirlpool.PoolUtil.getTokenAmountsFromLiquidity(
          new BN(row.liquidity),
          new BN(whirlpoolSnaphot.sqrt_price),
          new BN(row.price_lower),
          new BN(row.price_upper),
          true,
        );
        whirlpoolMsolSum.iadd(mSolAmountSelector(amounts))
        buf[row.owner] =
          (buf[row.owner] ?? new BN(0)).add(mSolAmountSelector(amounts))
      });
      this.logger.log('Orce whirlpool summed', { sum: mlamportsToMsol(whirlpoolMsolSum) })
    }
    return buf;
  }

  private async getRaydiumLiquidityPools() {
    const response = await fetch('https://api.raydium.io/v2/sdk/liquidity/mainnet.json')
    return await response.json()
  }

  private async getRaydiumLiquidityLpsAndMsolVaults() {
    const pools = await this.getRaydiumLiquidityPools()

    const result: { lp: string, vault: string }[] = []
    for (const pool of [...pools.official, ...pools.unOfficial]) {
      if (pool.baseMint === MSOL_MINT) {
        result.push({ lp: pool.lpMint, vault: pool.baseVault })
      } else if (pool.quoteMint === MSOL_MINT) {
        result.push({ lp: pool.lpMint, vault: pool.quoteVault })
      }
    }
    this.logger.log('Raydium mSol vaults', { count: result.length })
    return result
  }

  private async raydiumV2(db: SQLite.Database): Promise<Record<string, BN>> {
    this.logger.log(new Date().toISOString() + ' Parsing Raydium V2');
    const buf: Record<string, BN> = {};

    const liquidityPools = await this.getRaydiumLiquidityLpsAndMsolVaults()

    for (const { lp, vault } of liquidityPools) {
      const [vaultAmountRecord] = db
        .prepare(`SELECT cast(amount as text) as amount FROM token_account WHERE pubkey = ?`)
        .all(vault) as { amount: string }[]
      if (!vaultAmountRecord) {
        this.logger.warn('Raydium liquidity pool mSOL vault missing from DB', { vault, lp })
        continue
      }

      const [lpSupplyRecord] = db
        .prepare(`SELECT cast(supply as text) as supply FROM token_mint WHERE pubkey = ?`)
        .all(lp) as { supply: string }[]

      if (!lpSupplyRecord) {
        this.logger.warn('Raydium liquidity pool LP mint missing from DB', { vault, lp })
        continue
      }

      this.logger.log('Processing Raydium liquidity pool', { vault, lp })

      const vaultAmount = vaultAmountRecord.amount
      const lpSupply = lpSupplyRecord.supply

      const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(db, lp)
      tokenAccounts.forEach((tokenAccount) => {
        buf[tokenAccount.owner] =
          (buf[tokenAccount.owner] ?? new BN(0)).add(new BN(tokenAccount.amount).mul(new BN(vaultAmount)).div(new BN(lpSupply)));
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
      .all() as { owner: string, deposit_amount: string }[];
    result.forEach((row) => {
      buf[row.owner] = (buf[row.owner] ?? new BN(0)).add(new BN(row.deposit_amount));
    });
    return buf;
  }

  private tulip(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Tulip');
    const buf: Record<string, BN> = {};
    const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(db, TUM_SOL_MINT)
    tokenAccounts.forEach((tokenAccount) => {
      buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(new BN(tokenAccount.amount));
    });
    return buf;
  }

  private getMercurialLpsAndMsolVaults() {
    return [
      { lp: 'B2uEs9zjnz222hfUaUuRgesryUEYwy3JGuWe31sE9gsG', vault: '3ifhD4Ywaa8aBZAaQSqYgN4Q1kaFArioLU8uumJMaqkE' },
      { lp: '7HqhfUqig7kekN8FbJCtQ36VgdXKriZWQ62rTve9ZmQ', vault: 'EWy2hPdVT4uGrYokx65nAyn2GFBv7bUYA2pFPY96pw7Y' },
    ] as const
  }

  private mercurial(db: SQLite.Database): Record<string, BN> {
    // https://app.meteora.ag/amm/pools
    this.logger.log('Parsing Mercurial');
    const buf: Record<string, BN> = {};

    for (const { lp, vault } of this.getMercurialLpsAndMsolVaults()) {
      const [vaultAmountRecord] = db
        .prepare(`SELECT cast(amount as text) as amount FROM token_account WHERE pubkey = ?`)
        .all(vault) as { amount: string }[]
      if (!vaultAmountRecord) {
        this.logger.warn('Mercurial pool mSOL vault missing from DB', { vault, lp })
        continue
      }

      const [lpSupplyRecord] = db
        .prepare(`SELECT cast(supply as text) as supply FROM token_mint WHERE pubkey = ?`)
        .all(lp) as { supply: string }[]

      if (!lpSupplyRecord) {
        this.logger.warn('Mercurial pool LP mint missing from DB', { vault, lp })
        continue
      }

      this.logger.log('Processing Mercurial liquidity pool', { vault, lp })

      const vaultAmount = vaultAmountRecord.amount
      const lpSupply = lpSupplyRecord.supply

      const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(db, lp)
      tokenAccounts.forEach((tokenAccount) => {
        buf[tokenAccount.owner] =
          (buf[tokenAccount.owner] ?? new BN(0)).add(new BN(tokenAccount.amount).mul(new BN(vaultAmount)).div(new BN(lpSupply)));
      });
    }

    return buf;
  }

  private saber(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Saber');
    const buf: Record<string, BN> = {};

    const vaults = [
      { lp: SABER_MSOL_SUPPLY, vault: '9DgFSWkPDGijNKcLGbr3p5xoJbHsPgXUTr6QvGBJ5vGN' },
    ] as const

    for (const { lp, vault } of vaults) {
      const [vaultAmountRecord] = db
        .prepare(`SELECT cast(amount as text) as amount FROM token_account WHERE pubkey = ?`)
        .all(vault) as { amount: string }[]
      if (!vaultAmountRecord) {
        this.logger.warn('Saber pool mSOL vault missing from DB', { vault, lp })
        continue
      }

      const [lpSupplyRecord] = db
        .prepare(`SELECT cast(supply as text) as supply FROM token_mint WHERE pubkey = ?`)
        .all(lp) as { supply: string }[]

      if (!lpSupplyRecord) {
        this.logger.warn('Seber pool LP mint missing from DB', { vault, lp })
        continue
      }

      const vaultAmount = vaultAmountRecord.amount
      const lpSupply = lpSupplyRecord.supply

      const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(db, SABER_MSOL_SUPPLY)
      tokenAccounts.forEach((tokenAccount) => {
        buf[tokenAccount.owner] =
          (buf[tokenAccount.owner] ?? new BN(0)).add(new BN(tokenAccount.amount).mul(new BN(vaultAmount)).div(new BN(lpSupply)));
      });
    }
    return buf;
  }

  private friktion(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Friktion');
    const buf: Record<string, BN> = {};
    const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(db, FRIKTION_MINT)
    tokenAccounts.forEach((tokenAccount: any) => {
      buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(new BN(tokenAccount.amount));
    });
    return buf;
  }

  private port(db: SQLite.Database): Record<string, BN> {
    const DEPOSIT_RESERVE = '9gDF5W94RowoDugxT8cM29cX8pKKQitTp2uYVrarBSQ7'

    this.logger.log('Parsing Port');
    const buf: Record<string, BN> = {};
    const result = db.prepare(`SELECT pubkey, owner, data FROM port`).all();
    result.forEach((row: any) => {
      const profile = PortProfileParser(row.data);
      profile.deposits.forEach((deposit) => {
        if (deposit.depositReserve.toBase58() === DEPOSIT_RESERVE) {
          buf[profile.owner.toBase58()] =
            (buf[profile.owner.toBase58()] ?? new BN(0)).add(new BN(deposit.depositedAmount.toU64().toString()));
        }
      });
    });
    return buf;
  }
}
