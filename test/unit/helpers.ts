import * as StellarSdk from "@stellar/stellar-sdk";
import { vi } from "vitest";
import type { CoralSwapClient, Reserves } from "../../src/client/CoralSwapClient";
import { TTLCache } from "../../src/cache/TTLCache";
import { Logger } from "../../src/logger/Logger";
import { resolveTokenIdentifier } from "../../src/utils/tokenIdentifier";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export function testAccountId(): string {
  return StellarSdk.Keypair.random().publicKey();
}

export function testSecretKey(): string {
  return StellarSdk.Keypair.random().secret();
}

export function testContractId(byte: number, salt = 0): string {
  const buf = Buffer.alloc(32);
  buf.fill(byte & 0xff);
  buf.writeUInt32BE(salt, 0);
  return StellarSdk.StrKey.encodeContract(buf);
}

export interface MockClientConfig {
  contractConfig?: Partial<{
    factory: string;
    router?: string;
    fee: string;
    cacheTtlMs: number;
    stalenessSeconds: number;
  }>;
  publicKey?: string;
  pairs?: Record<string, { address: string; tokenA: string; tokenB: string } | null>;
  reserves?: Record<string, Reserves>;
  fees?: Record<string, bigint>;
  supplies?: Record<string, bigint>;
  reads?: Record<string, unknown>;
}

export interface MockClientSurface {
  resolveToken: (id: string) => string;
  contractConfig: NonNullable<CoralSwapClient["contractConfig"]>;
  publicKey?: string;
  deadlineMs?: number;
  logger: Logger;
  cache: TTLCache<string, unknown>;
  networkConfig: { networkPassphrase: string; rpcUrl: string; network: string };
  readContract: ReturnType<typeof vi.fn>;
  submitContractCall: ReturnType<typeof vi.fn>;
  getReserves: ReturnType<typeof vi.fn>;
  getPair: ReturnType<typeof vi.fn>;
  getFee: ReturnType<typeof vi.fn>;
  getTotalSupply: ReturnType<typeof vi.fn>;
}

export function createMockClient(config: MockClientConfig = {}): MockClientSurface {
  const testnetPassphrase = TESTNET_PASSPHRASE;
  const reads = config.reads ?? {};
  const readsCall = vi.fn(async (contractId: string, method: string) => reads[`${contractId}:${method}`]);
  const submitCall = vi.fn(async () => ({ hash: `0x${Buffer.alloc(32, 1).toString("hex")}`, status: "success" as const }));
  const getReserves = vi.fn(async () => ({ reserve0: 100_000_000n, reserve1: 200_000_000n }));
  const getPair = vi.fn(async (a: string, b: string) => {
    const key = [a, b].sort((x, y) => (x < y ? -1 : 1)).join(":");
    const found = config.pairs?.[key];
    if (found === null || found === undefined) return null;
    return found;
  });
  const getFee = vi.fn(async () => 30n);
  const getTotalSupply = vi.fn(async () => 1_000_000n);
  const cache = new TTLCache<string, unknown>({ ttlMs: 30_000 });

  const publicKey = config.publicKey ?? testAccountId();

  return {
    resolveToken: (id) => resolveTokenIdentifier(id, testnetPassphrase),
    contractConfig: {
      factory:
        "factory" in (config.contractConfig ?? {}) ? config.contractConfig?.factory : testContractId(9),
      router: config.contractConfig?.router,
      fee: config.contractConfig?.fee ?? "100",
      cacheTtlMs: config.contractConfig?.cacheTtlMs ?? 30_000,
      stalenessSeconds: config.contractConfig?.stalenessSeconds ?? 3600,
    },
    publicKey,
    deadlineMs: undefined,
    logger: new Logger({ level: "silent" }),
    cache,
    networkConfig: { networkPassphrase: testnetPassphrase, rpcUrl: "https://soroban-testnet.stellar.org", network: "TESTNET" },
    readContract: readsCall,
    submitContractCall: submitCall,
    getReserves,
    getPair,
    getFee,
    getTotalSupply,
  };
}