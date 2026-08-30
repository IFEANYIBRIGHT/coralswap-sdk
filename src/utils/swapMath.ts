import { FEE_SCALE_BPS } from "../constants";
import { ValidationError } from "../errors";

export const FEE_SCALE = BigInt(FEE_SCALE_BPS);

function validateSwapInputs(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): void {
  if (amountIn <= 0n) {
    throw new ValidationError(`amountIn must be positive, got ${amountIn}`);
  }
  if (reserveIn <= 0n || reserveOut <= 0n) {
    throw new ValidationError(`reserves must be positive, got reserveIn=${reserveIn} reserveOut=${reserveOut}`);
  }
}

/**
 * Constant-product `amountOut` for an `EXACT_IN` swap after the dynamic fee.
 *
 * out = reserveOut * (amountIn * (1 - fee)) / (reserveIn + amountIn * (1 - fee))
 */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): bigint {
  validateSwapInputs(amountIn, reserveIn, reserveOut);
  const fee = BigInt(feeBps);
  if (fee < 0n || fee >= FEE_SCALE) {
    throw new ValidationError(`feeBps must be within [0, ${FEE_SCALE_BPS}), got ${feeBps}`);
  }
  const amountInWithFee = (amountIn * (FEE_SCALE - fee)) / FEE_SCALE;
  if (amountInWithFee <= 0n) {
    return 0n;
  }
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn + amountInWithFee;
  return numerator / denominator;
}

/**
 * Constant-product gross `amountIn` an `EXACT_OUT` swap must pay before fee.
 *
 * in = reserveIn * amountOut / (reserveOut - amountOut), fee-adjusted.
 */
export function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): bigint {
  if (amountOut <= 0n) {
    throw new ValidationError(`amountOut must be positive, got ${amountOut}`);
  }
  if (reserveIn <= 0n) {
    throw new ValidationError(`reserveIn must be positive, got ${reserveIn}`);
  }
  if (amountOut >= reserveOut) {
    throw new ValidationError(`amountOut (${amountOut}) must be smaller than reserveOut (${reserveOut})`);
  }
  const fee = BigInt(feeBps);
  if (fee < 0n || fee >= FEE_SCALE) {
    throw new ValidationError(`feeBps must be within [0, ${FEE_SCALE_BPS}), got ${feeBps}`);
  }
  const numerator = reserveIn * amountOut * FEE_SCALE;
  const denominator = (reserveOut - amountOut) * (FEE_SCALE - fee);
  return numerator / denominator + 1n;
}

const SQRT_SCALE = 1_000_000_000_000n; // 1e12

/**
 * Price impact of an `EXACT_IN` swap, in bps, relative to the pre-swap mid
 * price. Uses fixed-point arithmetic (1e-12) so it is meaningful even for tiny
 * pools, and clamps negative (favorable) impacts to `0`.
 */
export function getPriceImpactBps(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): number {
  validateSwapInputs(amountIn, reserveIn, reserveOut);
  const midPrice = (reserveIn * SQRT_SCALE) / reserveOut; // price of out in units of in
  if (midPrice <= 0n) {
    return 0;
  }
  const fee = BigInt(feeBps);
  const amountInNet = (amountIn * (FEE_SCALE - fee)) / FEE_SCALE;
  const amountOut = getAmountOut(amountIn, reserveIn, reserveOut, feeBps);
  if (amountInNet <= 0n || amountOut <= 0n) {
    return 0;
  }
  const effectivePrice = (amountInNet * SQRT_SCALE) / amountOut;
  const delta = ((effectivePrice - midPrice) * BigInt(FEE_SCALE_BPS)) / midPrice;
  return delta > 0n ? Number(delta) : 0;
}