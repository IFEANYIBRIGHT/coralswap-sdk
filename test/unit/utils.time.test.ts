import { describe, it, expect } from "vitest";
import {
  applySlippageToAmount,
  assertNotExpired,
  computeDeadline,
  secondsFromNow,
} from "../../src/utils/time";
import { DEFAULT_DEADLINE_SECONDS } from "../../src/constants";
import { DeadlineError, ValidationError } from "../../src/errors";

describe("time helpers", () => {
  it("computes deadlines relative to now", () => {
    const now = Math.floor(Date.now() / 1000);
    const deadline = computeDeadline();
    expect(deadline).toBeGreaterThanOrEqual(now + DEFAULT_DEADLINE_SECONDS - 5);
    expect(deadline).toBeLessThanOrEqual(now + DEFAULT_DEADLINE_SECONDS);
    expect(computeDeadline(1234)).toBe(1234);
    expect(secondsFromNow(10)).toBeGreaterThan(now + 9);
  });

  it("assertNotExpired throws DeadlineError for past deadlines", () => {
    expect(() => assertNotExpired(Math.floor(Date.now() / 1000) - 1)).toThrow(DeadlineError);
    expect(() => assertNotExpired(Math.floor(Date.now() / 1000) + 3600)).not.toThrow();
  });
});

describe("applySlippageToAmount", () => {
  it("shrink direction produces a floor for exact-in trades", () => {
    expect(applySlippageToAmount(10000n, 50, "min")).toBe(9950n);
    expect(applySlippageToAmount(199n, 50, "min")).toBe(198n);
  });

  it("grow direction produces a ceiling for exact-out trades", () => {
    expect(applySlippageToAmount(100n, 50, "max")).toBe(100n);
    expect(applySlippageToAmount(100n, 1000, "max")).toBe(110n);
  });

  it("rejects negative slippage", () => {
    expect(() => applySlippageToAmount(100n, -1, "min")).toThrow(ValidationError);
  });
});