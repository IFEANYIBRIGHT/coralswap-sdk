import { describe, it, expect } from "vitest";
import { LiquidityModule } from "../../src/modules/LiquidityModule";
import type { CoralSwapClient } from "../../src/client/CoralSwapClient";
import { ABI } from "../../src/contracts";
import { SlippageError } from "../../src/errors";
import { createMockClient, testContractId } from "./helpers";

const A = testContractId(1);
const B = testContractId(2);
const PAIR = testContractId(4);
const ROUTER = testContractId(8);

function liquidityClient(router?: string) {
  const pairKey = [A, B].sort((x, y) => (x < y ? -1 : 1)).join(":");
  return createMockClient({
    pairs: { [pairKey]: { address: PAIR, tokenA: A, tokenB: B } },
    reserves: { [PAIR]: { reserve0: 100_000_000n, reserve1: 200_000_000n } },
    supplies: { [PAIR]: 1_000_000n },
    contractConfig: { factory: testContractId(9), router },
  });
}

function liquidity(client: ReturnType<typeof createMockClient>): LiquidityModule {
  return new LiquidityModule(client as unknown as CoralSwapClient);
}

describe("LiquidityModule.getAddLiquidityQuote", () => {
  it("computes the optimal deposit without moving the pool ratio", async () => {
    const client = liquidityClient();
    client.getReserves.mockImplementation(async () => ({ reserve0: 100_000_000n, reserve1: 200_000_000n }));
    client.getTotalSupply.mockImplementation(async () => 1_000_000n);
    const module = liquidity(client);
    const quote = await module.getAddLiquidityQuote({ tokenA: A, tokenB: B, amountADesired: 1000n, amountBDesired: 1000n });
    expect(quote.amountA).toBe(500n);
    expect(quote.amountB).toBe(1000n);
    expect(quote.liquidity).toBe(5n);
    expect(quote.pool).toBe(PAIR);
    expect(quote.sharePct).toBeCloseTo(0.0005, 3);
  });

  it("throws for a pair that does not exist", async () => {
    const module = liquidity(liquidityClient());
    await expect(
      module.getAddLiquidityQuote({ tokenA: A, tokenB: testContractId(7), amountADesired: 1n }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("LiquidityModule.addLiquidity", () => {
  it("submits a router add-liquidity call when configured", async () => {
    const client = liquidityClient(ROUTER);
    const module = liquidity(client);
    await module.addLiquidity({
      tokenA: A,
      tokenB: B,
      amountADesired: 500n,
      amountBDesired: 1000n,
      amountAMin: 400n,
      amountBMin: 900n,
      to: A,
    });
    const [op] = client.submitContractCall.mock.calls[0]![0].operations;
    expect(op.contractId).toBe(ROUTER);
    expect(op.method).toBe(ABI.router.addLiquidity);
  });

  it("falls back to approve + pair add_liquidity without a router", async () => {
    const client = liquidityClient();
    const module = liquidity(client);
    await module.addLiquidity({
      tokenA: A,
      tokenB: B,
      amountADesired: 500n,
      amountBDesired: 1000n,
      amountAMin: 400n,
      amountBMin: 900n,
      to: A,
    });
    const ops = client.submitContractCall.mock.calls[0]?.[0].operations;
    expect(ops).toHaveLength(3);
    expect(ops[0]).toMatchObject({ contractId: A, method: ABI.token.approve });
    expect(ops[2]).toMatchObject({ contractId: PAIR, method: ABI.pair.addLiquidity });
  });

  it("throws SlippageError when the pool moved past the minimums", async () => {
    const client = liquidityClient();
    const module = liquidity(client);
    await expect(
      module.addLiquidity({
        tokenA: A,
        tokenB: B,
        amountADesired: 500n,
        amountBDesired: 1000n,
        amountAMin: 501n,
        amountBMin: 900n,
        to: A,
      }),
    ).rejects.toBeInstanceOf(SlippageError);
  });
});

describe("LiquidityModule.removeLiquidity", () => {
  it("quotes proportional token release", async () => {
    const client = liquidityClient();
    client.getTotalSupply.mockImplementation(async () => 1_000_000n);
    const module = liquidity(client);
    const quote = await module.getRemoveLiquidityQuote(A, B, 1_000n);
    expect(quote.amountA).toBe(100_000n);
    expect(quote.amountB).toBe(200_000n);
  });

  it("submits pair-approve + burns when no router is configured", async () => {
    const client = liquidityClient();
    const module = liquidity(client);
    await module.removeLiquidity({ tokenA: A, tokenB: B, liquidity: 100n, amountAMin: 1n, amountBMin: 1n, to: A });
    const ops = client.submitContractCall.mock.calls[0]?.[0].operations;
    expect(ops).toHaveLength(2);
    expect(ops[1]).toMatchObject({ contractId: PAIR, method: ABI.pair.removeLiquidity });
  });
});

describe("LiquidityModule.getPool", () => {
  it("returns the pair address or throws ConfigError", async () => {
    const module = liquidity(liquidityClient());
    await expect(module.getPool(A, B)).resolves.toBe(PAIR);
    await expect(module.getPool(A, testContractId(7))).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });
});