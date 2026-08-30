import { describe, it, expect, beforeAll } from "vitest";
import { CoralSwapClient } from "../../src/client/CoralSwapClient";
import { Network, getNetworkConfig } from "../../src/client/Network";
import { SwapModule, TradeType } from "../../src/modules/SwapModule";
import { LiquidityModule } from "../../src/modules/LiquidityModule";
import { resolveTokenIdentifier } from "../../src/utils/tokenIdentifier";
import { isValidContractAddress, isValidAddress } from "../../src/utils/address";
import type { PairInfo } from "../../src/modules/FactoryModule";

const configured =
  process.env.STELLAR_TESTNET === "true" &&
  Boolean(process.env.TEST_KEYPAIR) &&
  Boolean(process.env.TEST_TOKEN_A) &&
  Boolean(process.env.TEST_TOKEN_B);

const tokenA = process.env.TEST_TOKEN_A ?? "";
const tokenB = process.env.TEST_TOKEN_B ?? "";
const pairFactory = process.env.TEST_FACTORY ?? "";

let client: CoralSwapClient | undefined;
let swap: SwapModule | undefined;
let liquidity: LiquidityModule | undefined;
let pair: PairInfo | null = null;

describe.skipIf(!configured)("CoralSwap lifecycle against testnet", () => {
  beforeAll(() => {
    const secretKey = process.env.TEST_KEYPAIR!;
    const rpcUrl = process.env.TEST_RPC_URL ?? "https://soroban-testnet.stellar.org";
    client = new CoralSwapClient({
      network: Network.TESTNET,
      rpcUrl,
      secretKey,
      deadlineMs: 120_000,
      contractConfig: { factory: pairFactory || undefined, cacheTtlMs: 0 },
    });
    expect(isValidContractAddress(tokenA)).toBe(true);
    expect(isValidContractAddress(tokenB)).toBe(true);
    expect(isValidAddress(secretKey)).toBe(true);
    swap = new SwapModule(client);
    liquidity = new LiquidityModule(client);
    // Factory is required for pair lookup; two SEP-41 tokens are required for quotes.
    expect(pairFactory || isValidAddress(client.resolveToken("XLM"))).toBe(true);
  });

  it("resolves the native asset to its SAC contract address", () => {
    const passphrase = getNetworkConfig(Network.TESTNET).networkPassphrase;
    const a = client!.resolveToken("native");
    const b = client!.resolveToken("XLM");
    expect(isValidContractAddress(a)).toBe(true);
    expect(isValidContractAddress(b)).toBe(true);
    expect(a).toBe(resolveTokenIdentifier("native", passphrase));
    expect(b).toBe(a);
  });

  it("probes RPC health", async () => {
    await expect(client!.isHealthy()).resolves.toBe(true);
  });

  it("quotes and adds liquidity (reusing the pair if it exists)", async () => {
    pair = await client!.getPair(tokenA, tokenB);
    const addQuote = await liquidity!.getAddLiquidityQuote({
      tokenA,
      tokenB,
      amountADesired: 1_000_000_000n,
      amountBDesired: 1_000_000_000n,
    });
    expect(addQuote.amountA).toBeGreaterThan(0n);
    expect(addQuote.amountB).toBeGreaterThan(0n);
    expect(addQuote.liquidity).toBeGreaterThan(0n);

    if (pair) {
      expect(addQuote.pool).toBe(pair.address);
      const result = await liquidity!.addLiquidity({
        tokenA,
        tokenB,
        amountADesired: addQuote.amountA,
        amountBDesired: addQuote.amountB,
        amountAMin: 0n,
        amountBMin: 0n,
        to: client!.publicKey!,
        deadline: Math.floor(Date.now() / 1000) + 300,
      });
      expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
    } else {
      // No pair yet: on testnet, create one via the factory before running this
      // suite (the SDK does not deploy contracts).
      throw new Error(
        "no CoralSwap pair exists for the configured tokens; create it via the factory first",
      );
    }
  }, 120_000);

  it("quotes an EXACT_IN swap against live reserves", async () => {
    const quote = await swap!.getQuote({
      tokenIn: tokenA,
      tokenOut: tokenB,
      amount: 1_000_000n,
      tradeType: TradeType.EXACT_IN,
      slippageBps: 100,
    });
    expect(quote.amountOut).toBeGreaterThan(0n);
    expect(quote.amountOutMin).toBeGreaterThan(0n);
    expect(quote.hops).toHaveLength(1);
  }, 120_000);

  it("executes an EXACT_IN swap within the slippage bound", async () => {
    const result = await swap!.execute({
      tokenIn: tokenA,
      tokenOut: tokenB,
      amount: 100_000n,
      tradeType: TradeType.EXACT_IN,
      slippageBps: 100,
      deadline: Math.floor(Date.now() / 1000) + 300,
    });
    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
  }, 120_000);

  it("quotes removal and removes a portion of liquidity", async () => {
    const removeQuote = await liquidity!.getRemoveLiquidityQuote(tokenA, tokenB, 100_000n);
    expect(removeQuote.amountA).toBeGreaterThan(0n);
    expect(removeQuote.amountB).toBeGreaterThan(0n);

    const result = await liquidity!.removeLiquidity({
      tokenA,
      tokenB,
      liquidity: 100_000n,
      amountAMin: 0n,
      amountBMin: 0n,
      to: client!.publicKey!,
      deadline: Math.floor(Date.now() / 1000) + 300,
    });
    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
  }, 120_000);
});