import * as StellarSdk from "@stellar/stellar-sdk";
import { DEFAULT_POLL_INTERVAL_MS } from "../constants";
import { ConfigError, RpcError, TransactionFailedError } from "../errors";
import { Logger } from "../logger";
import { fromScVal, toScVal, type ContractArg, type ScVal } from "./scval";
import { SorobanRpc } from "./rpc";

export interface ContractCallOperation {
  contractId: string;
  method: string;
  args: ContractArg[];
}

export interface ReadContractSpec {
  contractId: string;
  method: string;
  args?: ContractArg[];
  source?: string;
}

export interface SubmitContractSpec {
  operations: ContractCallOperation[];
  /** Actor sending the transaction. Defaults to the client's public key. */
  source?: string;
  deadline?: number;
  fee?: string;
  pollIntervalMs?: number;
  /** Total time to keep polling for a transaction result, in ms. */
  pollTimeoutMs?: number;
}

export interface SubmitContractResult {
  hash: string;
  status: "success" | "failed";
  ledger?: number;
  createdAt?: number;
  result?: unknown;
}

export interface ContractRunnerOptions {
  rpc: SorobanRpc;
  networkPassphrase: string;
  secretKey?: string;
  logger?: Logger;
}

const MAX_SIGNING_TIME_SECONDS = 60 * 5;

/** Builds, simulates, signs, and submits Soroban contract transactions. */
export class ContractRunner {
  readonly rpc: SorobanRpc;
  private readonly networkPassphrase: string;
  private readonly secretKey?: string;
  private readonly logger: Logger;

  constructor(options: ContractRunnerOptions) {
    this.rpc = options.rpc;
    this.networkPassphrase = options.networkPassphrase;
    this.secretKey = options.secretKey;
    this.logger = options.logger ?? new Logger({ level: "warn" });
  }

  private keypair(): StellarSdk.Keypair {
    if (!this.secretKey) {
      throw new ConfigError("a secretKey is required to submit contract calls");
    }
    return StellarSdk.Keypair.fromSecret(this.secretKey);
  }

  private async accountFor(source: string): Promise<StellarSdk.Account> {
    try {
      return await this.rpc.getAccount(source);
    } catch {
      return new StellarSdk.Account(source, "0");
    }
  }

  private scVals(operations: ContractCallOperation[]): ScVal[][] {
    return operations.map((op) => op.args.map((arg) => toScVal(arg)));
  }

  private buildTransaction(
    account: StellarSdk.Account,
    operations: ContractCallOperation[],
    source: string,
    fee: string,
    deadline?: number,
  ): StellarSdk.Transaction {
    const builder = new StellarSdk.TransactionBuilder(account, {
      fee,
      networkPassphrase: this.networkPassphrase,
    });

    for (const op of operations) {
      builder.addOperation(
        new StellarSdk.Contract(op.contractId).call(op.method, ...this.scVals([op])[0]!),
      );
    }

    if (deadline !== undefined) {
      builder.setTimebounds(Math.floor(Date.now() / 1000), deadline);
    } else {
      builder.setTimeout(MAX_SIGNING_TIME_SECONDS);
    }

    return builder.build();
  }

  /**
   * Simulate a read-only contract invocation and return the decoded result.
   */
  async read(spec: ReadContractSpec): Promise<unknown> {
    if (!spec.source) {
      throw new ConfigError("a source account is required to simulate contract reads");
    }
    const operations: ContractCallOperation[] = [
      { contractId: spec.contractId, method: spec.method, args: spec.args ?? [] },
    ];
    const account = await this.accountFor(spec.source);
    const tx = this.buildTransaction(account, operations, spec.source, "100");

    let sim: StellarSdk.rpc.Api.SimulateTransactionResponse;
    try {
      sim = await this.rpc.simulateTransaction(tx);
    } catch (error) {
      throw new RpcError(`simulateTransaction failed for ${spec.contractId}::${spec.method}`, { cause: error });
    }

    if (StellarSdk.rpc.Api.isSimulationError(sim)) {
      throw new RpcError(
        `contract call reverted: ${spec.contractId}::${spec.method} (${sim.error ?? "unknown error"})`,
      );
    }

    const returnValue = sim.result?.retval;
    if (returnValue === undefined) {
      throw new RpcError(
        `contract call returned no value: ${spec.contractId}::${spec.method} (simulation had no result)`,
      );
    }
    return fromScVal(returnValue);
  }

  /**
   * Build, simulate, sign, and submit a (possibly multi-operation) contract
   * transaction, then poll until it is included or times out.
   */
  async submit(spec: SubmitContractSpec): Promise<SubmitContractResult> {
    const source = spec.source;
    if (!source) {
      throw new ConfigError("a source account is required to submit contract calls");
    }
    const keypair = this.keypair();
    const account = await this.accountFor(source);
    const fee = spec.fee ?? "100";

    const tx = this.buildTransaction(account, spec.operations, source, fee, spec.deadline);

    let sim: StellarSdk.rpc.Api.SimulateTransactionResponse;
    try {
      sim = await this.rpc.simulateTransaction(tx);
    } catch (error) {
      throw new RpcError("simulateTransaction failed", { cause: error });
    }
    if (StellarSdk.rpc.Api.isSimulationError(sim)) {
      throw new RpcError(`transaction simulation failed: ${sim.error ?? "unknown error"}`);
    }

    const prepared = await this.rpc.prepareTransaction(tx);
    prepared.sign(keypair);

    // Boundary redaction: only a hash prefix (no signed envelope XDR) is logged.
    const unsignedXdr = prepared.toXDR();

    let sent: StellarSdk.rpc.Api.SendTransactionResponse;
    try {
      sent = await this.rpc.sendTransaction(prepared);
    } catch (error) {
      throw new RpcError("sendTransaction failed", { cause: error });
    }

    if (sent.status === "ERROR") {
      throw new TransactionFailedError("transaction rejected: sendTransaction returned ERROR status", {
        details: { errorResult: sent.errorResult ? sent.errorResult.toXDR("base64") : undefined },
      });
    }

    const hash = sent.hash;
    const decoded = hash.startsWith("0x") ? hash : `0x${hash}`;
    this.logger.debug("transaction submitted; polling for result", {
      hash: decoded,
      txSize: unsignedXdr.length,
    });

    let receipt: StellarSdk.rpc.Api.GetTransactionResponse;
    try {
      receipt = await this.rpc.pollTransaction(hash, {
        timeoutMs: spec.pollTimeoutMs,
        intervalMs: spec.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      });
    } catch (error) {
      throw new TransactionFailedError(`timed out polling for transaction ${hash}`, { cause: error });
    }

    if (receipt.status === "FAILED") {
      const resultXdr = receipt.resultXdr ? receipt.resultXdr.toXDR("base64").slice(0, 64) : "(unavailable)";
      throw new TransactionFailedError(`transaction failed on ledger ${receipt.ledger}`, {
        details: { hash: decoded, resultXdrPrefix: resultXdr },
      });
    }
    if (receipt.status !== "SUCCESS") {
      throw new TransactionFailedError(`transaction finished with status "${receipt.status}"`, {
        details: { hash: decoded },
      });
    }

    return {
      hash: decoded,
      status: "success",
      ledger: receipt.ledger,
      createdAt: receipt.createdAt,
      result: receipt.returnValue !== undefined ? fromScVal(receipt.returnValue) : undefined,
    };
  }
}