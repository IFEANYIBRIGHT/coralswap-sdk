import { CoralSwapSDKError } from "./CoralSwapSDKError";
import { ErrorCode } from "./codes";

export { CoralSwapSDKError };

export class ConfigError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.CONFIG, message, options);
  }
}

export class ValidationError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.VALIDATION, message, options);
  }
}

export class RpcError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.RPC, message, options);
  }
}

export class NetworkError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.NETWORK, message, options);
  }
}

/** Thrown when a deadline (tx expiry or `deadlineMs` RPC bound) is exceeded. */
export class DeadlineError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.DEADLINE, message, options);
  }
}

/** Thrown when a quote moves beyond the users configured slippage tolerance. */
export class SlippageError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.SLIPPAGE, message, options);
  }
}

export class InsufficientLiquidityError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.INSUFFICIENT_LIQUIDITY, message, options);
  }
}

export class NotFoundError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.NOT_FOUND, message, options);
  }
}

export class UnauthorizedError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.UNAUTHORIZED, message, options);
  }
}

export class TransactionFailedError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.TRANSACTION, message, options);
  }
}

/** Thrown when the logger refuses to emit output that redaction could not make safe. */
export class RedactionBlockedError extends CoralSwapSDKError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(ErrorCode.REDACTION, message, options);
  }
}