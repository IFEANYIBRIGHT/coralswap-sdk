import { ValidationError } from "../errors";

export interface ReservesState {
  reserveA: bigint;
  reserveB: bigint;
  totalSupply: bigint;
}

/** Integer square root (floor) for non-negative bigints. */
export function sqrt(value: bigint): bigint {
  if (value < 0n) {
    throw new ValidationError(`sqrt of a negative value: ${value}`);
  }
  if (value < 2n) {
    return value;
  }
  let x0 = value;
  let x1 = (x0 + 1n) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

/**
 * Proportional quote: how much of `reserveB` `amountA` of token A is worth at
 * the current pool ratio.
 */
export function quote(amountA: bigint, reserveA: bigint, reserveB: bigint): bigint {
  if (amountA <= 0n) {
    throw new ValidationError(`amountA must be positive, got ${amountA}`);
  }
  if (reserveA <= 0n) {
    throw new ValidationError(`reserveA must be positive, got ${reserveA}`);
  }
  if (reserveB <= 0n) {
    throw new ValidationError(`reserveB must be positive, got ${reserveB}`);
  }
  return (amountA * reserveB) / reserveA;
}

export function bigintMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Compute the optimal amounts and `liquidity` minted when adding liquidity to a
 * V2 pool, given the current reserves.
 *
 * - For a brand-new (empty) pool the minted liquidity is `sqrt(amountA*amountB)`
 *   and the pool price equals the first depositor's ratio.
 * - For an existing pool, amounts are adjusted to the current reserve ratio and
 *   liquidity is the smaller of the two proportional mint amounts.
 *
 * @returns `{ amountA, amountB, liquidity }`
 */
export function getAddLiquidityAmounts(
  amountADesired: bigint,
  amountBDesired: bigint,
  reserveA: bigint,
  reserveB: bigint,
  totalSupply: bigint,
): { amountA: bigint; amountB: bigint; liquidity: bigint } {
  if (amountADesired < 0n || amountBDesired < 0n) {
    throw new ValidationError("desired amounts must not be negative");
  }

  if (reserveA === 0n && reserveB === 0n && totalSupply === 0n) {
    // Brand-new pool: the first depositor sets the price. With only one amount
    // provided we assume a 1:1 opening ratio (callers passing a single amount
    // to a brand-new pool should prefer explicit amounts).
    const amountA = amountADesired > 0n ? amountADesired : amountBDesired;
    const amountB = amountBDesired > 0n ? amountBDesired : amountADesired;
    if (amountA <= 0n || amountB <= 0n) {
      throw new ValidationError("at least one desired amount must be positive for a new pool");
    }
    return {
      amountA,
      amountB: amountB > 0n ? amountB : amountA,
      liquidity: sqrt(amountA * amountB),
    };
  }

  if (amountADesired <= 0n || amountBDesired <= 0n) {
    throw new ValidationError("both desired amounts must be positive when the pool already exists");
  }
  if (reserveA <= 0n || reserveB <= 0n) {
    throw new ValidationError("cannot add liquidity to a one-sided pool");
  }

  let amountA: bigint;
  let amountB: bigint;
  if (amountBDesired * reserveA >= amountADesired * reserveB) {
    amountA = amountADesired;
    amountB = quote(amountA, reserveA, reserveB);
  } else {
    amountB = amountBDesired;
    amountA = quote(amountB, reserveB, reserveA);
  }

  const liquidityA = (amountA * totalSupply) / reserveA;
  const liquidityB = (amountB * totalSupply) / reserveB;
  const liquidity = bigintMin(liquidityA, liquidityB);

  return { amountA, amountB, liquidity };
}

/**
 * Compute the token amounts a liquidity provider receives when burning
 * `liquidity` LP tokens.
 */
export function getRemoveLiquidityAmounts(
  liquidity: bigint,
  reserveA: bigint,
  reserveB: bigint,
  totalSupply: bigint,
): { amountA: bigint; amountB: bigint } {
  if (liquidity <= 0n) {
    throw new ValidationError(`liquidity must be positive, got ${liquidity}`);
  }
  if (totalSupply <= 0n) {
    throw new ValidationError(`totalSupply must be positive, got ${totalSupply}`);
  }
  if (reserveA < 0n || reserveB < 0n) {
    throw new ValidationError("reserves must not be negative");
  }
  const amountA = (liquidity * reserveA) / totalSupply;
  const amountB = (liquidity * reserveB) / totalSupply;
  return { amountA, amountB };
}