import { describe, it, expect } from "vitest";
import { FactoryModule } from "../../src/modules/FactoryModule";
import type { CoralSwapClient } from "../../src/client/CoralSwapClient";
import { ABI } from "../../src/contracts";
import { NotFoundError } from "../../src/errors";
import { createMockClient, testContractId } from "./helpers";

const FACTORY = testContractId(9);
const PAIR = testContractId(4);
const TOKEN_A = testContractId(1);
const TOKEN_B = testContractId(2);

function factory(reads: Record<string, unknown>): FactoryModule {
  const client = createMockClient({ reads, contractConfig: { factory: FACTORY } });
  return new FactoryModule(client as unknown as CoralSwapClient);
}

describe("FactoryModule", () => {
  it("reports the number of registered pairs", async () => {
    const module = factory({ [`${FACTORY}:${ABI.factory.pairCount}`]: 3 });
    await expect(module.pairCount()).resolves.toBe(3);
  });

  it("looks up a pair by two tokens", async () => {
    const module = factory({ [`${FACTORY}:${ABI.factory.pair}`]: PAIR });
    const pair = await module.getPair(TOKEN_A, TOKEN_B);
    expect(pair?.address).toBe(PAIR);
    expect(pair?.tokenA).toBe(TOKEN_A < TOKEN_B ? TOKEN_A : TOKEN_B);
  });

  it("returns null and throws for missing pairs", async () => {
    const none = factory({});
    await expect(none.getPair(TOKEN_A, TOKEN_B)).resolves.toBeNull();
    await expect(none.getPairOrThrow(TOKEN_A, TOKEN_B)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("enumerates all pairs and resolves their tokens", async () => {
    const module = factory({
      [`${FACTORY}:${ABI.factory.allPairs}`]: [PAIR],
      [`${PAIR}:${ABI.pair.token0}`]: TOKEN_A,
      [`${PAIR}:${ABI.pair.token1}`]: TOKEN_B,
    });
    const pairs = await module.getAllPairs();
    expect(pairs).toEqual([{ address: PAIR, tokenA: TOKEN_A, tokenB: TOKEN_B }]);
  });

  it("reads and caches token decimals", async () => {
    const module = factory({ [`${TOKEN_A}:${ABI.token.decimals}`]: 7 });
    await expect(module.tokenDecimals(TOKEN_A)).resolves.toBe(7);
    await expect(module.tokenDecimals(TOKEN_A)).resolves.toBe(7);
  });

  it("throws when the factory address is missing", async () => {
    const client = createMockClient({ contractConfig: { factory: undefined, router: testContractId(8) } });
    const module = new FactoryModule(client as unknown as CoralSwapClient);
    await expect(module.pairCount()).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });
});