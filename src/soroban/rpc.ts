import * as StellarSdk from "@stellar/stellar-sdk";
import { DEFAULT_RPC_TIMEOUT_MS, DEFAULT_POLL_INTERVAL_MS } from "../constants";

export type SorobanServer = StellarSdk.rpc.Server;

type HealthResponse = StellarSdk.rpc.Api.GetHealthResponse;
type LatestLedgerResponse = StellarSdk.rpc.Api.GetLatestLedgerResponse;
type SimulateResponse = StellarSdk.rpc.Api.SimulateTransactionResponse;
type SendResponse = StellarSdk.rpc.Api.SendTransactionResponse;
type GetTransactionResponse = StellarSdk.rpc.Api.GetTransactionResponse;

/** Options accepted for `pollTransaction`. */
export interface PollOptions {
  /** Total polling budget in ms. Attempts are `budget / interval`. */
  timeoutMs?: number;
  intervalMs?: number;
}

export interface SorobanRpcOptions {
  rpcUrl: string;
  allowHttp?: boolean;
  timeoutMs?: number;
}

/**
 * Thin wrapper around `@stellar/stellar-sdk`'s Soroban RPC server.
 *
 * Kept deliberately small so the rest of the SDK depends on a stable surface
 * and it can be mocked in tests.
 */
export class SorobanRpc {
  readonly server: SorobanServer;
  readonly rpcUrl: string;

  constructor(options: SorobanRpcOptions) {
    this.rpcUrl = options.rpcUrl;
    this.server = new StellarSdk.rpc.Server(options.rpcUrl, {
      allowHttp: options.allowHttp ?? false,
      timeout: options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
    });
  }

  getHealth(): Promise<HealthResponse> {
    return this.server.getHealth();
  }

  getLatestLedger(): Promise<LatestLedgerResponse> {
    return this.server.getLatestLedger();
  }

  getAccount(address: string): Promise<StellarSdk.Account> {
    return this.server.getAccount(address);
  }

  simulateTransaction(tx: StellarSdk.Transaction): Promise<SimulateResponse> {
    return this.server.simulateTransaction(tx);
  }

  prepareTransaction(tx: StellarSdk.Transaction): Promise<StellarSdk.Transaction> {
    return this.server.prepareTransaction(tx);
  }

  sendTransaction(tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction): Promise<SendResponse> {
    return this.server.sendTransaction(tx);
  }

  getTransaction(hash: string): Promise<GetTransactionResponse> {
    return this.server.getTransaction(hash);
  }

  /** Poll for transaction completion until `opts.timeoutMs` elapses. */
  async pollTransaction(hash: string, opts?: PollOptions): Promise<GetTransactionResponse> {
    const intervalMs = opts?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const attempts = Math.max(3, Math.ceil(timeoutMs / intervalMs));
    return this.server.pollTransaction(hash, { attempts });
  }
}