import type { ErrorCode } from "./codes";

export interface CoralSwapSDKErrorOptions {
  code: ErrorCode;
  message: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

/**
 * Base class for every error thrown by the SDK.
 *
 * All SDK errors expose a stable machine-readable `code` so callers can switch
 * on it (see {@link mapError}). The optional `details` payload is intended for
 * non-sensitive structured context (no secret keys, no signed payloads).
 */
export class CoralSwapSDKError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = options?.details;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export { ErrorCode as SDKErrorCode };