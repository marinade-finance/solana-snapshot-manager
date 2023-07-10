import BN from 'bn.js';
import path from 'path';
import * as fs from 'fs';

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

export async function readJsonFile(filename: string): Promise<any> {
  const filePath = path.resolve(__dirname, filename);
  const data = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(data);
}
