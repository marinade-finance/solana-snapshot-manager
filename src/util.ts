import BN from 'bn.js'

const MSOL_DECIMALS = 9

export function withDecimalPoint(bn: BN, decimals: number): string {
  const s = bn.toString().padStart(decimals + 1, '0')
  const l = s.length
  return s.slice(0, l - decimals) + '.' + s.slice(-decimals)
}

export function mlamportsToMsol(bn: BN): string {
  return withDecimalPoint(bn, MSOL_DECIMALS)
}

export function msolToMlamports(amount: number): BN {
  return new BN(amount.toFixed(MSOL_DECIMALS).replace('.', ''))
}
