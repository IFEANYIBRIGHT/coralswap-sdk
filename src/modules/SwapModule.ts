import type { CoralSwapClient } from "../client/CoralSwapClient";
import { ABI } from "../contracts";
import { ConfigError, NotFoundError, SlippageError, ValidationError } from "../errors";
import { address, i128 } from "../soroban/scval";
import { DEFAULT_SLIPPAGE_BPS } from "../constants";
import { sortTokens, isValidContractAddress } from "../utils/address";
import { getAmountIn, getAmountOut, getPriceImpactBps } from "../utils/swapMath";
import { applySlippageToAmount, assertNotExpired, computeDeadline } from "../utils/time";

export enum TradeType {
  EXACT_IN = "EXACT_IN",
  EXACT_OUT = "EXACT_OUT",
}

export interface GetQuoteParams {
  /** Two-token form: token entering the swap. Mutual-exclusive with `path`. */
  tokenIn?: string;
  /** Two-token form: token leaving the swap. Mutual-exclusive with `path`. */
  tokenOut?: string;
  /** Multi-hop form: ordered list of tokens through the swap. */
  path?: string[];
  amount: bigint;
  tradeType: TradeType;
  /** Slippage tolerance in bps. Defaults to 50 (0.5%). */
  slippageBps?: number;
}

export interface HopQuote {
  hopIndex: number;
  from: string;
  to: string;
  pair: string;
  feeBps: number;
  amountIn: bigint;
  amountOut: bigint;
}

export interface SwapQuote {
  path: string[];
  tradeType: TradeType;
  amountIn: bigint;
  amountOut: bigint;
  /** For `EXACT_IN`: guaranteed minimum output after slippage. */
  amountOutMin?: bigint;
  /** For `EXACT_OUT`: maximum input the user is willing to spend. */
  amountInMax?: bigint;
  feeBps: number;
  priceImpactBps: number;
  slippageBps: number;
  hops: HopQuote[];
}

export interface SwapExecuteParams extends GetQuoteParams {
  deadline?: number;
  to?: string;
}

interface HopContext {
  from: string;
  to: string;
  pair: string;
  feeBps: number;
  reserveIn: bigint;
  reserveOut: bigint;
}

/**
 * Quotes and executes CoralSwap swaps against live pool reserves, applying real
 * dynamic fees per hop. Accepts `"XLM"`/`"native"` anywhere as a token.
 */
export class SwapModule {
  constructor(private readonly client: CoralSwapClient) {}

  private normalizePath(params: GetQuoteParams): string[] {
    const hasPair = params.tokenIn !== undefined || params.tokenOut !== undefined;
    if (hasPair && params.path !== undefined) {
      throw new ValidationError("provide either tokenIn/tokenOut or path, not both");
    }
    if (!hasPair && params.path === undefined) {
      throw new ValidationError("provide tokenIn/tokenOut or a path to quote a swap");
    }
    let path = hasPair
      ? [params.tokenIn!, params.tokenOut!]
      : (params.path as string[]);
    path = path.map((token) => this.client.resolveToken(token));
    if (path.length < 2) {
      throw new ValidationError("a swap path needs at least two tokens");
    }
    for (const token of path) {
      if (!isValidContractAddress(token)) {
        throw new ValidationError(`invalid token contract address in path: "${token}"`);
      }
    }
    return path;
  }

  private async hopContext(from: string, to: string): Promise<HopContext> {
    const token0 = sortTokens(from, to)[0];
    const pair = await this.client.getPair(from, to);
    if (!pair) {
      throw new NotFoundError(`no CoralSwap pair exists for ${from}/${to}`);
    }
    const { reserve0, reserve1 } = await this.client.getReserves(pair.address);
    const feeBps = Number(await this.client.getFee(pair.address));
    const fromIsToken0 = token0 === from;
    return {
      from,
      to,
      pair: pair.address,
      feeBps,
      reserveIn: fromIsToken0 ? reserve0 : reserve1,
      reserveOut: fromIsToken0 ? reserve1 : reserve0,
    };
  }

