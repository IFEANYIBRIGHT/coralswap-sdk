import { describe, it, expect } from "vitest";
import { SwapModule, TradeType } from "../../src/modules/SwapModule";
import type { CoralSwapClient } from "../../src/client/CoralSwapClient";
import { ABI } from "../../src/contracts";
import { applySlippageToAmount } from "../../src/utils/time";
import { getAmountIn, getAmountOut } from "../../src/utils/swapMath";
import { sortTokens } from "../../src/utils/address";
import { ConfigError, NotFoundError, SlippageError, ValidationError } from "../../src/errors";
import { createMockClient, testContractId } from "./helpers";

const A = testContractId(1);
const B = testContractId(2);
const C = testContractId(3);
const PAIR = testContractId(4);
const PAIR_BC = testContractId(5);
const ROUTER = testContractId(8);

function twoPairClient(router?: string) {
  const pairKey = sortTokens(A, B).join(":");
  const bcKey = sortTokens(B, C).join(":");
  return createMockClient({
    pairs: {
      [pairKey]: { address: PAIR, tokenA: A, tokenB: B },
      [bcKey]: { address: PAIR_BC, tokenA: B, tokenB: C },
    },
    contractConfig: { factory: testContractId(9), router },
  });
}

function swap(client: ReturnType<typeof createMockClient>): SwapModule {
  return new SwapModule(client as unknown as CoralSwapClient);
}

describe("SwapModule.getQuote", () => {
  it("quotes an EXACT_IN single hop against live reserves and fee", async () => {
    const module = swap(twoPairClient());
    const quote = await module.getQuote({
      tokenIn: A,
      tokenOut: B,
      amount: 1000n,
      tradeType: TradeType.EXACT_IN,
      slippageBps: 50,
    });
    expect(quote.path).toEqual([A, B]);
    expect(quote.amountIn).toBe(1000n);
    expect(quote.amountOut).toBe(getAmountOut(1000n, 100_000_000n, 200_000_000n, 30));
    expect(quote.amountOutMin).toBe(applySlippageToAmount(quote.amountOut, 50, "min"));
    expect(quote.feeBps).toBe(30);
    expect(quote.priceImpactBps).toBeGreaterThan(0);
    expect(quote.hops).toHaveLength(1);
    expect(quote.hops[0]?.pair).toBe(PAIR);
  });

  it("quotes EXACT_OUT single hop and returns amountInMax", async () => {
    const module = swap(twoPairClient());
    const targetOut = getAmountOut(1000n, 100_000_000n, 200_000_000n, 30);
    const quote = await module.getQuote({
      tokenIn: A,
      tokenOut: B,
      amount: targetOut,
      tradeType: TradeType.EXACT_OUT,
      slippageBps: 100,
    });
    expect(quote.amountOut).toBe(targetOut);
    expect(quote.amountIn).toBe(getAmountIn(targetOut, 100_000_000n, 200_000_000n, 30));
    expect(quote.amountInMax).toBe(applySlippageToAmount(quote.amountIn, 100, "max"));
  });

  it("chains multiple hops in multi-hop quotes", async () => {
    const module = swap(twoPairClient(ROUTER));
    const quote = await module.getQuote({
      path: [A, B, C],
      amount: 10_000n,
      tradeType: TradeType.EXACT_IN,
    });
    expect(quote.hops).toHaveLength(2);
    expect(quote.path).toEqual([A, B, C]);
    expect(quote.feeBps).toBe(60);
  });

  it("resolves native XLM identifiers", async () => {
    const sacAddress = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const pairKey = sortTokens(sacAddress, B).join(":");
    const client = createMockClient({
      pairs: { [pairKey]: { address: testContractId(6), tokenA: sacAddress, tokenB: B } },
    });
    const module = swap(client);
    const quote = await module.getQuote({ tokenIn: "XLM", tokenOut: B, amount: 1000n, tradeType: TradeType.EXACT_IN });
    expect(quote.path[0]).toBe(sacAddress);
  });

  it("throws when a pair does not exist", async () => {
    const module = swap(twoPairClient());
    const unknown = testContractId(7);
    await expect(
      module.getQuote({ tokenIn: A, tokenOut: unknown, amount: 1n, tradeType: TradeType.EXACT_IN }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects ambiguous path configuration", async () => {
    const module = swap(twoPairClient());
    await expect(
      module.getQuote({ tokenIn: A, tokenOut: B, path: [A, B], amount: 1n, tradeType: TradeType.EXACT_IN }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("SwapModule.execute", () => {
  it("builds a single router swap op with the slippage bound", async () => {
    const client = twoPairClient(ROUTER);
    const module = swap(client);
    await module.execute({ tokenIn: A, tokenOut: B, amount: 1000n, tradeType: TradeType.EXACT_IN, to: A });
    const call = client.submitContractCall.mock.calls[0]?.[0];
    const [op] = call.operations;
    expect(op.contractId).toBe(ROUTER);
    expect(op.method).toBe(ABI.router.swapExactIn);
    expect(call.deadline).toBeDefined();
  });

  it("falls back to approve + direct pair swap without a router", async () => {
    const client = twoPairClient();
    const module = swap(client);
    await module.execute({ tokenIn: A, tokenOut: B, amount: 1000n, tradeType: TradeType.EXACT_IN, to: A });
    const call = client.submitContractCall.mock.calls[0]?.[0];
    expect(call.operations).toHaveLength(2);
    expect(call.operations[0]).toMatchObject({ contractId: A, method: ABI.token.approve });
    expect(call.operations[1]).toMatchObject({ contractId: PAIR, method: ABI.pair.swapExactIn });
  });

  it("forbids multi-hop execution without a router", async () => {
    const client = twoPairClient();
    const module = swap(client);
    await expect(
      module.execute({ path: [A, B, C], amount: 100n, tradeType: TradeType.EXACT_IN }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("requires a recipient when no public key is configured", async () => {
    const client = twoPairClient();
    client.publicKey = undefined;
    const module = swap(client);
    await expect(
      module.execute({ tokenIn: A, tokenOut: B, amount: 100n, tradeType: TradeType.EXACT_IN }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("enforces the deadline before quoting", async () => {
    const client = twoPairClient();
    const module = swap(client);
    await expect(
      module.execute({
        tokenIn: A,
        tokenOut: B,
        amount: 100n,
        tradeType: TradeType.EXACT_IN,
        deadline: Math.floor(Date.now() / 1000) - 10,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("deadline") });
  });
});

describe("SwapModule.assertQuoteWithinSlippage", () => {
  it("holds when the post-execution quote stays within the bound", () => {
    const module = swap(twoPairClient());
    const expected = {
      tradeType: TradeType.EXACT_IN,
      amountOut: 1000n,
      slippageBps: 50,
    } as never;
    const actual = { tradeType: TradeType.EXACT_IN, amountOut: 996n } as never;
    expect(() => module.assertQuoteWithinSlippage(expected, actual)).not.toThrow();
  });

  it("rejects when output falls below the bound", () => {
    const module = swap(twoPairClient());
    const expected = { tradeType: TradeType.EXACT_IN, amountOut: 1000n, slippageBps: 50 } as never;
    const actual = { tradeType: TradeType.EXACT_IN, amountOut: 949n } as never;
    expect(() => module.assertQuoteWithinSlippage(expected, actual)).toThrow(SlippageError);
  });
});