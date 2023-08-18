import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';

const MSOL_DECIMALS = 9;
const MNDE_DECIMALS = 9;

export function withDecimalPoint(bn: BN, decimals: number): string {
  const s = bn.toString().padStart(decimals + 1, '0');
  const l = s.length;
  return s.slice(0, l - decimals) + '.' + s.slice(-decimals);
}

export function mlamportsToMsol(bn: BN): string {
  return withDecimalPoint(bn, MSOL_DECIMALS);
}

export function mndelamportsToMNDE(bn: BN): string {
  return withDecimalPoint(bn, MNDE_DECIMALS);
}

export function msolToMlamports(amount: number): BN {
  return new BN(amount.toFixed(MSOL_DECIMALS).replace('.', ''));
}

export default class EmptyWallet implements Wallet {
  constructor(readonly payer: Keypair) {}

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    if (tx instanceof Transaction) {
      tx.partialSign(this.payer);
    }

    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    return txs.map((t) => {
      if (t instanceof Transaction) {
        t.partialSign(this.payer);
      }
      return t;
    });
  }

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
}
