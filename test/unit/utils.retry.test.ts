import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../src/utils/retry";
import { DeadlineError } from "../../src/errors";

describe("withRetry", () => {
  it("returns a successful result without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("boom");
      return "recovered";
    });
    await expect(withRetry(fn, { maxRetries: 5, baseDelayMs: 1 })).resolves.toBe("recovered");
    expect(calls).toBe(3);
  });

  it("throws when maxRetries are exhausted", async () => {
    const error = new Error("boom");
    const fn = vi.fn(async () => {
      throw error;
    });
    const onRetry = vi.fn();
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1, onRetry })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("does not retry when retryable returns false", async () => {
    const error = new Error("permanent");
    const fn = vi.fn(async () => {
      throw error;
    });
    await expect(
      withRetry(fn, { maxRetries: 5, baseDelayMs: 1, retryable: (err) => err !== error }),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws DeadlineError when the total budget elapses", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(withRetry(fn, { maxRetries: 10, baseDelayMs: 100_000, deadlineMs: 5 })).rejects.toBeInstanceOf(
      DeadlineError,
    );
  });
});