import type { CoralSwapClient } from "../client/CoralSwapClient";
import { ABI } from "../contracts";
import { ConfigError, NotFoundError, SlippageError, ValidationError } from "../errors";
import { address, i128 } from "../soroban/scval";
import { sortTokens } from "../utils/address";
import { getAddLiquidityAmounts, getRemoveLiquidityAmounts } from "../utils/liquidityMath";
import { assertNotExpired, computeDeadline } from "../utils/time";

export interface GetAddLiquidityQuoteParams {
  tokenA: string;
  tokenB: string;
  amountADesired: bigint;
  amountBDesired?: bigint;
}

export interface AddLiquidityQuote {
  pool: string;
  tokenA: string;
  tokenB: string;
  amountA: bigint;
  amountB: bigint;
  liquidity: bigint;
  /** Price of tokenA in tokenB, scaled to 1e-6 (micro units). */
  priceA: bigint;
  /** Price of tokenB in tokenA, scaled to 1e-6 (micro units). */
  priceB: bigint;
  /** Share of the pool captured by this deposit, 0..100. */
  sharePct: number;
}

export interface AddLiquidityParams {
  tokenA: string;
  tokenB: string;
  amountADesired: bigint;
  amountBDesired: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  to: string;
  deadline?: number;
}

export interface RemoveLiquidityQuote {
  pool: string;
  tokenA: string;
  tokenB: string;
  amountA: bigint;
  amountB: bigint;
  sharePct: number;
}

export interface RemoveLiquidityParams {
  tokenA: string;
  tokenB: string;
  liquidity: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  to: string;
  deadline?: number;
}

const MICRO = 1_000_000n;

/** Quotes and executes add/remove liquidity, keeping the pool ratio optimal. */
export class LiquidityModule {
  constructor(private readonly client: CoralSwapClient) {}

  private async pairState(tokenA: string, tokenB: string) {
    const [resolvedA, resolvedB] = [this.client.resolveToken(tokenA), this.client.resolveToken(tokenB)];
    const token0 = sortTokens(resolvedA, resolvedB)[0];
    const pair = await this.client.getPair(resolvedA, resolvedB);
    if (!pair) {
      throw new NotFoundError(`no CoralSwap pair exists for ${resolvedA}/${resolvedB}`);
    }
    const { reserve0, reserve1 } = await this.client.getReserves(pair.address);
    const totalSupply = await this.client.getTotalSupply(pair.address);
    const [reserveA, reserveB] = token0 === resolvedA ? [reserve0, reserve1] : [reserve1, reserve0];
    return { pair, tokenA: resolvedA, tokenB: resolvedB, reserveA, reserveB, totalSupply };
  }

  /** Quote the optimal deposit for an (A, B) pair given desired amounts. */
  async getAddLiquidityQuote(params: GetAddLiquidityQuoteParams): Promise<AddLiquidityQuote> {
    const { pair, reserveA, reserveB, totalSupply } = await this.pairState(
      params.tokenA,
      params.tokenB,
    );
    const amountBDesired = params.amountBDesired ?? 0n;
    const { amountA, amountB, liquidity } = getAddLiquidityAmounts(
      params.amountADesired,
      amountBDesired,
      reserveA,
      reserveB,
      totalSupply,
    );

    const newSupply = totalSupply + liquidity;
    const sharePct =
      newSupply > 0n ? Number((liquidity * 1_000_000_000_000n) / newSupply) / 10_000_000_000 : 100;

    const priceA = reserveA > 0n ? (reserveB * MICRO) / reserveA : 0n;
    const priceB = reserveB > 0n ? (reserveA * MICRO) / reserveB : 0n;

    return {
      pool: pair.address,
      tokenA: pair.tokenA,
      tokenB: pair.tokenB,
      amountA,
      amountB,
      liquidity,
      priceA,
      priceB,
      sharePct,
    };
  }

