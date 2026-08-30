import { CoralSwapSDKError } from "./CoralSwapSDKError";
import { ErrorCode } from "./codes";
import {
  ConfigError,
  DeadlineError,
  InsufficientLiquidityError,
  NetworkError,
  NotFoundError,
  RedactionBlockedError,
  RpcError,
  SlippageError,
  TransactionFailedError,
  UnauthorizedError,
  ValidationError,
} from "./index";

const ERROR_CODE_OF_CODE_STRING: Record<string, ErrorCode | undefined> = {
  [ErrorCode.DEADLINE]: ErrorCode.DEADLINE,
  [ErrorCode.SLIPPAGE]: ErrorCode.SLIPPAGE,
  [ErrorCode.INSUFFICIENT_LIQUIDITY]: ErrorCode.INSUFFICIENT_LIQUIDITY,
  [ErrorCode.RPC]: ErrorCode.RPC,
  [ErrorCode.NETWORK]: ErrorCode.NETWORK,
  [ErrorCode.TRANSACTION]: ErrorCode.TRANSACTION,
  [ErrorCode.VALIDATION]: ErrorCode.VALIDATION,
  [ErrorCode.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [ErrorCode.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [ErrorCode.CONFIG]: ErrorCode.CONFIG,
  [ErrorCode.REDACTION]: ErrorCode.REDACTION,
};

const CONSTRUCTOR_BY_CODE: Record<
  ErrorCode,
  new (message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) => CoralSwapSDKError
> = {
  [ErrorCode.UNKNOWN]: class UnknownError extends CoralSwapSDKError {
    constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
      super(ErrorCode.UNKNOWN, message, options);
    }
  },
  [ErrorCode.DEADLINE]: DeadlineError,
  [ErrorCode.SLIPPAGE]: SlippageError,
  [ErrorCode.INSUFFICIENT_LIQUIDITY]: InsufficientLiquidityError,
  [ErrorCode.RPC]: RpcError,
  [ErrorCode.NETWORK]: NetworkError,
  [ErrorCode.TRANSACTION]: TransactionFailedError,
  [ErrorCode.VALIDATION]: ValidationError,
  [ErrorCode.NOT_FOUND]: NotFoundError,
  [ErrorCode.UNAUTHORIZED]: UnauthorizedError,
  [ErrorCode.CONFIG]: ConfigError,
  [ErrorCode.REDACTION]: RedactionBlockedError,
};

/**
 * Normalize an unknown thrown value into a `CoralSwapSDKError`.
 *
 * - Already-normalized SDK errors pass through untouched.
 * - Errors carrying a known code string (e.g. from a serialized error, a nested
 *   contract invocation, or a remote RPC error shape) are re-mapped by code.
 * - Remaining `Error`s are classified heuristically from their message using
 *   stable markers produced by the SDK (slippage, deadline, low liquidity).
 *
 * The original error is always preserved on `cause`.
 */
export function mapError(err: unknown): CoralSwapSDKError {
  if (err instanceof CoralSwapSDKError) {
    return err;
  }

  if (err instanceof Error) {
    const message = err.message ?? String(err);
    const codeMatch = message.match(/\b([A-Z_]{3,})\b/)?.[1];

    const nestedCode =
      (err as { code?: unknown }).code !== undefined
        ? ERROR_CODE_OF_CODE_STRING[String((err as { code?: unknown }).code)]
        : undefined;
    const fromCodeString = ERROR_CODE_OF_CODE_STRING[codeMatch ?? ""];

    const resolvedCode = nestedCode ?? fromCodeString;
    if (resolvedCode && CONSTRUCTOR_BY_CODE[resolvedCode]) {
      return new CONSTRUCTOR_BY_CODE[resolvedCode](message, { cause: err });
    }

    if (/insufficient liquidity|not enough liquidity|pool drained/i.test(message)) {
      return new InsufficientLiquidityError(message, { cause: err });
    }
    if (/slippage|amount[ _-]?out[ _-]?min|min[ _-]?received|price impact/i.test(message)) {
      return new SlippageError(message, { cause: err });
    }
    if (/deadline|timed out|time limit|exceeded after \d+ms/i.test(message)) {
      return new DeadlineError(message, { cause: err });
    }
    if (/connection|ECONNREFUSED|ECONNRESET|fetch failed|ENOTFOUND/i.test(message)) {
      return new NetworkError(message, { cause: err });
    }
    if (/invalid|must be|validation/i.test(message) && !/contract|feedback/i.test(message)) {
      return new ValidationError(message, { cause: err });
    }
  }

  const fallback = err instanceof Error ? err : new Error(String(err));
  return new CoralSwapSDKError(ErrorCode.UNKNOWN, fallback.message, { cause: fallback });
}