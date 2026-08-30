import { describe, it, expect } from "vitest";
import { FlashLoanModule } from "../../src/modules/FlashLoanModule";
import type { CoralSwapClient } from "../../src/client/CoralSwapClient";
import { ABI } from "../../src/contracts";
import { ValidationError } from "../../src/errors";
import { createMockClient, testContractId } from "./helpers";

const PAIR = testContractId(4);
const TOKEN = testContractId(1);
const RECEIVER = testContractId(5);

function flash(): { module: FlashLoanModule; client: ReturnType<typeof createMockClient> } {
  const client = createMockClient();
  client.getFee.mockImplementation(async () => 30n);
  return { module: new FlashLoanModule(client as unknown as CoralSwapClient), client };
}

describe("FlashLoanModule.estimateFee", () => {
  it("computes feeAmount and repayAmount from the pair fee", async () => {
    const { module } = flash();
    const estimate = await module.estimateFee(PAIR, TOKEN, 1_000_000n);
    expect(estimate.feeBps).toBe(30);
    expect(estimate.feeAmount).toBe(3000n);
    expect(estimate.repayAmount).toBe(1_003_000n);
    expect(estimate.token).toBe(TOKEN);
  });

  it("rejects non-positive loan amounts", async () => {
    const { module } = flash();
    await expect(module.estimateFee(PAIR, TOKEN, 0n)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("FlashLoanModule.execute", () => {
  it("submits a flash_loan op with receiver and callback data", async () => {
    const { module, client } = flash();
    const result = await module.execute({
      pairAddress: PAIR,
      token: TOKEN,
      amount: 1_000_000n,
      receiverAddress: RECEIVER,
      callbackData: Buffer.from("cb"),
    });
    const [op] = client.submitContractCall.mock.calls[0]![0].operations;
    expect(op.contractId).toBe(PAIR);
    expect(op.method).toBe(ABI.pair.flashLoan);
    expect(op.args[0]).toMatchObject({ type: "i128", value: 1_000_000n });
    expect(result.estimate.repayAmount).toBe(1_003_000n);
    expect(result.hash).toBeTruthy();
  });
});