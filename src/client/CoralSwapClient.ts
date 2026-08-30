import * as StellarSdk from "@stellar/stellar-sdk";
import { ConfigError } from "../errors";
import { TTLCache, type CacheOptions } from "../cache";
import { ABI, validateContractConfig, type ContractConfig } from "../contracts";
import { Logger, type LoggerOptions } from "../logger";
import { ContractRunner, type SubmitContractResult, type SubmitContractSpec } from "../soroban/contractRunner";
import { SorobanRpc } from "../soroban/rpc";
import { type ContractArg } from "../soroban/scval";
import { getNetworkConfig, Network, type NetworkConfig } from "./Network";
import { resolveTokenIdentifier, type NativeAssetSymbol } from "../utils/tokenIdentifier";
import { withRetry } from "../utils/retry";
import { FactoryModule } from "../modules/FactoryModule";

export interface CoralSwapClientOptions {
  network: Network;
  /** RPC endpoint; defaults to the network's canonical Soroban RPC URL. */
  rpcUrl?: string;
  /**
   * Signing secret key for the actor performing swaps/liquidity changes.
   * Derives `publicKey` when the latter is not supplied explicitly.
   */
  secretKey?: string;
  /** Public key ("G...") used as the default source for simulations/reads. */
  publicKey?: string;
  /**
   * Hard ceiling (ms) for the total time any single RPC call (or transaction
   * poll) may spend, including retries. Once elapsed a `DeadlineError` is
   * thrown. Pass per-call via `withRetry(..., { deadlineMs })` otherwise.
   */
  deadlineMs?: number;
  /** Allow `http://` RPC URLs (local/soroban-cli networks). Default `false`. */
  allowHttp?: boolean;
  /** Override the network passphrase (custom deployments). */
  networkPassphrase?: string;
  /** Factory/router contract ids and on-chain tuning knobs. */
  contractConfig?: ContractConfig;
  /** Native SAC address override map, keyed by passphrase. */
  sacAddresses?: Record<string, string>;
  /** Logger options or a pre-built `Logger`. */
  logger?: LoggerOptions | Logger;
  /** TTL cache tuning for reserves/fees/pairs. */
  cache?: CacheOptions;
}

export interface ReadContractOptions {
  source?: string;
}

export interface Reserves {
  reserve0: bigint;
  reserve1: bigint;
}

const FEE_CACHE_TTL_MS = 15_000;

/**
 * Contract-first client: talks directly to CoralSwap's Soroban contracts over
 * Soroban RPC — no gateway, no API keys.
 *
 * Owns the network config, signer, retry/deadline policy, TTL cache, rotation
 * of the low-level contract runner, and the `factory` module.
 */
export class CoralSwapClient {
  readonly networkConfig: NetworkConfig;
  readonly publicKey?: string;
  readonly deadlineMs?: number;
  readonly logger: Logger;
  readonly cache: TTLCache<string, unknown>;
  readonly contractConfig: ReturnType<typeof validateContractConfig>;

  private readonly rpc: SorobanRpc;
  private readonly runner: ContractRunner;
  private readonly secretKey?: string;
  private readonly sacAddresses?: Record<string, string>;
  private readonly factoryModule: FactoryModule;

  constructor(options: CoralSwapClientOptions) {
    const baseNetwork = getNetworkConfig(options.network, options.rpcUrl);
    this.networkConfig = {
      ...baseNetwork,
      networkPassphrase: options.networkPassphrase ?? baseNetwork.networkPassphrase,
    };

    this.secretKey = options.secretKey;
    this.publicKey = options.secretKey
      ? StellarSdk.Keypair.fromSecret(options.secretKey).publicKey()
      : options.publicKey;

    this.deadlineMs = options.deadlineMs;
    this.logger = options.logger instanceof Logger ? options.logger : new Logger(options.logger ?? {});
    this.cache = new TTLCache<string, unknown>(options.cache);
    this.sacAddresses = options.sacAddresses;
    this.contractConfig = validateContractConfig(options.contractConfig);

    this.rpc = new SorobanRpc({
      rpcUrl: this.networkConfig.rpcUrl,
      allowHttp: options.allowHttp ?? false,
    });
    this.runner = new ContractRunner({
      rpc: this.rpc,
      networkPassphrase: this.networkConfig.networkPassphrase,
      secretKey: this.secretKey,
      logger: this.logger,
    });
    this.factoryModule = new FactoryModule(this);
  }

  /** Factory module: pair enumeration, pair lookup, token decimals. */
  get factory(): FactoryModule {
    return this.factoryModule;
  }

  /** Resolve an identifier (`"XLM"`/`"native"` or a `C...` contract) to an address. */
  resolveToken(tokenId: string | NativeAssetSymbol): string {
    return resolveTokenIdentifier(tokenId, this.networkConfig.networkPassphrase, this.sacAddresses);
  }

