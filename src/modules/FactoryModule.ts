import type { CoralSwapClient } from "../client/CoralSwapClient";
import { ABI } from "../contracts";
import { ConfigError, NotFoundError } from "../errors";
import { address } from "../soroban/scval";
import { isValidContractAddress } from "../utils/address";

export interface PairInfo {
  address: string;
  tokenA: string;
  tokenB: string;
}

/**
 * Reads pair information and token metadata from the CoralSwap factory.
 */
export class FactoryModule {
  constructor(private readonly client: CoralSwapClient) {}

  private get factoryAddress(): string {
    const factory = this.client.contractConfig.factory;
    if (!factory) {
      throw new ConfigError("factory contract address is not configured (set `contractConfig.factory`)");
    }
    return factory;
  }

  /** Enumerate every registered pair. */
  async getAllPairs(): Promise<PairInfo[]> {
    const raw = await this.client.readContract(this.factoryAddress, ABI.factory.allPairs);
    const addresses = Array.isArray(raw) ? (raw as unknown[]) : [];
    const pairs: PairInfo[] = [];
    for (const entry of addresses) {
      const addressValue = Array.isArray(entry) ? (entry[0] as string) : (entry as string);
      if (typeof addressValue === "string" && isValidContractAddress(addressValue)) {
        pairs.push(await this.getPairInfo(addressValue));
      }
    }
    return pairs;
  }

  /** Number of pairs registered in the factory. */
  async pairCount(): Promise<number> {
    const raw = await this.client.readContract(this.factoryAddress, ABI.factory.pairCount);
    return typeof raw === "number" ? raw : Number(raw);
  }

  /**
   * Look up the pair for `tokenA`/`tokenB`. Returns `null` when no pair exists.
   * Accepts native identifiers (`"XLM"` / `"native"`).
   */
  async getPair(tokenA: string, tokenB: string): Promise<PairInfo | null> {
    const [resolvedA, resolvedB] = [this.client.resolveToken(tokenA), this.client.resolveToken(tokenB)];
    const [token0, token1] = token0Of(resolvedA, resolvedB);
    const result = await this.client.readContract(this.factoryAddress, ABI.factory.pair, [
      address(token0),
      address(token1),
    ]);
    if (result === null || result === undefined) {
      return null;
    }
    return { address: String(result), tokenA: token0, tokenB: token1 };
  }

  /** Look up a pair and throw `NotFoundError` when it does not exist. */
  async getPairOrThrow(tokenA: string, tokenB: string): Promise<PairInfo> {
    const pair = await this.getPair(tokenA, tokenB);
    if (!pair) {
      throw new NotFoundError(`no CoralSwap pair exists for ${tokenA}/${tokenB}`);
    }
    return pair;
  }

  /** Resolve the pair at a known address to its two tokens. */
  async getPairInfo(pairAddress: string): Promise<PairInfo> {
    const [token0, token1] = await Promise.all([
      this.client.readContract(pairAddress, ABI.pair.token0),
      this.client.readContract(pairAddress, ABI.pair.token1),
    ]);
    return {
      address: pairAddress,
      tokenA: String(token0),
      tokenB: String(token1),
    };
  }

  /** Decimals of a SEP-41 token (cached per token). */
  async tokenDecimals(token: string): Promise<number> {
    const resolved = this.client.resolveToken(token);
    const cacheKey = `decimals:${resolved}`;
    const cached = this.client.cache.get(cacheKey);
    if (typeof cached === "number") {
      return cached;
    }
    const raw = await this.client.readContract(resolved, ABI.token.decimals);
    const decimals = Number(raw);
    this.client.cache.set(cacheKey, decimals, 10 * 60_000);
    return decimals;
  }
}

function token0Of(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}