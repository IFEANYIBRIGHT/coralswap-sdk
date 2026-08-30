import { describe, it, expect } from "vitest";
import { getAmountOut, getAmountIn, getPriceImpactBps } from "../../src/utils/swapMath";
import { getAddLiquidityAmounts, getRemoveLiquidityAmounts, sqrt, quote, bigintMin } from "../../src/utils/liquidityMath";
import { ValidationError } from "../../src/errors";

const RESERVE_IN = 100_000_000n;
const RESERVE_OUT = 200_000_000n;

describe("getAmountOut", () => {
  it("takes the dynamic fee before the constant-product swap", () => {
    expect(getAmountOut(1000n, RESERVE_IN, RESERVE_OUT, 0)).toBe(1999n);
    expect(getAmountOut(1000n, RESERVE_IN, RESERVE_OUT, 30)).toBe(1993n);
    expect(getAmountOut(100_000n, RESERVE_IN, RESERVE_OUT, 300)).toBe(193_812n);
  });

  it("rejects invalid inputs", () => {
    expect(() => getAmountOut(0n, RESERVE_IN, RESERVE_OUT, 30)).toThrow(ValidationError);
    expect(() => getAmountOut(1n, 0n, RESERVE_OUT, 30)).toThrow(ValidationError);
    expect(() => getAmountOut(1n, RESERVE_IN, RESERVE_OUT, 10000)).toThrow(ValidationError);
    expect(() => getAmountOut(1n, RESERVE_IN, RESERVE_OUT, -1)).toThrow(ValidationError);
  });
});

describe("getAmountIn", () => {
  it("inverts an exact-out amount with the fee applied on the input side", () => {
    expect(getAmountIn(1999n, RESERVE_IN, RESERVE_OUT, 0)).toBe(1000n);
    expect(getAmountIn(199n, RESERVE_IN, RESERVE_OUT, 30)).toBe(100n);
  });

  it("rejects amounts beyond the reserve", () => {
    expect(() => getAmountIn(RESERVE_OUT, RESERVE_IN, RESERVE_OUT, 30)).toThrow(ValidationError);
    expect(() => getAmountIn(0n, RESERVE_IN, RESERVE_OUT, 30)).toThrow(ValidationError);
  });
});

describe("getPriceImpactBps", () => {
  it("grows with trade size and clamps negative to zero", () => {
    expect(getPriceImpactBps(1n, RESERVE_IN, RESERVE_OUT, 30)).toBe(0);
    expect(getPriceImpactBps(1_000n, RESERVE_IN, RESERVE_OUT, 30)).toBeGreaterThan(0);
    expect(getPriceImpactBps(1_000_000n, RESERVE_IN, RESERVE_OUT, 30)).toBeGreaterThan(
      getPriceImpactBps(1_000n, RESERVE_IN, RESERVE_OUT, 30),
    );
  });
});

describe("liquidity math", () => {
  it("sqrt floors correctly", () => {
    expect(sqrt(0n)).toBe(0n);
    expect(sqrt(1n)).toBe(1n);
    expect(sqrt(16n)).toBe(4n);
    expect(sqrt(17n)).toBe(4n);
    expect(sqrt(1000000n)).toBe(1000n);
    expect(() => sqrt(-1n)).toThrow(ValidationError);
  });

  it("quote is a simple ratio", () => {
    expect(quote(10n, 100n, 500n)).toBe(50n);
    expect(() => quote(0n, 100n, 500n)).toThrow(ValidationError);
  });

  it("bigintMin returns the smaller value", () => {
    expect(bigintMin(5n, 3n)).toBe(3n);
    expect(bigintMin(3n, 5n)).toBe(3n);
  });

  it("mints sqrt(amountA*amountB) in a brand-new pool", () => {
    const result = getAddLiquidityAmounts(100n, 400n, 0n, 0n, 0n);
    expect(result).toEqual({ amountA: 100n, amountB: 400n, liquidity: 200n });
  });

  it("adjusts to the pool ratio in an existing pool", () => {
    const result = getAddLiquidityAmounts(1000n, 1000n, 100_000_000n, 200_000_000n, 1_000_000n);
    expect(result.amountA).toBe(500n);
    expect(result.amountB).toBe(1000n);
    expect(result.liquidity).toBe(5n);
  });

  it("returns proportional amounts when burning LP tokens", () => {
    expect(getRemoveLiquidityAmounts(1_000n, 100_000_000n, 200_000_000n, 1_000_000n)).toEqual({
      amountA: 100_000n,
      amountB: 200_000n,
    });
  });

  it("rejects invalid removal", () => {
    expect(() => getRemoveLiquidityAmounts(0n, 100n, 100n, 1000n)).toThrow(ValidationError);
    expect(() => getRemoveLiquidityAmounts(10n, 100n, 100n, 0n)).toThrow(ValidationError);
  });
});