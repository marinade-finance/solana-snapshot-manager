import { HttpException, HttpStatus } from '@nestjs/common';
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

export function validateDateInterval(startDate: string, endDate: string) {
  if (startDate && endDate) {
    if (Date.parse(startDate) > Date.parse(endDate)) {
      throw new HttpException(
        'startDate is later than endDate',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  if (!startDate && !endDate) {
    throw new HttpException(
      'No startDate or endDate provided',
      HttpStatus.BAD_REQUEST,
    );
  }
}
