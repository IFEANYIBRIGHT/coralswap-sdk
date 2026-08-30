import { DEFAULT_DEADLINE_SECONDS } from "../constants";
import { DeadlineError, ValidationError } from "../errors";

/** Current unix time in seconds. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** `seconds` from now as a unix timestamp. */
export function secondsFromNow(seconds: number): number {
  return nowSeconds() + seconds;
}

/**
 * Build the unix timestamp by which a transaction must land.
 * Uses the provided `deadline`, or `now + defaultSeconds`.
 */
export function computeDeadline(deadline?: number, defaultSeconds: number = DEFAULT_DEADLINE_SECONDS): number {
  return deadline ?? secondsFromNow(defaultSeconds);
}

/** Throw a `DeadlineError` when `deadline` (unix seconds) has already passed. */
export function assertNotExpired(deadline: number): void {
  if (nowSeconds() >= deadline) {
    throw new DeadlineError(`transaction deadline expired (${nowSeconds()} >= ${deadline})`, {
      details: { now: nowSeconds(), deadline },
    });
  }
}

/**
 * Smart slippage-bound builder. Returns `amountOutMin` for `EXACT_IN` trades or
 * `amountInMax` for `EXACT_OUT` trades.
 */
export function applySlippageToAmount(amount: bigint, slippageBps: number, direction: "min" | "max"): bigint {
  if (slippageBps < 0) {
    throw new ValidationError(`slippage must not be negative: ${slippageBps}`);
  }
  const factor = 10000n - BigInt(slippageBps);
  if (direction === "min") {
    return (amount * factor) / 10000n;
  }
  return (amount * (10000n + BigInt(slippageBps))) / 10000n;
}