  /** RPC health probe with retry/deadline policy applied. */
  isHealthy(): Promise<boolean> {
    return withRetry(
      async () => {
        const health = await this.rpc.getHealth();
        return health.status === "healthy";
      },
      { deadlineMs: this.deadlineMs },
    ).catch((error) => {
      this.logger.warn("RPC health check failed", { error });
      return false;
    });
  }

  /** Latest ledger sequence number. */
  getLatestLedger(): Promise<{ sequence: number; protocolVersion: string }> {
    return withRetry(
      async () => {
        const ledger = await this.rpc.getLatestLedger();
        return { sequence: ledger.sequence, protocolVersion: ledger.protocolVersion };
      },
      { deadlineMs: this.deadlineMs },
    );
  }

  /**
   * Simulate a read-only contract function and decode its return value.
   * Wrapped in `withRetry` honoring the client-wide `deadlineMs`.
   */
  async readContract(
    contractId: string,
    method: string,
    args?: ContractArg[],
    options?: ReadContractOptions,
  ): Promise<unknown> {
    const source = options?.source ?? this.requiredPublicKey();
    return withRetry(
      () =>
        this.runner.read({
          contractId,
          method,
          args,
          source,
        }),
      { deadlineMs: this.deadlineMs },
    );
  }

  /** Build, sign, submit, and poll a (possibly multi-operation) contract transaction. */
  async submitContractCall(spec: SubmitContractSpec): Promise<SubmitContractResult> {
    const pollTimeoutMs = spec.pollTimeoutMs ?? this.deadlineMs;
    this.logger.debug("submitting contract call", {
      operations: spec.operations.map((op) => ({ contractId: op.contractId, method: op.method })),
    });
    const resolved: SubmitContractSpec = { ...spec, source: spec.source ?? this.publicKey, pollTimeoutMs };
    let result: SubmitContractResult;
    try {
      result = await this.runner.submit(resolved);
    } catch (error) {
      this.logger.warn("contract call failed", { error: (error as Error).message });
      throw error;
    }
    this.logger.debug("contract call succeeded", { hash: result.hash });
    return result;
  }

  /** Cached pair lookup (accepts `"XLM"`/`"native"`). Returns `null` if absent. */
  async getPair(
    tokenA: string,
    tokenB: string,
    useCache: boolean = true,
  ): Promise<{ address: string; tokenA: string; tokenB: string } | null> {
    const [resolvedA, resolvedB] = [this.resolveToken(tokenA), this.resolveToken(tokenB)];
    const [token0, token1] = resolvedA < resolvedB ? [resolvedA, resolvedB] : [resolvedB, resolvedA];
    const cacheKey = `pair:${token0}:${token1}`;
    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached as { address: string; tokenA: string; tokenB: string };
      }
    }
    const pair = await this.factory.getPair(resolvedA, resolvedB);
    if (pair) {
      this.cache.set(cacheKey, pair, this.contractConfig.cacheTtlMs);
    }
    return pair;
  }

  /** Read (and cache) reserves for a pair. */
  async getReserves(pairAddress: string): Promise<Reserves> {
    const cacheKey = `reserves:${pairAddress}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as Reserves;
    }
    const raw = await this.readContract(pairAddress, ABI.pair.getReserves);
    const record = (raw ?? {}) as Record<string, unknown>;
    const reserves: Reserves = {
      reserve0: toBigInt(record.reserve0 ?? record.reserve_0),
      reserve1: toBigInt(record.reserve1 ?? record.reserve_1),
    };
    this.cache.set(cacheKey, reserves, this.contractConfig.cacheTtlMs);
    return reserves;
  }

  /** Read (and cache) the total LP supply of a pair. */
  async getTotalSupply(pairAddress: string): Promise<bigint> {
    const cacheKey = `supply:${pairAddress}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached as bigint;
    }
    const raw = await this.readContract(pairAddress, ABI.pair.totalSupply);
    this.cache.set(cacheKey, BigInt(Number(raw)), this.contractConfig.cacheTtlMs);
    return BigInt(Number(raw));
  }

  /** Current dynamic fee (bps) for a pair, cached for `FEE_CACHE_TTL_MS`. */
  async getFee(pairAddress: string): Promise<bigint> {
    const cacheKey = `fee:${pairAddress}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached as bigint;
    }
    const raw = await this.readContract(pairAddress, ABI.pair.getFee);
    const fee = BigInt(Number(raw));
    this.cache.set(cacheKey, fee, FEE_CACHE_TTL_MS);
    return fee;
  }

  private requiredPublicKey(): string {
    if (!this.publicKey) {
      throw new ConfigError(
        "a public key (or secretKey) is required for contract reads/simulation",
      );
    }
    return this.publicKey;
  }
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  return 0n;
}