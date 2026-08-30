import { ABI } from "../contracts";
import { ValidationError } from "../errors";
import { u32 } from "../soroban/scval";
import type { CoralSwapClient } from "../client/CoralSwapClient";

export interface Observation {
  timestamp: number;
  reserve0: bigint;
  reserve1: bigint;
}

export interface TWAPQuote {
  price0TWAP: bigint;
  price1TWAP: bigint;
  /** Total wall-clock window spanned by the observations, seconds. */
  timeWindow: number;
  observationCount: number;
}

export interface GetTWAPOptions {
  /** Restrict the TWAP to observations within the last `windowSeconds`. */
  windowSeconds?: number;
}

const TWAP_SCALE = 10n ** 9n;

/**
 * Time-weighted average price from a set of observations.
 *
 * Each observation is (timestamp, reserve0, reserve1). The instantaneous price
 * `p0 = reserve0/reserve1` is weighed by the time it was in effect. Returns
 * `null` when fewer than two observations are available (the definition of an
 * unaveraged price).
 */
export function computeTWAP(
  observations: Observation[],
  windowSeconds?: number,
): TWAPQuote | null {
  if (observations.length < 2) {
    return null;
  }
  const sorted = [...observations].sort((a, b) => a.timestamp - b.timestamp);

  let filtered = sorted;
  if (windowSeconds !== undefined) {
    if (windowSeconds <= 0) {
      throw new ValidationError(`windowSeconds must be positive, got ${windowSeconds}`);
    }
    const threshold = sorted[sorted.length - 1]!.timestamp - windowSeconds;
    filtered = sorted.filter((obs) => obs.timestamp >= threshold);
    if (filtered.length < 2) {
      return null;
    }
  }

  let weightedPrice0 = 0n;
  let weightedPrice1 = 0n;
  let totalDuration = 0n;

  for (let i = 0; i < filtered.length - 1; i++) {
    const current = filtered[i]!;
    const next = filtered[i + 1]!;
    const duration = BigInt(next.timestamp - current.timestamp);
    if (duration <= 0n) {
      continue;
    }
    const price0 = next.reserve1 > 0n ? (next.reserve0 * TWAP_SCALE) / next.reserve1 : 0n;
    const price1 = next.reserve0 > 0n ? (next.reserve1 * TWAP_SCALE) / next.reserve0 : 0n;
    weightedPrice0 += price0 * duration;
    weightedPrice1 += price1 * duration;
    totalDuration += duration;
  }

  if (totalDuration <= 0n) {
    return null;
  }

  return {
    price0TWAP: weightedPrice0 / totalDuration,
    price1TWAP: weightedPrice1 / totalDuration,
    timeWindow: Number(totalDuration),
    observationCount: filtered.length,
  };
}

/**
 * CoralSwap TWAP oracle. `observe()` writes a price observation to the pair;
 * `getTWAP()` reads them back and computes a time-weighted average.
 */
export class OracleModule {
  constructor(private readonly client: CoralSwapClient) {}

  /** Record a price observation for `pairAddress` (a write transaction). */
  async observe(pairAddress: string): Promise<{ hash: string }> {
    const result = await this.client.submitContractCall({
      operations: [{ contractId: pairAddress, method: ABI.pair.observe, args: [] }],
    });
    return { hash: result.hash };
  }

  /** Read recorded observations and compute the TWAP over the requested window. */
  async getTWAP(pairAddress: string, options?: GetTWAPOptions): Promise<TWAPQuote | null> {
    const raw = await this.client.readContract(pairAddress, ABI.pair.getTwap, options?.windowSeconds !== undefined ? [u32(options.windowSeconds)] : []);
    const observations = this.decodeObservations(raw);
    return computeTWAP(observations, options?.windowSeconds);
  }

  /** Read the raw observation list (useful for introspection/benchmarks). */
  async getObservations(pairAddress: string): Promise<Observation[]> {
    const raw = await this.client.readContract(pairAddress, ABI.pair.getTwap);
    return this.decodeObservations(raw);
  }

  private decodeObservations(raw: unknown): Observation[] {
    let list: unknown[] = [];
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      list = Array.isArray(record.observations) ? (record.observations as unknown[]) : [];
    } else if (Array.isArray(raw)) {
      list = raw as unknown[];
    }
    return list
      .map((item): Observation | null => {
        const obs = (item ?? {}) as Record<string, unknown>;
        const timestamp = Number(obs.timestamp ?? obs.t ?? obs.ledger ?? NaN);
        const reserve0 = coerceBigInt(obs.reserve0 ?? obs.reserve_a);
        const reserve1 = coerceBigInt(obs.reserve1 ?? obs.reserve_b);
        if (!Number.isFinite(timestamp)) {
          return null;
        }
        return { timestamp, reserve0, reserve1 };
      })
      .filter((obs): obs is Observation => obs !== null);
  }
}

function coerceBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  return 0n;
}