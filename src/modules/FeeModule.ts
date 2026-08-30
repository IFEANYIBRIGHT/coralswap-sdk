import { ABI } from "../contracts";
import { DEFAULT_STALENESS_SECONDS } from "../constants";
import { ValidationError } from "../errors";
import type { CoralSwapClient } from "../client/CoralSwapClient";

export interface FeeEstimate {
  pair: string;
  currentFeeBps: number;
  /** True when the on-chain fee update is older than `stalenessSeconds`. */
  isStale: boolean;
  /** Seconds since the fee was last updated, when the contract reports timestamps. */
  updatedSecondsAgo?: number;
  baseFeeBps?: number;
  maxFeeBps?: number;
  feeSource?: string;
}

export interface FeeComparisonEntry {
  pair: string;
  currentFeeBps: number;
  isStale: boolean;
}

/**
 * Reads CoralSwap's dynamic per-pair fees and compares them across pairs.
 */
export class FeeModule {
  constructor(private readonly client: CoralSwapClient) {}

  /**
   * Current dynamic fee for a pair. When the on-chain data reports a
   * `last_block` / `updated_at`, staleness is computed against the configured
   * `stalenessSeconds` window (otherwise `isStale` is `false`).
   */
  async getCurrentFee(pairAddress: string): Promise<FeeEstimate> {
    if (!pairAddress) {
      throw new ValidationError("pairAddress is required");
    }
    const raw = await this.client.readContract(pairAddress, ABI.pair.getFee);

    if (typeof raw === "number" || typeof raw === "bigint" || typeof raw === "string") {
      return {
        pair: pairAddress,
        currentFeeBps: Number(raw),
        isStale: false,
        feeSource: "raw-bps",
      };
    }

    const record =
      raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const feeBps = Number(record.fee_bps ?? record.feeBps ?? record.current_fee_bps ?? record.currentFeeBps ?? record.fee);
    const updatedAt = Number(record.last_block ?? record.last_ledger ?? record.updated_at ?? record.updatedAt ?? NaN);

    const stalenessSeconds = this.client.contractConfig.stalenessSeconds ?? DEFAULT_STALENESS_SECONDS;
    let isStale = false;
    let updatedSecondsAgo: number | undefined;
    if (Number.isFinite(updatedAt)) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      updatedSecondsAgo = Math.max(0, nowSeconds - updatedAt);
      isStale = updatedSecondsAgo > stalenessSeconds;
    }

    return {
      pair: pairAddress,
      currentFeeBps: feeBps,
      isStale,
      updatedSecondsAgo,
      baseFeeBps: record.base_fee_bps !== undefined ? Number(record.base_fee_bps) : undefined,
      maxFeeBps: record.max_fee_bps !== undefined ? Number(record.max_fee_bps) : undefined,
      feeSource: "dynamic",
    };
  }

  /** Fetch fees for several pairs and sort them lowest → highest. */
  async compareFees(pairs: string[]): Promise<FeeComparisonEntry[]> {
    const entries = await Promise.all(pairs.map((pair) => this.getCurrentFee(pair)));
    return entries
      .map((entry) => ({ pair: entry.pair, currentFeeBps: entry.currentFeeBps, isStale: entry.isStale }))
      .sort((a, b) => a.currentFeeBps - b.currentFeeBps);
  }
}