  /** Compute a quote (input or output fixed) through an ordered token path. */
  async getQuote(params: GetQuoteParams): Promise<SwapQuote> {
    const path = this.normalizePath(params);
    const tradeType = params.tradeType;
    const slippageBps = params.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

    const hops: HopQuote[] = [];
    let feeBps = 0;
    let priceImpactBps = 0;

    let amountIn: bigint;
    let amountOut: bigint;

    if (tradeType === TradeType.EXACT_IN) {
      let amount = params.amount;
      for (let i = 0; i < path.length - 1; i++) {
        const ctx = await this.hopContext(path[i]!, path[i + 1]!);
        const out = getAmountOut(amount, ctx.reserveIn, ctx.reserveOut, ctx.feeBps);
        hops.push({
          hopIndex: i,
          from: ctx.from,
          to: ctx.to,
          pair: ctx.pair,
          feeBps: ctx.feeBps,
          amountIn: amount,
          amountOut: out,
        });
        amount = out;
        feeBps += ctx.feeBps;
        priceImpactBps += getPriceImpactBps(amount, ctx.reserveIn, ctx.reserveOut, ctx.feeBps);
      }
      amountIn = params.amount;
      amountOut = amount;
    } else {
      let amount = params.amount;
      const ctxs: HopContext[] = [];
      for (let i = 0; i < path.length - 1; i++) {
        ctxs.push(await this.hopContext(path[i]!, path[i + 1]!));
      }
      for (let i = ctxs.length - 1; i >= 0; i--) {
        const ctx = ctxs[i]!;
        const input = getAmountIn(amount, ctx.reserveIn, ctx.reserveOut, ctx.feeBps);
        hops.unshift({
          hopIndex: i,
          from: ctx.from,
          to: ctx.to,
          pair: ctx.pair,
          feeBps: ctx.feeBps,
          amountIn: input,
          amountOut: amount,
        });
        amount = input;
      }
      amountIn = amount;
      amountOut = params.amount;
      // Price impact measured on the first (input-side) hop.
      priceImpactBps = getPriceImpactBps(
        amountIn,
        ctxs[0]!.reserveIn,
        ctxs[0]!.reserveOut,
        ctxs[0]!.feeBps,
      );
    }

    const quote: SwapQuote = {
      path,
      tradeType,
      amountIn,
      amountOut,
      feeBps,
      priceImpactBps,
      slippageBps,
      hops,
    };

    if (tradeType === TradeType.EXACT_IN) {
      quote.amountOutMin = applySlippageToAmount(amountOut, slippageBps, "min");
    } else {
      quote.amountInMax = applySlippageToAmount(amountIn, slippageBps, "max");
    }
    return quote;
  }

  private async buildSwapOperations(
    path: string[],
    amountIn: bigint,
    amountOutMin: bigint,
    to: string,
  ) {
    const router = this.client.contractConfig.router;
    if (router) {
      return [
        {
          contractId: router,
          method: ABI.router.swapExactIn,
          args: [i128(amountIn), i128(amountOutMin), address(to), { type: "addressVec" as const, value: path }],
        },
      ];
    }
    // No router: a direct single-hop pair swap with an approval.
    if (path.length !== 2) {
      throw new ConfigError("multi-hop swaps require a router contract (`contractConfig.router`)");
    }
    const pair = await this.client.getPair(path[0]!, path[1]!);
    if (!pair) {
      throw new NotFoundError(`no CoralSwap pair exists for ${path[0]}/${path[1]}`);
    }
    return [
      { contractId: path[0]!, method: ABI.token.approve, args: [address(pair.address), i128(amountIn)] },
      {
        contractId: pair.address,
        method: ABI.pair.swapExactIn,
        args: [i128(amountIn), i128(amountOutMin), address(to)],
      },
    ];
  }

  private async buildSwapOutOperations(
    path: string[],
    amountInMax: bigint,
    amountOutExact: bigint,
    to: string,
  ) {
    const router = this.client.contractConfig.router;
    if (router) {
      return [
        {
          contractId: router,
          method: ABI.router.swapExactOut,
          args: [i128(amountInMax), i128(amountOutExact), address(to), { type: "addressVec" as const, value: path }],
        },
      ];
    }
    if (path.length !== 2) {
      throw new ConfigError("multi-hop swaps require a router contract (`contractConfig.router`)");
    }
    const pair = await this.client.getPair(path[0]!, path[1]!);
    if (!pair) {
      throw new NotFoundError(`no CoralSwap pair exists for ${path[0]}/${path[1]}`);
    }
    return [
      { contractId: path[0]!, method: ABI.token.approve, args: [address(pair.address), i128(amountInMax)] },
      {
        contractId: pair.address,
        method: ABI.pair.swapExactOut,
        args: [i128(amountInMax), i128(amountOutExact), address(to)],
      },
    ];
  }

  /**
   * Execute a swap. Re-quotes with a fresh (uncached) read to compute the
   * slippage bound, then submits through the router or pair contract.
   */
  async execute(params: SwapExecuteParams): Promise<{ hash: string }> {
    const path = this.normalizePath(params);
    const deadline = computeDeadline(params.deadline);
    assertNotExpired(deadline);

    const quote = await this.getQuote({
      tradeType: params.tradeType,
      amount: params.amount,
      slippageBps: params.slippageBps,
      path,
    });
    const to = params.to ?? this.client.publicKey;
    if (!to) {
      throw new ConfigError("`to` is required when no public key is configured on the client");
    }

    const operations =
      params.tradeType === TradeType.EXACT_IN
        ? await this.buildSwapOperations(path, quote.amountIn, quote.amountOutMin ?? 0n, to)
        : await this.buildSwapOutOperations(path, quote.amountInMax ?? 0n, quote.amountOut, to);

    const result = await this.client.submitContractCall({ operations, deadline });
    return { hash: result.hash };
  }

  /** Validate that a quote still fits within the slippage bound at execution time. */
  assertQuoteWithinSlippage(expected: SwapQuote, actual: SwapQuote): void {
    if (expected.tradeType === TradeType.EXACT_IN) {
      const min = applySlippageToAmount(expected.amountOut, expected.slippageBps, "min");
      if (actual.amountOut < min) {
        throw new SlippageError(
          `swap output ${actual.amountOut} is below the ${expected.slippageBps}bps bound ${min}`,
        );
      }
    } else {
      const max = applySlippageToAmount(expected.amountIn, expected.slippageBps, "max");
      if (actual.amountIn > max) {
        throw new SlippageError(`swap input ${actual.amountIn} is above the ${expected.slippageBps}bps bound ${max}`);
      }
    }
  }
}