import { describe, it, expect } from "vitest";
import { FeeModule } from "../../src/modules/FeeModule";
import type { CoralSwapClient } from "../../src/client/CoralSwapClient";
import { ABI } from "../../src/contracts";
import { ValidationError } from "../../src/errors";
import { createMockClient, testContractId } from "./helpers";

const PAIR_A = testContractId(4);
const PAIR_B = testContractId(5);

function feeClient(reads: Record<string, unknown>): FeeModule {
  const client = createMockClient({ reads });
  return new FeeModule(client as unknown as CoralSwapClient);
}

describe("FeeModule.getCurrentFee", () => {
  it("reads a raw bps value from get_fee", async () => {
    const module = feeClient({ [`${PAIR_A}:${ABI.pair.getFee}`]: 30n });
    const estimate = await module.getCurrentFee(PAIR_A);
    expect(estimate).toMatchObject({ pair: PAIR_A, currentFeeBps: 30, isStale: false, feeSource: "raw-bps" });
  });

  it("handles a dynamic record shape and computes staleness", async () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = feeClient({
      [`${PAIR_A}:${ABI.pair.getFee}`]: { fee_bps: 45, base_fee_bps: 10, max_fee_bps: 90, last_block: now },
    });
    const estimate = await fresh.getCurrentFee(PAIR_A);
    expect(estimate.currentFeeBps).toBe(45);
    expect(estimate.isStale).toBe(false);
    expect(estimate.baseFeeBps).toBe(10);
    expect(estimate.maxFeeBps).toBe(90);
    expect(estimate.updatedSecondsAgo).toBeLessThanOrEqual(1);

    const stale = feeClient({
      [`${PAIR_A}:${ABI.pair.getFee}`]: { fee_bps: 45, last_block: now - 7200 },
    });
    const staleEstimate = await stale.getCurrentFee(PAIR_A);
    expect(staleEstimate.isStale).toBe(true);
  });

  it("rejects an empty address", async () => {
    const module = feeClient({});
    await expect(module.getCurrentFee("")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("FeeModule.compareFees", () => {
  it("sorts lowest to highest", async () => {
    const module = feeClient({
      [`${PAIR_A}:${ABI.pair.getFee}`]: 90n,
      [`${PAIR_B}:${ABI.pair.getFee}`]: 10n,
    });
    const sorted = await module.compareFees([PAIR_A, PAIR_B]);
    expect(sorted.map((entry) => entry.currentFeeBps)).toEqual([10, 90]);
  });
});