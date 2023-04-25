import { Injectable, Logger } from '@nestjs/common';
import SQLite from 'better-sqlite3';
import whirlpool from '@orca-so/whirlpools-sdk';
import orca from '@orca-so/common-sdk';
import BN from 'bn.js';
import { PortProfileParser } from '@port.finance/port-sdk';

const MSOL_DECIMALS = 9;
const msolToUi = (amount: number) =>
  (amount / 10 ** MSOL_DECIMALS).toFixed(MSOL_DECIMALS);

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

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);

  *parsedRecords(
    db: SQLite.Database,
  ): Generator<[Record<string, number>, Source]> {
    yield [this.mSolHolders(db), Source.WALLET];
    // yield [this.orcaWhrilpools(db), Source.ORCA];
    // yield [this.orcaAquafarms(db), Source.ORCA_AQUAFARMS];
    yield [this.raydiumV2(db), Source.RAYDIUM_V2];
    yield [this.solend(db), Source.SOLEND];
    yield [this.tulip(db), Source.TULIP];
    yield [this.mercurial(db), Source.MERCURIAL];
    // yield [this.saber(db), Source.SABER];
    // yield [this.friktion(db), Source.FRIKTION];
    // yield [this.port(db), Source.PORT];
  }

  async *parse(sqlite: string): AsyncGenerator<SnapshotRecord> {
    this.logger.log('Opening the SQLite DB', { sqlite });
    const db = SQLite(sqlite, { readonly: true });

    for (const [partialRecords, source] of this.parsedRecords(db)) {
      const sum = Object.values(partialRecords).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      this.logger.log('Parsed records received', {
        source,
        sum: msolToUi(sum),
      });
      for (const [pubkey, amount] of Object.entries(partialRecords)) {
        yield { pubkey, amount: msolToUi(amount), source };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    db.close();
  }

  private mSolHolders(db: SQLite.Database): Record<string, number> {
    const buf: Record<string, number> = {};
    console.info(new Date().toISOString() + ' Parsing mSOL holders');
    const result = db
      .prepare(
        `
            SELECT token_account.owner, token_account.amount, account.pubkey
            FROM token_account, account
            WHERE token_account.mint = ? AND token_account.owner = account.pubkey AND account.owner = ? AND token_account.amount > 0
            ORDER BY token_account.amount desc
        `,
      )
      .all([
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
        '11111111111111111111111111111111',
      ]);
    result.forEach((row: any) => {
      buf[row.owner] = (buf[row.owner] ?? 0) + row.amount;
    });
    return buf;
  }

  private orcaWhrilpools(db: SQLite.Database) {
    console.info(new Date().toISOString() + ' Parsing Orca Whirlpools');
    const buf: Record<string, number> = {};

    const whirlpool_msol_usdc: any = db
      .prepare(
        `
            SELECT token_a, token_b, sqrt_price
            FROM whirlpool_pools
            WHERE pubkey = ?
        `,
      )
      .all('AiMZS5U3JMvpdvsr1KeaMiS354Z1DeSg5XjA4yYRxtFf');
    const result = db
      .prepare(
        `
            SELECT orca.price_lower, orca.price_upper, orca.liquidity, token_account.owner
            FROM orca, token_account
            WHERE orca.position_mint = token_account.mint AND orca.pool = ?
        `,
      )
      .all('AiMZS5U3JMvpdvsr1KeaMiS354Z1DeSg5XjA4yYRxtFf');
    result.forEach((row: any) => {
      const amounts = whirlpool.PoolUtil.getTokenAmountsFromLiquidity(
        new BN(row.liquidity),
        new BN(whirlpool_msol_usdc[0].sqrt_price),
        new BN(row.price_lower),
        new BN(row.price_upper),
        true,
      );

      buf[row.owner] =
        (buf[row.owner] ?? 0) + (amounts.tokenA as any).toNumber();
    });
    return buf;
  }

  private orcaAquafarms(db: SQLite.Database) {
    console.info(new Date().toISOString() + ' Parsing Orca Aquafarms');
    const buf: Record<string, number> = {};

    const mSOL_USDT_supply =
      (
        db
          .prepare(`SELECT supply FROM token_mint WHERE pubkey= ?`)
          .all('Afvh7TWfcT1E9eEEWJk17fPjnqk36hreTJJK5g3s4fm8')[0] as any
      )?.supply * Math.pow(10, -6); //Orca Aquafarm mSOL-USDT
    const mSOL_in_liq_USDT =
      (
        db
          .prepare(`SELECT amount FROM token_account WHERE pubkey= ?`)
          .all('RTXKRxghfWJpE344UG7UhKnCwN2Gyv6KnNSTFDnaASF')[0] as any
      )?.amount * Math.pow(10, -9); //Orca Aquafarm mSOL-USDT token account which hold mSOL
    const mSOL_per_LP_USDT = mSOL_in_liq_USDT / mSOL_USDT_supply;
    const result = db
      .prepare(
        `SELECT token_account.owner, token_account.amount, account.pubkey FROM token_account, account WHERE token_account.mint= ? AND token_account.owner=account.pubkey AND account.owner= ? AND token_account.amount>0 ORDER BY token_account.amount desc`,
      )
      .all([
        'Afvh7TWfcT1E9eEEWJk17fPjnqk36hreTJJK5g3s4fm8',
        '11111111111111111111111111111111',
      ]); //Orca Aquafarm mSOL-USDT & system program
    const resultDoubleDip = db
      .prepare(
        `SELECT token_account.owner, token_account.amount, account.pubkey FROM token_account, account WHERE token_account.mint= ? AND token_account.owner=account.pubkey AND account.owner= ? AND token_account.amount>0 ORDER BY token_account.amount desc`,
      )
      .all([
        '7iKG16aukdXXw43MowbfrGqXhAoYe51iVR9u2Nf2dCEY',
        '11111111111111111111111111111111',
      ]); //Orca Double Dip mSOL-USDT & system program
    result.forEach((row: any) => {
      buf[row.owner] =
        (buf[row.owner] ?? 0) + Math.round(row.amount * mSOL_per_LP_USDT);
    });
    resultDoubleDip.forEach((row: any) => {
      buf[row.owner] = (buf[row.owner] ?? 0) + row.amount;
    });
    return buf;
  }

  private raydiumV2(db: SQLite.Database) {
    console.info(new Date().toISOString() + ' Parsing Raydium V2');
    const buf: Record<string, number> = {};

    const mSOL_USDC_supply = (
      db
        .prepare(`SELECT supply FROM token_mint WHERE pubkey= ?`)
        .all('4xTpJ4p76bAeggXoYywpCCNKfJspbuRzZ79R7pRhbqSf')[0] as any
    )?.supply; //Raydium V2 mSOL-USDC
    const mSOL_in_liq_USDC = (
      db
        .prepare(`SELECT amount FROM token_account WHERE pubkey= ?`)
        .all('8JUjWjAyXTMB4ZXcV7nk3p6Gg1fWAAoSck7xekuyADKL')[0] as any
    )?.amount; //Raydium V2 mSOL-USDC token account which hold mSOL
    const mSOL_per_LP_USDC = mSOL_in_liq_USDC / mSOL_USDC_supply;

    const result = db
      .prepare(
        `SELECT token_account.owner, token_account.amount, account.pubkey FROM token_account, account WHERE token_account.mint= ? AND token_account.owner=account.pubkey AND account.owner= ? AND token_account.amount>0 ORDER BY token_account.amount desc`,
      )
      .all([
        '4xTpJ4p76bAeggXoYywpCCNKfJspbuRzZ79R7pRhbqSf',
        '11111111111111111111111111111111',
      ]); //Raydium V2 mSOL-USDC & system program
    result.forEach((row: any) => {
      buf[row.owner] =
        (buf[row.owner] ?? 0) + Math.round(row.amount * mSOL_per_LP_USDC);
    });

    const mSOL_SOL_supply = (
      db
        .prepare(`SELECT supply FROM token_mint WHERE pubkey = ?`)
        .all('5ijRoAHVgd5T5CNtK5KDRUBZ7Bffb69nktMj5n6ks6m4')[0] as any
    )?.supply; //Raydium V2 mSOL-SOL
    const mSOL_in_liq_SOL = (
      db
        .prepare(`SELECT amount FROM token_account WHERE pubkey = ?`)
        .all('85SxT7AdDQvJg6pZLoDf7vPiuXLj5UYZLVVNWD1NjnFK')[0] as any
    )?.amount; //Raydium V2 mSOL-SOL token account which hold mSOL
    const mSOL_per_LP_SOL = mSOL_in_liq_SOL / mSOL_SOL_supply;

    const result2 = db
      .prepare(
        `
            SELECT token_account.owner, token_account.amount, account.pubkey
            FROM token_account, account WHERE token_account.mint = ? AND token_account.owner = account.pubkey AND account.owner = ? AND token_account.amount > 0
            ORDER BY token_account.amount DESC
        `,
      )
      .all([
        '5ijRoAHVgd5T5CNtK5KDRUBZ7Bffb69nktMj5n6ks6m4',
        '11111111111111111111111111111111',
      ]); //Raydium V2 mSOL-SOL & system program
    result2.forEach((row: any) => {
      buf[row.owner] =
        (buf[row.owner] ?? 0) + Math.round(row.amount * mSOL_per_LP_SOL);
    });
    return buf;
  }

  private solend(db: SQLite.Database) {
    console.info(new Date().toISOString() + ' Parsing Solend');
    const buf: Record<string, number> = {};
    const result = db
      .prepare(
        `
            SELECT owner, deposit_amount
            FROM Solend
            ORDER BY deposit_amount DESC
        `,
      )
      .all();
    result.forEach((row: any) => {
      buf[row.owner] = (buf[row.owner] ?? 0) + row.deposit_amount;
    });
    return buf;
  }

  private tulip(db: SQLite.Database) {
    console.info(new Date().toISOString() + ' Parsing Tulip');
    const buf: Record<string, number> = {};
    const result = db
      .prepare(
        `
            SELECT token_account.owner, token_account.amount, account.pubkey
            FROM token_account, account
            WHERE token_account.mint = ? AND token_account.owner = account.pubkey AND account.owner = ? AND token_account.amount > 0
            ORDER BY token_account.amount DESC
        `,
      )
      .all([
        '8cn7JcYVjDZesLa3RTt3NXne4WcDw9PdUneQWuByehwW',
        '11111111111111111111111111111111',
      ]); //tumSOL address & system program address
    result.forEach((row: any) => {
      buf[row.owner] = (buf[row.owner] ?? 0) + row.amount;
    });
    return buf;
  }

  private mercurial(db: SQLite.Database) {
    console.info(new Date().toISOString() + ' Parsing Mercurial');
    const buf: Record<string, number> = {};

    const mSOL_2Pool_supply = (
      db
        .prepare(`SELECT supply FROM token_mint WHERE pubkey= ?`)
        .all('7HqhfUqig7kekN8FbJCtQ36VgdXKriZWQ62rTve9ZmQ')[0] as any
    )?.supply; //Mercurial mSOL-2Pool
    const mSOL_in_liq = (
      db
        .prepare(`SELECT amount FROM token_account WHERE pubkey= ?`)
        .all('GM48qFn8rnqhyNMrBHyPJgUVwXQ1JvMbcu3b9zkThW9L')[0] as any
    )?.amount; //Mercurial mSOL-2Pool token account which hold mSOL
    const mSOL_per_LP = mSOL_in_liq / mSOL_2Pool_supply;
    const result = db
      .prepare(
        `
            SELECT token_account.owner, token_account.amount, account.pubkey
            FROM token_account, account
            WHERE token_account.mint = ? AND token_account.owner = account.pubkey AND account.owner = ? AND token_account.amount > 0
            ORDER BY token_account.amount DESC
        `,
      )
      .all([
        '7HqhfUqig7kekN8FbJCtQ36VgdXKriZWQ62rTve9ZmQ',
        '11111111111111111111111111111111',
      ]); //Mercurial mSOL-2Pool & system program

    result.forEach((row: any) => {
      buf[row.owner] =
        (buf[row.owner] ?? 0) + Math.round(row.amount * mSOL_per_LP);
    });
    return buf;
  }

  private saber(db: SQLite.Database) {
    console.info(new Date().toISOString() + ' Parsing Saber');
    const buf: Record<string, number> = {};

    const mSOL_SOL_supply = (
      db
        .prepare(`SELECT supply FROM token_mint WHERE pubkey= ?`)
        .all('SoLEao8wTzSfqhuou8rcYsVoLjthVmiXuEjzdNPMnCz')[0] as any
    )?.supply;
    const mSOL_in_liq = (
      db
        .prepare(`SELECT amount FROM token_account WHERE pubkey= ?`)
        .all('9DgFSWkPDGijNKcLGbr3p5xoJbHsPgXUTr6QvGBJ5vGN')[0] as any
    )?.amount;
    const mSOL_per_LP = mSOL_in_liq / mSOL_SOL_supply;

    const result = db
      .prepare(
        `
            SELECT token_account.owner, token_account.amount, account.pubkey
            FROM token_account, account
            WHERE token_account.mint = ? AND token_account.owner = account.pubkey AND account.owner = ? AND token_account.amount > 0
            ORDER BY token_account.amount DESC
        `,
      )
      .all([
        'SoLEao8wTzSfqhuou8rcYsVoLjthVmiXuEjzdNPMnCz',
        '11111111111111111111111111111111',
      ]); //Saber mSOL-SOL & system program
    result.forEach((row: any) => {
      buf[row.owner] =
        (buf[row.owner] ?? 0) + Math.round(row.amount * mSOL_per_LP);
    });
    return buf;
  }

  private friktion(db: SQLite.Database) {
    console.info(new Date().toISOString() + ' Parsing Friktion');
    const buf: Record<string, number> = {};
    const result = db
      .prepare(
        `
            SELECT token_account.owner, token_account.amount, account.pubkey
            FROM token_account, account
            WHERE token_account.mint = ? AND token_account.owner = account.pubkey AND account.owner = ? AND token_account.amount > 0
            ORDER BY token_account.amount DESC
        `,
      )
      .all([
        '6UA3yn28XecAHLTwoCtjfzy3WcyQj1x13bxnH8urUiKt',
        '11111111111111111111111111111111',
      ]); // fcmSOL address & system program address
    result.forEach((row: any) => {
      buf[row.owner] = (buf[row.owner] ?? 0) + row.amount;
    });
    return buf;
  }

  private port(db: SQLite.Database) {
    console.info(new Date().toISOString() + ' Parsing Port');
    const buf: Record<string, number> = {};
    const result = db.prepare(`SELECT pubkey, owner, data FROM port`).all();
    result.forEach((row: any) => {
      const profile = PortProfileParser(row.data);
      profile.deposits.forEach((deposit) => {
        if (
          deposit.depositReserve.toBase58() ==
          '9gDF5W94RowoDugxT8cM29cX8pKKQitTp2uYVrarBSQ7'
        ) {
          buf[profile.owner.toBase58()] =
            (buf[profile.owner.toBase58()] ?? 0) +
            (deposit.depositedAmount.toU64() as any).toNumber();
        }
      });
    });
    return buf;
  }
}

/// from SONDER:

// function to add a new protocol if the protocol give a collateral token to the user (ex: Friktion give fcmSOL to the user when staking mSOL)
// function TOKEN(){
//     console.info(new Date().toISOString() + " Parsing ProtocolName");
//     const result = db.prepare(`SELECT token_account.owner, token_account.amount, account.pubkey FROM token_account, account WHERE token_account.mint= ? AND token_account.owner=account.pubkey AND account.owner= ? AND token_account.amount>0 ORDER BY token_account.amount desc`).all(["TOKEN_MINT", "11111111111111111111111111111111"]); //TOKEN address & system program address
//     result.forEach((row) => {
//         if(dataProtocolName[row.owner] == undefined){
//             dataProtocolName[row.owner] = row.amount*toUi;
//         }else{
//             dataProtocolName[row.owner] += row.amount*toUi;
//         }

//         if(owners.indexOf(row.owner) == -1){
//             owners.push(row.owner);
//         }
//     });
// }

// function to add a new protocol if the protocol give a LP token to the user
// function LP(){
//     console.info(new Date().toISOString() + " Parsing ProtocolName");

//     const mSOL_tokenB_supply = db.prepare(`SELECT supply FROM token_mint WHERE pubkey= ?`).all("LP_TOKEN_MINT")[0].supply*toUi; //if the LP token have more or less than 9 decimals change the *toUi to Math.pow(10, NUMBER_OF_DECIMALS)
//     const mSOL_in_liq = db.prepare(`SELECT amount FROM token_account WHERE pubkey= ?`).all("TOKEN_ACCOUNT_WHICH_HOLD_MSOL")[0].amount*toUi; //mSOL-tokenB token account which hold mSOL
//     const mSOL_per_LP = mSOL_in_liq/mSOL_tokenB_supply;

//     const result = db.prepare(`SELECT token_account.owner, token_account.amount, account.pubkey FROM token_account, account WHERE token_account.mint= ? AND token_account.owner=account.pubkey AND account.owner= ? AND token_account.amount>0 ORDER BY token_account.amount desc`).all(["LP_TOKEN_MINT", "11111111111111111111111111111111"]); //mSOL-tokenB & system program
//     result.forEach((row) => {
//         if(dataProtocolName[row.owner] == undefined){
//             dataProtocolName[row.owner] = row.amount*toUi*mSOL_per_LP;
//         }else{
//             dataProtocolName[row.owner] += row.amount*toUi*mSOL_per_LP;
//         }

//         if(owners.indexOf(row.owner) == -1){
//             owners.push(row.owner);
//         }
//     });
// }
