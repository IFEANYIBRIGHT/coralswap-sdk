import { ABI } from "../contracts";
import { ValidationError } from "../errors";
import { address, bytesValue, i128 } from "../soroban/scval";
import type { CoralSwapClient } from "../client/CoralSwapClient";

export interface FlashLoanEstimate {
  pair: string;
  token: string;
  amount: bigint;
  feeBps: number;
  feeAmount: bigint;
  repayAmount: bigint;
}

export interface FlashLoanParams {
  pairAddress: string;
  token: string;
  amount: bigint;
  /** Contract that receives the loan and (in the *same* invocation) repays it. */
  receiverAddress: string;
  /** Opaque payload forwarded to `receiverAddress`. */
  callbackData?: Buffer | Uint8Array;
  deadline?: number;
}

export interface FlashLoanResult {
  hash: string;
  estimate: FlashLoanEstimate;
}

/**
 * Estimate and execute CoralSwap flash loans.
 *
 * A flash loan borrows a pair's token, invokes `receiverAddress`'s flash
 * receiver in the same transaction, and requires repayment (principal + fee)
 * before the transaction closes; otherwise it aborts.
 */
export class FlashLoanModule {
  constructor(private readonly client: CoralSwapClient) {}

  /** Read the pair's fee and compute the loan fee + repayment amount. */
  async estimateFee(pairAddress: string, token: string, amount: bigint): Promise<FlashLoanEstimate> {
    if (amount <= 0n) {
      throw new ValidationError(`flash loan amount must be positive, got ${amount}`);
    }
    const feeBps = Number(await this.client.getFee(pairAddress));
    const feeAmount = (amount * BigInt(feeBps)) / 10000n;
    return {
      pair: pairAddress,
      token: this.client.resolveToken(token),
      amount,
      feeBps,
      feeAmount,
      repayAmount: amount + feeAmount,
    };
  }

  /** Execute a flash loan. The fee is charged on top of `amount`. */
  async execute(params: FlashLoanParams): Promise<FlashLoanResult> {
    const estimate = await this.estimateFee(params.pairAddress, params.token, params.amount);
    const callbackData = params.callbackData ?? Buffer.alloc(0);

    const result = await this.client.submitContractCall({
      operations: [
        {
          contractId: params.pairAddress,
          method: ABI.pair.flashLoan,
          args: [
            i128(params.amount),
            address(this.client.resolveToken(params.token)),
            address(params.receiverAddress),
            bytesValue(Buffer.isBuffer(callbackData) ? callbackData : Buffer.from(callbackData)),
          ],
        },
      ],
      deadline: params.deadline,
    });

    return { hash: result.hash, estimate };
  }
}