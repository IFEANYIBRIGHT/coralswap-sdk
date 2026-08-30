import { describe, it, expect } from "vitest";
import { computeTWAP, OracleModule, type Observation } from "../../src/modules/OracleModule";
import type { CoralSwapClient } from "../../src/client/CoralSwapClient";
import { ABI } from "../../src/contracts";
import { ValidationError } from "../../src/errors";
import { createMockClient, testContractId } from "./helpers";

const PAIR = testContractId(4);
const SCALE = 10n ** 9n;

const OBSERVATIONS: Observation[] = [
  { timestamp: 1000, reserve0: 100n, reserve1: 100n },
  { timestamp: 1010, reserve0: 110n, reserve1: 100n },
  { timestamp: 1020, reserve0: 121n, reserve1: 100n },
];

describe("computeTWAP", () => {
  it("returns null with fewer than two observations", () => {
    expect(computeTWAP([OBSERVATIONS[0]!])).toBeNull();
    expect(computeTWAP([])).toBeNull();
  });

  it("weights each price by its duration", () => {
    const quote = computeTWAP(OBSERVATIONS);
    expect(quote).not.toBeNull();
    expect(quote!.observationCount).toBe(3);
    expect(quote!.timeWindow).toBe(20);
    // p0 = 110/100 over 10s, then 121/100 over 10s → (1.1 + 1.21)/2
    expect(quote!.price0TWAP).toBe((110n * SCALE) / 100n / 2n + (121n * SCALE) / 100n / 2n);
  });

  it("narrows the window when windowSeconds is passed", () => {
    const quote = computeTWAP(OBSERVATIONS, 15);
    expect(quote!.observationCount).toBe(2);
    expect(quote!.timeWindow).toBe(10);
    expect(quote!.price0TWAP).toBe((121n * SCALE) / 100n);
  });

  it("rejects non-positive windows", () => {
    expect(() => computeTWAP(OBSERVATIONS, 0)).toThrow(ValidationError);
  });

  it("returns null when the window contains too few observations", () => {
    expect(computeTWAP(OBSERVATIONS, 5)).toBeNull();
  });
});

describe("OracleModule", () => {
  it("reads observations and computes a TWAP quote", async () => {
    const client = createMockClient({
      reads: {
        [`${PAIR}:${ABI.pair.getTwap}`]: { observations: OBSERVATIONS },
      },
    });
    const module = new OracleModule(client as unknown as CoralSwapClient);
    const quote = await module.getTWAP(PAIR);
    expect(quote!.price0TWAP).toBe((110n * SCALE) / 100n / 2n + (121n * SCALE) / 100n / 2n);
  });

  it("submits an observe call", async () => {
    const client = createMockClient();
    const module = new OracleModule(client as unknown as CoralSwapClient);
    const result = await module.observe(PAIR);
    expect(client.submitContractCall).toHaveBeenCalledWith({
      operations: [{ contractId: PAIR, method: ABI.pair.observe, args: [] }],
    });
    expect(result.hash).toBeTruthy();
  });

  it("exposes raw observations for introspection", async () => {
    const client = createMockClient({
      reads: {
        [`${PAIR}:${ABI.pair.getTwap}`]: [
          { timestamp: 1000, reserve0: 100n, reserve1: 100n },
          { timestamp: 1001, reserve_a: 101n, reserve_b: 100n },
        ],
      },
    });
    const module = new OracleModule(client as unknown as CoralSwapClient);
    const obs = await module.getObservations(PAIR);
    expect(obs).toHaveLength(2);
    expect(obs[1]).toMatchObject({ reserve0: 101n, reserve1: 100n });
  });
});