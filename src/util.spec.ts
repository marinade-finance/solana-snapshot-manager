import { HttpException } from '@nestjs/common';
import BN from 'bn.js';
import {
  withDecimalPoint,
  mlamportsToMsol,
  mndelamportsToMNDE,
  msolToMlamports,
  validateDateInterval,
} from 'src/util';

describe('withDecimalPoint', () => {
  it('formats whole units', () => {
    expect(withDecimalPoint(new BN(1000000000), 9)).toBe('1.000000000');
  });

  it('formats fractional units', () => {
    expect(withDecimalPoint(new BN(1500000000), 9)).toBe('1.500000000');
  });

  it('zero-pads values smaller than one unit', () => {
    expect(withDecimalPoint(new BN(5), 9)).toBe('0.000000005');
  });

  it('handles zero', () => {
    expect(withDecimalPoint(new BN(0), 9)).toBe('0.000000000');
  });
});

describe('mlamportsToMsol / mndelamportsToMNDE', () => {
  it('converts mlamports to mSOL with 9 decimals', () => {
    expect(mlamportsToMsol(new BN(1500000000))).toBe('1.500000000');
  });

  it('converts mndelamports to MNDE with 9 decimals', () => {
    expect(mndelamportsToMNDE(new BN(2000000000))).toBe('2.000000000');
  });
});

describe('msolToMlamports', () => {
  it('round-trips with mlamportsToMsol', () => {
    expect(msolToMlamports(1.5).toString()).toBe('1500000000');
    expect(mlamportsToMsol(msolToMlamports(1.5))).toBe('1.500000000');
  });
});

describe('validateDateInterval', () => {
  it('accepts startDate before endDate', () => {
    expect(() =>
      validateDateInterval('2024-01-01', '2024-01-02'),
    ).not.toThrow();
  });

  it('throws when startDate is later than endDate', () => {
    expect(() => validateDateInterval('2024-01-02', '2024-01-01')).toThrow(
      HttpException,
    );
  });

  it('throws when neither date is provided', () => {
    expect(() => validateDateInterval('', '')).toThrow(HttpException);
  });
});