  /** Added liquidity, ensuring the provider covers the configured minimums. */
  async addLiquidity(params: AddLiquidityParams): Promise<{ hash: string }> {
    const deadline = computeDeadline(params.deadline);
    assertNotExpired(deadline);
    if (!params.to) {
      throw new ValidationError("`to` is required");
    }
    const [resolvedA, resolvedB] = [this.client.resolveToken(params.tokenA), this.client.resolveToken(params.tokenB)];

    const quote = await this.getAddLiquidityQuote({
      tokenA: resolvedA,
      tokenB: resolvedB,
      amountADesired: params.amountADesired,
      amountBDesired: params.amountBDesired,
    });

    if (quote.amountA < params.amountAMin || quote.amountB < params.amountBMin) {
      throw new SlippageError(
        `pool moved between quote and execution: needs ${quote.amountA}/${quote.amountB}, ` +
          `minimum requested ${params.amountAMin}/${params.amountBMin}`,
      );
    }

    const router = this.client.contractConfig.router;
    const operations = router
      ? [
          {
            contractId: router,
            method: ABI.router.addLiquidity,
            args: [
              address(resolvedA),
              address(resolvedB),
              i128(quote.amountA),
              i128(quote.amountB),
              i128(params.amountAMin),
              i128(params.amountBMin),
              address(params.to),
            ],
          },
        ]
      : [
          { contractId: resolvedA, method: ABI.token.approve, args: [address(quote.pool), i128(quote.amountA)] },
          { contractId: resolvedB, method: ABI.token.approve, args: [address(quote.pool), i128(quote.amountB)] },
          {
            contractId: quote.pool,
            method: ABI.pair.addLiquidity,
            args: [
              address(resolvedA),
              address(resolvedB),
              i128(quote.amountA),
              i128(quote.amountB),
              i128(params.amountAMin),
              i128(params.amountBMin),
              address(params.to),
            ],
          },
        ];

    const result = await this.client.submitContractCall({ operations, deadline });
    return { hash: result.hash };
  }

  /** Quote the tokens released when burning `liquidity` LP tokens. */
  async getRemoveLiquidityQuote(tokenA: string, tokenB: string, liquidity: bigint): Promise<RemoveLiquidityQuote> {
    const { pair, reserveA, reserveB, totalSupply } = await this.pairState(tokenA, tokenB);
    const { amountA, amountB } = getRemoveLiquidityAmounts(liquidity, reserveA, reserveB, totalSupply);
    const sharePct =
      totalSupply > 0n ? Number((liquidity * 1_000_000_000_000n) / totalSupply) / 10_000_000_000 : 0;
    return {
      pool: pair.address,
      tokenA: pair.tokenA,
      tokenB: pair.tokenB,
      amountA,
      amountB,
      sharePct,
    };
  }

  /** Remove liquidity with minimum-output protection per side. */
  async removeLiquidity(params: RemoveLiquidityParams): Promise<{ hash: string }> {
    const deadline = computeDeadline(params.deadline);
    assertNotExpired(deadline);
    if (!params.to) {
      throw new ValidationError("`to` is required");
    }
    const pair = await this.client.getPair(params.tokenA, params.tokenB);
    if (!pair) {
      throw new NotFoundError(`no CoralSwap pair exists for ${params.tokenA}/${params.tokenB}`);
    }

    const router = this.client.contractConfig.router;
    const operations = router
      ? [
          {
            contractId: router,
            method: ABI.router.removeLiquidity,
            args: [
              address(pair.tokenA),
              address(pair.tokenB),
              i128(params.liquidity),
              i128(params.amountAMin),
              i128(params.amountBMin),
              address(params.to),
            ],
          },
        ]
      : [
          { contractId: pair.address, method: ABI.token.approve, args: [address(pair.address), i128(params.liquidity)] },
          {
            contractId: pair.address,
            method: ABI.pair.removeLiquidity,
            args: [
              i128(params.liquidity),
              i128(params.amountAMin),
              i128(params.amountBMin),
              address(params.to),
            ],
          },
        ];

    const result = await this.client.submitContractCall({ operations, deadline });
    return { hash: result.hash };
  }

  /** Convenience: the pool/LP-token address for a token pair. */
  async getPool(tokenA: string, tokenB: string): Promise<string> {
    const pair = await this.client.getPair(tokenA, tokenB);
    if (!pair) {
      throw new ConfigError(`no pool for ${tokenA}/${tokenB}`);
    }
    return pair.address;
  }
}