import {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_MAX_RETRIES,
} from "../constants";
import { DeadlineError } from "../errors";

export interface RetryOptions {
  /** Maximum number of retries after the first attempt. Default `4`. */
  maxRetries?: number;
  /** Base delay for the first backoff step, in ms. Default `250`. */
  baseDelayMs?: number;
  /** Upper bound for a single backoff step, in ms. Default `8000`. */
  maxDelayMs?: number;
  /**
   * Total wall-clock budget for the whole call (including all retries), in ms.
   * Once elapsed, a `DeadlineError` is thrown and no further attempts run.
   * Can also be set once on the client so every RPC call shares the bound.
   */
  deadlineMs?: number;
  /** Only retry when this predicate returns `true`. Default: retry everything. */
  retryable?: (error: unknown) => boolean;
  /** Called before each retry with the attempt index (1-based) and the error. */
  onRetry?: (info: { attempt: number; maxRetries: number; error: unknown; delayMs: number }) => void;
  /** Add up to `jitterMs` random noise to each delay to desynchronize nodes. */
  jitterMs?: number;
}

export interface RetryInfo {
  attempts: number;
  elapsedMs: number;
  deadlineMs?: number;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn`, retrying on failure with exponential backoff.
 *
 * - Retries only while `maxRetries` attempts remain.
 * - Honors an optional total `deadlineMs`; retries stop and a `DeadlineError`
 *   is thrown once it elapses.
 * - `retryable(err)` lets callers skip retrying permanent failures.
 *
 * @example
 * const pairs = await withRetry(() => client.factory.getAllPairs(), {
 *   maxRetries: 5,
 *   baseDelayMs: 500,
 * });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const deadlineMs = options.deadlineMs;
  const jitterMs = options.jitterMs ?? 0;

  const startedAt = Date.now();
  const deadlineAt = deadlineMs !== undefined ? startedAt + deadlineMs : undefined;
  const info: RetryInfo = {
    attempts: 0,
    elapsedMs: 0,
    deadlineMs,
  };

  while (true) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      throw new DeadlineError(
        `retry deadline exceeded after ${Date.now() - startedAt}ms (deadline ${deadlineMs}ms)`,
        { details: { attempts: info.attempts, deadlineMs } },
      );
    }

    try {
      const result = await fn();
      info.elapsedMs = Date.now() - startedAt;
      return result;
    } catch (error) {
      info.attempts += 1;

      if (options.retryable && !options.retryable(error)) {
        info.elapsedMs = Date.now() - startedAt;
        throw error;
      }
      if (info.attempts > maxRetries) {
        info.elapsedMs = Date.now() - startedAt;
        throw error;
      }

      const exponential = baseDelayMs * 2 ** (info.attempts - 1);
      let backoffMs = Math.min(exponential, maxDelayMs);
      if (jitterMs > 0) {
        backoffMs += Math.floor(Math.random() * Math.min(jitterMs, backoffMs));
      }

      if (deadlineAt !== undefined && Date.now() + backoffMs >= deadlineAt) {
        options.onRetry?.({
          attempt: info.attempts,
          maxRetries,
          error,
          delayMs: 0,
        });
        throw new DeadlineError(
          `retry deadline exceeded after ${Date.now() - startedAt}ms (deadline ${deadlineMs}ms)`,
          { details: { attempts: info.attempts, deadlineMs }, cause: error },
        );
      }

      options.onRetry?.({
        attempt: info.attempts,
        maxRetries,
        error,
        delayMs: backoffMs,
      });

      await delay(backoffMs);
    }
  }
}