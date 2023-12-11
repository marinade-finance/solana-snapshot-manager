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
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
import {
  MANGO_V4_ID,
  MangoClient,
  Group,
} from '@blockworks-foundation/mango-v4';
import { Kamino } from '@hubbleprotocol/kamino-sdk';
import { Wallet } from '@coral-xyz/anchor';
import vaults from 'src/vaults/vaults';
import {
  VAULT_BASE_KEY,
  PROGRAM_ID as METEORA_VAULT_PROGRAM_ID,
} from '@mercurial-finance/vault-sdk/dist/cjs/src/vault/constants';
import {
  VaultState,
  calculateWithdrawableAmount,
  getAmountByShare,
  getVaultPdas,
} from '@mercurial-finance/vault-sdk';
import { SQLConnection } from './sql.connection';
import { KaminoMarket } from '@hubbleprotocol/kamino-lending-sdk';

const enum Source {
  WALLET = 'WALLET',
  ORCA = 'ORCA',
  RAYDIUM_V2 = 'RAYDIUM_V2',
  RAYDIUM_V3 = 'RAYDIUM_V3',
  SOLEND = 'SOLEND',
  TULIP = 'TULIP',
  MERCURIAL_STABLE_SWAP_POOL = 'MERCURIAL_STABLE_SWAP_POOL',
  MERCURIAL_METEORA_VAULTS = 'MERCURIAL_METEORA_VAULTS',
  SABER = 'SABER',
  FRIKTION = 'FRIKTION',
  PORT = 'PORT',
  DRIFT = 'DRIFT',
  MRGN = 'MRGN',
  MANGO = 'MANGO',
  LIFINITY = 'LIFINITY',
  KAMINO = 'KAMINO',
  KAMINO_LENDING = 'KAMINO_LENDING',
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
const TUM_SOL_MINT = '8cn7JcYVjDZesLa3RTt3NXne4WcDw9PdUneQWuByehwW';
const FRIKTION_MINT = '6UA3yn28XecAHLTwoCtjfzy3WcyQj1x13bxnH8urUiKt';
const SABER_MSOL_SUPPLY = 'SoLEao8wTzSfqhuou8rcYsVoLjthVmiXuEjzdNPMnCz';
const SOLEND_MSOL_MINT = '3JFC4cB56Er45nWVe29Bhnn5GnwQzSmHVf6eUq9ac91h';
const SOLEND_RESERVE_ADDR = 'CCpirWrgNuBVLdkP2haxLTbD6XqEgaYuVXixbbpxUB6';
const DRIFT_MSOL_MARKET_ADDR = 'Mr2XZwj1NisUur3WZWdERdqnEUMoa9F9pUr52vqHyqj';
const MRGN_BANK_ADDR = '22DcjMZrMwC5Bpa5AGBsmjc5V9VuQrXG6N9ZtdUNyYGE';
const MANGO_MAINNET_GROUP = '78b8f4cGCwmZ9ysPFMWLaLTkkaYnUjwMJYStWe5RTSSX';

type OrcaTokenAmountSelector = (_: whirlpool.TokenAmounts) => BN;

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
    yield [await this.orcaWhirlpools(db), Source.ORCA];
    yield [await this.raydiumV2(db), Source.RAYDIUM_V2];
    yield [await this.raydiumV3(db), Source.RAYDIUM_V3];
    yield [this.solend(db), Source.SOLEND];
    yield [this.tulip(db), Source.TULIP];
    yield [
      this.mercurial_stable_swap_pool(db),
      Source.MERCURIAL_STABLE_SWAP_POOL,
    ];
    yield [
      await this.mercurial_meteora_vaults(db, slotTimestamp),
      Source.MERCURIAL_METEORA_VAULTS,
    ];
    yield [this.saber(db), Source.SABER];
    yield [this.friktion(db), Source.FRIKTION];
    yield [this.port(db), Source.PORT];
    yield [this.drift(db), Source.DRIFT];
    yield [this.mrgn(db), Source.MRGN];
    yield [this.mango(db), Source.MANGO];
    yield [this.lifinity(db), Source.LIFINITY];
    yield [await this.kamino(db, slot), Source.KAMINO];
    yield [await this.kaminoLending(db, slot), Source.KAMINO_LENDING];
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
    const mercurialStableSwapPoolMint = this.getMercurialStableSwapPoolLps();
    const meteoraVaults = await this.getMercurialMeteoraVaultsLps();
    const mercurialAmmPoolsLps = await this.getMercurialAmmPoolsLps();
    const solend_reserve_info =
      await this.solanaService.connection.getAccountInfo(
        new PublicKey(SOLEND_RESERVE_ADDR),
      );
    if (!solend_reserve_info) {
      throw new Error('Failed to get Solend Reserve Data!');
    }

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
    const mango_bank_deposit_index = await this.getMangoBankIndex();

    return {
      account_owners: SYSTEM_PROGRAM,
      account_mints: [
        MSOL_MINT,
        SOLEND_MSOL_MINT,
        FRIKTION_MINT,
        TUM_SOL_MINT,
        SABER_MSOL_SUPPLY,
        ...raydiumLiquidityPools,
        mercurialStableSwapPoolMint.lp,
        ...meteoraVaults.map((v) => v.lp),
        ...mercurialAmmPoolsLps.map((v) => v.lp),
        ...(await this.getKaminoShareMintsForFilters()),
      ].join(','),
      whirlpool_pool_address: whirlpools
        .map(({ address }) => address)
        .join(','),
      vsr_registrar_data: vsr_registrar_info.data.toString('base64'),
      drift_cumulative_interest:
        drift_cumulative_interest.data.toString('base64'),
      mrgn_bank_data: mrgn_bank_info.data.toString('base64'),
      solend_reserve_data: solend_reserve_info.data.toString('base64'),
      mango_bank_deposit_index: mango_bank_deposit_index,
      meteora_vaults: meteoraVaults.map((v) => v.vault).join(','),
      mercurial_pools: mercurialAmmPoolsLps.map((v) => v.pool).join(','),
    };
  }

  async getVaults(db: SQLite.Database, slot: number): Promise<string[]> {
    const staticVaults = vaults;
    return [...staticVaults, ...(await this.getKaminoVaults(db, slot))];
  }

  async *parse(sqlite: string, slot: number): AsyncGenerator<SnapshotRecord> {
    this.logger.log('Opening the SQLite DB', { sqlite });
    const db = SQLite(sqlite, { readonly: true });

    let mSolParsedAmount = new BN(0);
    const mSolSupply = this.getMintSupply(db, MSOL_MINT);
    if (!mSolSupply) {
      throw new Error('Failed to get mSOL supply!');
    }

    const vaults = await this.getVaults(db, slot);
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

  private async getBlockTime(slot: number): Promise<number | null> {
    return await this.solanaService.connection.getBlockTime(slot);
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

  private async getMangoBankIndex() {
    const MAINNET_GROUP = new PublicKey(MANGO_MAINNET_GROUP);
    const options = AnchorProvider.defaultOptions();
    const adminProvider = new AnchorProvider(
      this.solanaService.connection,
      new Wallet(Keypair.generate()),
      options,
    );
    const client = await MangoClient.connect(
      adminProvider,
      'mainnet-beta',
      MANGO_V4_ID['mainnet-beta'],
    );
    const groupAccount = await client.program.account.group.fetch(
      MAINNET_GROUP,
    );
    const group = Group.from(MAINNET_GROUP, groupAccount);
    await group.reloadBanks(client);
    const msolBanks = group.banksMapByMint.get(MSOL_MINT);
    if (msolBanks && msolBanks[0]) {
      return msolBanks[0].depositIndex.toString();
    }
    return '';
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

  private async orcaWhirlpools(
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

    for (const whirlpoolSnapshot of whirlpoolSnapshots) {
      const whirlpoolMsolSum = new BN(0);
      this.logger.log('processing Orca whirlpool', {
        pubkey: whirlpoolSnapshot.pubkey,
      });
      const { mSolAmountSelector } =
        whirlpools.find(
          (whirlpool) => whirlpool.address === whirlpoolSnapshot.pubkey,
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
        .all(whirlpoolSnapshot.pubkey) as {
        price_lower: string;
        price_upper: string;
        liquidity: string;
        owner: string;
      }[];
      result.forEach((row) => {
        const amounts = whirlpool.PoolUtil.getTokenAmountsFromLiquidity(
          new BN(row.liquidity),
          new BN(whirlpoolSnapshot.sqrt_price),
          new BN(row.price_lower),
          new BN(row.price_upper),
          true,
        );
        whirlpoolMsolSum.iadd(mSolAmountSelector(amounts));
        buf[row.owner] = (buf[row.owner] ?? new BN(0)).add(
          mSolAmountSelector(amounts),
        );
      });
      this.logger.log('Orca whirlpool summed', {
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

  private mango(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Mango');
    const buf: Record<string, BN> = {};
    const result = db
      .prepare(
        `
            SELECT owner, cast(amount as text) as amount
            FROM mango
            ORDER BY amount DESC
        `,
      )
      .all() as { owner: string; amount: string }[];
    result.forEach((row) => {
      buf[row.owner] = (buf[row.owner] ?? new BN(0)).add(new BN(row.amount));
    });
    return buf;
  }

  private getLifinityVaultsAndOwners() {
    // Lifinity owns the 100% share of liquidity in the vaults
    // for sake of simplicity we use hardcoded values here
    // this was discussed with Cerba and Durden ∞ on the discord
    const lifinityTreasury = '71hhezkHQ2dhmPySsHVCCkLggfWzPFEBdfEjbn4NCXMG';
    // TODO: this could be changed when clarified with Durden
    const uxdOwnershipPoolTreasury =
      '71hhezkHQ2dhmPySsHVCCkLggfWzPFEBdfEjbn4NCXMG';
    const result = [
      {
        name: 'mSOL-USDC v1',
        msolVault: 'AymgLAHXAHLuZXqF5h8SxfmvwVQ4VykKhUJda87DUWZe',
        owner: lifinityTreasury,
      },
      {
        name: 'mSOL-UXD v1',
        msolVault: '2u4darckm8R24hZdYQEWDQwMRuQCh1x4zDtEZr74Kiue',
        owner: uxdOwnershipPoolTreasury,
      },
      {
        name: 'mSOL-USDC v2',
        msolVault: '5z4wU1DidgndEk4oJPsKUDyQxRgZpVWrhwVnMAU6XTJE',
        owner: lifinityTreasury,
      },
      {
        name: 'mSOL-USDT v2',
        msolVault: '7GawBqVSriYXQYCTr5XygeRNTeHamRWeHmVFiuf6wLfK',
        owner: lifinityTreasury,
      },
      {
        name: 'MNDE-mSOL v2',
        msolVault: '3TauBEL9fTs531NLKcaFKNr4va4XZmuvGGG13uoyq6BV',
        owner: lifinityTreasury,
      },
    ] as const;
    return result;
  }

  private lifinity(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Lifinity');
    const buf: Record<string, BN> = {};
    const lifinityVaults = this.getLifinityVaultsAndOwners();
    for (const { msolVault, owner } of lifinityVaults) {
      const vaultAmount = this.getTokenAccountBalance(db, msolVault);
      if (!vaultAmount) {
        this.logger.warn('Lifinity mSOL vault missing from DB', {
          msolVault,
          owner,
        });
        continue;
      }
      buf[owner] = (buf[owner] ?? new BN(0)).add(new BN(vaultAmount));
    }
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

  static async getKaminoMsolStrategies(kamino: Kamino) {
    const strategies = await kamino.getAllStrategiesWithFilters({});
    return strategies.filter(
      (x) =>
        x.strategy.tokenAMint.toString() === MSOL_MINT ||
        x.strategy.tokenBMint.toString() === MSOL_MINT,
    );
  }

  private async getKaminoShareMintsForFilters(): Promise<Array<string>> {
    this.solanaService.connection;
    const kamino = new Kamino('mainnet-beta', this.solanaService.connection);
    const msolStrategies = await ParserService.getKaminoMsolStrategies(kamino);
    this.logger.debug('Kamino mSOL vaults', {
      msol_strategies: msolStrategies.length,
      strategy_shares_mints: msolStrategies.map((x) => {
        return {
          addr: x.address.toBase58(),
          mint: x.strategy.sharesMint.toBase58(),
        };
      }),
    });
    return msolStrategies.map((x) => x.strategy.sharesMint.toBase58());
  }

  private async getKaminoVaults(
    db: SQLite.Database,
    slot: number,
  ): Promise<Array<string>> {
    const kamino = this.getKaminoFromDbConnection(db, slot);
    return (await ParserService.getKaminoMsolStrategies(kamino)).flatMap(
      (x) => {
        return x.strategy.tokenAMint.toBase58() == MSOL_MINT
          ? [
              x.strategy.tokenAVault.toBase58(),
              x.strategy.poolTokenVaultA.toBase58(),
            ]
          : [
              x.strategy.tokenBVault.toBase58(),
              x.strategy.poolTokenVaultB.toBase58(),
            ];
      },
    );
  }

  private getKaminoFromDbConnection(db: SQLite.Database, slot: number): Kamino {
    const sqlConnection = new SQLConnection(
      db,
      'raw_accounts',
      slot,
      this.solanaService.connection.rpcEndpoint,
      this.logger,
    );
    return new Kamino('mainnet-beta', sqlConnection);
  }

  private async kamino(
    db: SQLite.Database,
    slot: number,
  ): Promise<Record<string, BN>> {
    this.logger.log('Parsing Kamino');
    const kamino = this.getKaminoFromDbConnection(db, slot);

    const buf: Record<string, BN> = {};
    const msolStrategies = await ParserService.getKaminoMsolStrategies(kamino);
    this.logger.debug('Number of mSOL vaults', {
      msol_strategies: msolStrategies.length,
      strategy_shares_mints: msolStrategies.map((x) => {
        return {
          addr: x.address.toBase58(),
          mint: x.strategy.sharesMint.toBase58(),
        };
      }),
    });
    for (const msolStrategy of msolStrategies) {
      let tokenHoldings;
      try {
        tokenHoldings = await kamino.getStrategyTokensHoldings(msolStrategy);
      } catch (e) {
        this.logger.warn(
          `Failed loading mSOL strategy ${msolStrategy.address.toBase58()}`,
          e,
        );
        continue;
      }
      const mSolsInStrategy = new BN(
        (msolStrategy.strategy.tokenAMint.toString() === MSOL_MINT
          ? tokenHoldings.a
          : tokenHoldings.b
        ).toString(),
      );
      if (
        msolStrategy.strategy.sharesIssued.lte(new BN(0)) ||
        mSolsInStrategy.eqn(0)
      ) {
        // no msol holders here (and let's not divide by zero)
        continue;
      }
      const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(
        db,
        msolStrategy.strategy.sharesMint.toBase58(),
      );

      // --- for tracking purpose to see if we have all the shares for the strategy
      const sharesMintSupply = this.getMintSupply(
        db,
        msolStrategy.strategy.sharesMint.toBase58(),
      );
      if (
        sharesMintSupply === null ||
        !msolStrategy.strategy.sharesIssued.eq(sharesMintSupply)
      ) {
        this.logger.warn(
          `Wrong shares mint supply for strategy: ${msolStrategy.address.toBase58()} ` +
            `mint: ${msolStrategy.strategy.sharesMint.toBase58()} or is not equal ` +
            `${sharesMintSupply && sharesMintSupply.toString()} ` +
            `shares issued ${msolStrategy.strategy.sharesIssued.toString()} ` +
            `, number of token accounts ${tokenAccounts.length}`,
        );
      }
      // ---

      this.logger.log(
        `Kamino strategy: ${msolStrategy.address.toBase58()}, pool: ${msolStrategy.strategy.pool.toBase58()} ` +
          `mSols: ${mlamportsToMsol(mSolsInStrategy)}`,
      );
      tokenAccounts
        .filter((tokenAccount) => new BN(tokenAccount.amount).gtn(0))
        .forEach((tokenAccount) => {
          // (holder qty of ktokens) * (Token A Amounts) / (Shares Issued | Shares Mint token supply) = (mSOL Amount)
          // Token A Amounts is the sum of invested + uninvested amounts
          const holderKTokens = new BN(tokenAccount.amount);
          const holderMSols = holderKTokens
            .mul(mSolsInStrategy)
            .div(msolStrategy.strategy.sharesIssued);
          buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(
            holderMSols,
          );
        });
    }
    return buf;
  }

  static async getKaminoLendingMarketsJson() {
    const response = await fetch('https://api.kamino.finance/kamino-market');
    return await response.json();
  }

  static async getKaminoLendingMarkets(): Promise<string[]> {
    type KaminoLendingMarket = {
      lendingMarket: string;
      isPrimary: boolean;
      name: string;
      description: string;
    };

    const lendingMarkets =
      (await ParserService.getKaminoLendingMarketsJson()) as KaminoLendingMarket[];

    return lendingMarkets.map(
      (market: KaminoLendingMarket) => market.lendingMarket,
    );
  }

  private async loadLendingMarkets(
    markets: PublicKey[],
    connection: Connection,
  ): Promise<Record<string, BN>> {
    const marketsAmounts = await Promise.all(
      markets.map(async (market) => this.loadLending(market, connection)),
    );
    return marketsAmounts
      .flat()
      .reduce<Record<string, BN>>((acc, { owner, amount }) => {
        const existingAmount = acc[owner];
        if (existingAmount) {
          acc[owner] = existingAmount.add(amount);
        } else {
          acc[owner] = amount;
        }
        return acc;
      }, {});
  }

  private async loadLending(
    market: PublicKey,
    connection: Connection,
  ): Promise<{ owner: string; amount: BN }[]> {
    let marketData: KaminoMarket;
    try {
      const loadedMarket = await KaminoMarket.load(connection, market);
      if (loadedMarket === null) {
        throw Error('Market account not fetched');
      }
      marketData = loadedMarket;
      await marketData.loadReserves();
    } catch (e) {
      this.logger.error(
        `Cannot load Kamino Lending market data ${market.toBase58()} ` + e,
      );
      return [];
    }

    const msolReserves = marketData.reserves.filter(
      (reserve) => reserve.state.liquidity.mintPubkey.toBase58() == MSOL_MINT,
    );

    this.logger.debug(
      'loan to value pct',
      msolReserves.map((reserve) => {
        return {
          addr: reserve.address.toBase58(),
          loanPct: reserve.state.config.loanToValuePct,
          symbol: reserve.getTokenSymbol(),
        };
      }),
    );
    this.logger.log(
      'Kamino Lending reserves',
      msolReserves.map((reserve) => {
        return {
          address: reserve.address.toBase58(),
          token: reserve.getTokenSymbol(),
          collateral: reserve.state.collateral.mintTotalSupply.toString(),
          supply: reserve.state.liquidity.availableAmount.toString(),
        };
      }),
      'stats',
      msolReserves.map((reserve) => {
        return {
          totalLiquidity: reserve.stats.totalLiquidity,
          totalSupply: reserve.stats.totalSupply,
          mintTotalSupply: reserve.stats.mintTotalSupply,
          totalBorrows: reserve.stats.totalBorrows,
        };
      }),
    );

    const obligations = await marketData.getAllObligationsForMarket();
    const owners: { owner: string; amount: BN }[] = [];
    for (const reserve of msolReserves) {
      // deposit amounts are denominated in mSOLs
      const ownerToMsol = obligations
        .map((obligation) => {
          const msolDepositAmount: BN = obligation.deposits
            .filter((deposit) => deposit.mintAddress.toString() === MSOL_MINT)
            .map((deposit) => deposit.amount)
            .reduce((a, b) => a.add(new BN(b.toString())), new BN(0));
          return {
            owner: obligation.state.owner.toBase58(),
            amount: msolDepositAmount,
          };
        })
        .filter(({ amount }) => amount.gt(new BN(0)));
      owners.push(...ownerToMsol);
      this.logger.log(
        `Kamino lending reserve ${reserve.address.toBase58()} owner'sum mSOLs ` +
          ownerToMsol.reduce((a, b) => a.add(b.amount), new BN(0)).toString(),
      );
    }
    return owners;
  }

  private async kaminoLending(
    db: SQLite.Database,
    slot: number,
  ): Promise<Record<string, BN>> {
    this.logger.log('Parsing Kamino Lending');

    const markets = (await ParserService.getKaminoLendingMarkets()).map(
      (market) => new PublicKey(market),
    );

    const sqlConnection = new SQLConnection(
      db,
      'raw_accounts',
      slot,
      this.solanaService.connection.rpcEndpoint,
      this.logger,
    );

    return await this.loadLendingMarkets(markets, sqlConnection);
  }

  private getMercurialStableSwapPoolLps() {
    // Mercurial Stable Swap (mSOL-2Pool)
    const result = {
      pool: 'MAR1zHjHaQcniE2gXsDptkyKUnNfMEsLBVcfP7vLyv7',
      lp: '7HqhfUqig7kekN8FbJCtQ36VgdXKriZWQ62rTve9ZmQ',
      vaultMsolAta: 'GM48qFn8rnqhyNMrBHyPJgUVwXQ1JvMbcu3b9zkThW9L',
    } as const;
    this.logger.log('Mercurial Stable Swap pool', { count: 1 });
    return result;
  }

  private mercurial_stable_swap_pool(db: SQLite.Database): Record<string, BN> {
    this.logger.log('Parsing Mercurial Stable Swap Pool');
    const buf: Record<string, BN> = {};

    const { lp, vaultMsolAta } = this.getMercurialStableSwapPoolLps();
    const vaultAmount = this.getTokenAccountBalance(db, vaultMsolAta);
    if (!vaultAmount) {
      this.logger.warn(
        'Mercurial pool mSOL vault token account missing from DB',
        {
          vaultMsolAta,
          lp,
        },
      );
      return buf;
    }

    const lpSupply = this.getMintSupply(db, lp);
    if (!lpSupply) {
      this.logger.warn('Mercurial pool LP mint missing from DB', {
        vaultMsolAta,
        lp,
      });
      return buf;
    }

    this.logger.log('Processing Mercurial liquidity pool', {
      vaultMsolAta,
      lp,
    });

    const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(db, lp);
    tokenAccounts.forEach((tokenAccount) => {
      buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(
        new BN(tokenAccount.amount).mul(vaultAmount).div(lpSupply),
      );
    });

    return buf;
  }

  private async getMercurialMeteoraVaultsJson() {
    // loading meteora shared vaults (msol vault possibly is 8p1VKP45hhqq5iZG5fNGoi7ucme8nFLeChoDWNy7rWFm)
    // in future multiple pools for a token could be configured (mentioned in doc, not clear what other consequences are)
    const response = await fetch(
      'https://merv2-api.mercurial.finance/vault_info',
    );
    return await response.json();
  }

  private async getMercurialMeteoraVaultsLps() {
    type MeteoraVaultJson = {
      symbol: string;
      pubkey: string;
      token_address: string;
      lp_mint: string;
    };

    const vaults = await this.getMercurialMeteoraVaultsJson();

    const msolVault: MeteoraVaultJson[] = vaults
      .filter((vault: MeteoraVaultJson) => vault.token_address === MSOL_MINT)
      .map((vault: MeteoraVaultJson) => {
        return { lp_mint: vault.lp_mint, pubkey: vault.pubkey };
      });
    if (msolVault === undefined || msolVault[0] === undefined) {
      throw new Error('Meteora mSOL vault not found!');
    }
    if (msolVault.length !== 1) {
      throw new Error(
        'Meteora changed to provide multiple MSol vaults, correct VAULT_BASE_KEYs needs to be found!',
      );
    }
    const vaultPdas = getVaultPdas(
      new PublicKey(MSOL_MINT),
      new PublicKey(METEORA_VAULT_PROGRAM_ID),
      VAULT_BASE_KEY,
    );

    this.logger.log('Mercurial Meteora mSol vaults', { count: 1 });
    return [
      {
        lp: msolVault[0].lp_mint,
        vault: msolVault[0].pubkey,
        msolVaultAta: vaultPdas.tokenVaultPda.toBase58(),
      },
    ];
  }

  private async getMercurialAmmPoolsJson() {
    const response = await fetch('https://app.meteora.ag/amm/pools');
    return await response.json();
  }

  private async getMercurialAmmPoolsLps(): Promise<
    { lp: string; pool: string }[]
  > {
    type MeteoraPool = {
      pool_address: string;
      pool_token_mints: string[];
      lp_mint: string;
      pool_name: string;
      pool_version: string;
    };

    const pools = await this.getMercurialAmmPoolsJson();

    const msolPools = pools
      // pools with version 2 uses the vaults
      .filter(
        (pool: MeteoraPool) =>
          pool.pool_token_mints.includes(MSOL_MINT) &&
          Number(pool.pool_version) > 1,
      )
      .map((pool: MeteoraPool) => {
        return { lp: pool.lp_mint, pool: pool.pool_address };
      });
    this.logger.log('Mercurial AMM mSol pools', { count: msolPools.length });
    return msolPools;
  }

  private async mercurial_meteora_vaults(
    db: SQLite.Database,
    snapshotTimestamp: number,
  ): Promise<Record<string, BN>> {
    this.logger.log('Parsing Meteora Vaults');
    const buf: Record<string, BN> = {};

    // vaults should be filtered for mSOL only by getFilters method
    const msolVaults = db
      .prepare(
        `
            SELECT pubkey,
            lp_mint,
            token_vault,
            cast(last_report as text) as last_report,
            cast (locked_profit_degradation as text) as locked_profit_degradation,
            cast (last_updated_locked_profit as text) as last_updated_locked_profit,
            cast (total_amount as text) as total_amount
            FROM meteora_vaults
        `,
      )
      .all() as {
      pubkey: string;
      lp_mint: string;
      token_vault: string;
      last_report: string;
      locked_profit_degradation: string;
      last_updated_locked_profit: string;
      total_amount: string;
    }[];

    const msolPools = db
      .prepare(
        `
            SELECT pubkey, lp_mint, token_a_mint, token_b_mint, a_vault_lp, b_vault_lp
            FROM mercurial_pools
        `,
      )
      .all() as {
      pubkey: string;
      lp_mint: string;
      token_a_mint: string;
      token_b_mint: string;
      a_vault_lp: string;
      b_vault_lp: string;
    }[];
    // this is number of LP tokens for the Meteora mSOL vault
    // that is owned by the particular AMM pool
    const msolPoolsMsolVaults = msolPools
      .map((pool) => {
        if (pool.token_a_mint === MSOL_MINT) {
          return {
            pubkey: pool.pubkey,
            lp: pool.lp_mint,
            msolVaultLPToken: pool.a_vault_lp,
          };
        } else if (pool.token_b_mint === MSOL_MINT) {
          return {
            pubkey: pool.pubkey,
            lp: pool.lp_mint,
            msolVaultLPToken: pool.b_vault_lp,
          };
        } else {
          this.logger.warn("Loaded Mercurial pool doesn't have mSOL", {
            pool,
          });
          return null;
        }
      })
      .filter((pool) => pool !== null) as {
      pubkey: string;
      lp: string;
      msolVaultLPToken: string;
    }[];

    let totalVaultMSOLs = new BN(0);
    for (const dbVault of msolVaults) {
      const lpSupply = this.getMintSupply(db, dbVault.lp_mint);
      if (!lpSupply) {
        this.logger.warn('Mercurial Meteora vault LP mint missing from DB', {
          vault: dbVault.pubkey,
          msol_token_account: dbVault.token_vault,
          lp_mint: dbVault.lp_mint,
        });
        return buf;
      }

      // calculate withdrawable amount, using required data from DB
      // and retyping for Anchor type to use the calculation from SDK
      // see https://github.com/mercurial-finance/vault-sdk/tree/9ea05048146878f5e22549ce270d0e5d6776ccc9/ts-client#install
      const vaultState = {
        lockedProfitTracker: {
          lastReport: new BN(dbVault.last_report),
          lockedProfitDegradation: new BN(dbVault.locked_profit_degradation),
          lastUpdatedLockedProfit: new BN(dbVault.last_updated_locked_profit),
        },
        totalAmount: new BN(dbVault.total_amount),
      };
      totalVaultMSOLs = totalVaultMSOLs.add(vaultState.totalAmount);
      const unlockedAmount = calculateWithdrawableAmount(
        snapshotTimestamp,
        vaultState as unknown as VaultState,
      );

      const getMSOLsByLpShare = (userLpAmount: BN) => {
        return getAmountByShare(userLpAmount, unlockedAmount, lpSupply);
      };

      // 1. parsing user wallets and calculate their share
      const tokenAccounts = this.getSystemOwnedTokenAccountsByMint(
        db,
        dbVault.lp_mint,
      );
      tokenAccounts.forEach((tokenAccount) => {
        buf[tokenAccount.owner] = (buf[tokenAccount.owner] ?? new BN(0)).add(
          getMSOLsByLpShare(new BN(tokenAccount.amount)),
        );
      });

      // 2. checking the rest of lp mint owners expecting they will be the known AMM pools
      // those token accounts are owned by the AMM program and were particularly loaded
      // through getFilters method and processed by marinade-snapshot-etl and returned back here in sqlite db
      // Now, for the every AMM pool we have msol vault, we need to check users of the pool and find their shares
      for (const msolPool of msolPoolsMsolVaults) {
        const poolMsolVaultLpAmount = this.getTokenAccountBalance(
          db,
          msolPool.msolVaultLPToken,
        );
        if (poolMsolVaultLpAmount === null) {
          this.logger.warn(
            'Mercurial AMM pool for mSOL vault missing from DB',
            {
              msolPool,
              vault: dbVault.pubkey,
            },
          );
          continue;
        }
        const mSOLsInPool = getMSOLsByLpShare(poolMsolVaultLpAmount);
        const poolUserLpAccounts = this.getSystemOwnedTokenAccountsByMint(
          db,
          msolPool.lp,
        );
        const poolLpMintSupply = this.getMintSupply(db, msolPool.lp);
        if (poolLpMintSupply === null) {
          this.logger.warn(
            'Mercurial AMM pool for mSOL vault missing lp mint account from DB',
            {
              msolPool,
              vault: dbVault.pubkey,
            },
          );
          continue;
        }
        poolUserLpAccounts.forEach((userLpAccount) => {
          buf[userLpAccount.owner] = (
            buf[userLpAccount.owner] ?? new BN(0)
          ).add(
            new BN(userLpAccount.amount).mul(mSOLsInPool).div(poolLpMintSupply),
          );
        });
      }
    }
    this.logger.debug(
      'Total Meteora Vaults mSOLs',
      mlamportsToMsol(totalVaultMSOLs),
    );

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
        this.logger.warn('Saber pool LP mint missing from DB', { vault, lp });
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
