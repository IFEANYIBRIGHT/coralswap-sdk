import { ConfigError } from "../errors";
import { isValidContractAddress } from "../utils/address";

/**
 * Contract function names assumed by the SDK.
 *
 * CoralSwap is contract-first: these names sit behind a single configuration
 * object so they can be remapped without code changes if a deployment ships a
 * different ABI (see `docs/PERFORMANCE.md` and the network-tab in README).
 */
export const ABI = {
  factory: {
    allPairs: "all_pairs",
    pair: "pair",
    pairCount: "pair_count",
  },
  pair: {
    getReserves: "get_reserves",
    totalSupply: "total_supply",
    token0: "token_0",
    token1: "token_1",
    getFee: "get_fee",
    swapExactIn: "swap_exact_in",
    swapExactOut: "swap_exact_out",
    addLiquidity: "add_liquidity",
    removeLiquidity: "remove_liquidity",
    flashLoan: "flash_loan",
    observe: "observe",
    getTwap: "get_twap",
  },
  token: {
    decimals: "decimals",
    balance: "balance",
    approve: "approve",
    transfer: "transfer",
  },
  router: {
    swapExactIn: "swap_exact_in",
    swapExactOut: "swap_exact_out",
    addLiquidity: "add_liquidity",
    removeLiquidity: "remove_liquidity",
  },
} as const;

export interface ContractConfig {
  /** Factory contract that enumerates and derives pairs. */
  factory?: string;
  /** Optional router contract used for swap/liquidity multi-token flows. */
  router?: string;
  /** Base fee in stroops used when building transactions. */
  fee?: string;
  /** Default resident time (in ms) for cached on-chain values such as reserves. */
  cacheTtlMs?: number;
  /** Swap is considered stale when this many seconds pass without a fee update. */
  stalenessSeconds?: number;
}

const DEFAULT_MAX_FEE_STROOPS = "100000";

export function validateContractConfig(config: ContractConfig | undefined): ContractConfig {
  const factory = config?.factory;
  const router = config?.router;
  if (factory !== undefined && !isValidContractAddress(factory)) {
    throw new ConfigError(`configured factory address is not a valid contract address: "${factory}"`);
  }
  if (router !== undefined && !isValidContractAddress(router)) {
    throw new ConfigError(`configured router address is not a valid contract address: "${router}"`);
  }
  if (config?.router === undefined && factory === undefined) {
    throw new ConfigError(
      "a CoralSwap factory contract id is required — set `contractConfig.factory` " +
        "(or `contractConfig.router` if using router-based execution)",
    );
  }
  return {
    factory,
    router,
    fee: config?.fee ?? DEFAULT_MAX_FEE_STROOPS,
    cacheTtlMs: config?.cacheTtlMs ?? 30_000,
    stalenessSeconds: config?.stalenessSeconds ?? 60 * 60,
  };
}