import { describe, it, expect } from "vitest";
import {
  CoralSwapSDKError,
  ConfigError,
  ValidationError,
  DeadlineError,
  SlippageError,
  InsufficientLiquidityError,
  NotFoundError,
  UnauthorizedError,
  RpcError,
  NetworkError,
  TransactionFailedError,
  RedactionBlockedError,
} from "../../src/errors";
import { mapError } from "../../src/errors/mapError";
import { ErrorCode } from "../../src/errors/codes";

describe("SDK errors", () => {
  it("carries a stable machine-readable code", () => {
    const error = new DeadlineError("tx expired", { details: { now: 123, deadline: 100 } });
    expect(error.code).toBe(ErrorCode.DEADLINE);
    expect(error instanceof CoralSwapSDKError).toBe(true);
    expect(error.details).toEqual({ now: 123, deadline: 100 });
  });

  it("every exported subclass maps to its code", () => {
    const cases: Array<[CoralSwapSDKError, ErrorCode]> = [
      [new ConfigError("m"), ErrorCode.CONFIG],
      [new ValidationError("m"), ErrorCode.VALIDATION],
      [new RpcError("m"), ErrorCode.RPC],
      [new NetworkError("m"), ErrorCode.NETWORK],
      [new DeadlineError("m"), ErrorCode.DEADLINE],
      [new SlippageError("m"), ErrorCode.SLIPPAGE],
      [new InsufficientLiquidityError("m"), ErrorCode.INSUFFICIENT_LIQUIDITY],
      [new NotFoundError("m"), ErrorCode.NOT_FOUND],
      [new UnauthorizedError("m"), ErrorCode.UNAUTHORIZED],
      [new TransactionFailedError("m"), ErrorCode.TRANSACTION],
      [new RedactionBlockedError("m"), ErrorCode.REDACTION],
    ];
    for (const [error, code] of cases) {
      expect(error.code).toBe(code);
      expect(error.name).toBe(error.constructor.name);
      expect(error).toBeInstanceOf(error.constructor);
    }
  });
});

describe("mapError", () => {
  it("passes SDK errors through unchanged", () => {
    const error = new SlippageError("moved");
    expect(mapError(error)).toBe(error);
  });

  it("remaps by a known code string in the message", () => {
    expect(mapError(new Error("swap failed: SLIPPAGE_EXCEEDED over 0.5%"))).toBeInstanceOf(SlippageError);
    expect(mapError(new Error("deadline hit: DEADLINE_EXCEEDED"))).toBeInstanceOf(DeadlineError);
  });

  it("maps via a `code` property", () => {
    const original = Object.assign(new Error("low reserves"), { code: "INSUFFICIENT_LIQUIDITY" });
    expect(mapError(original)).toBeInstanceOf(InsufficientLiquidityError);
  });

  it("classifies by message heuristic", () => {
    expect(mapError(new Error("insufficient liquidity in the pair"))).toBeInstanceOf(InsufficientLiquidityError);
    expect(mapError(new Error("min received unfulfilled: price impact"))).toBeInstanceOf(SlippageError);
    expect(mapError(new Error("connection refused: ECONNRESET"))).toBeInstanceOf(NetworkError);
    expect(mapError(new Error("amount must be positive"))).toBeInstanceOf(ValidationError);
  });

  it("falls back to an UNKNOWN error and preserves the cause", () => {
    const original = new Error("something weird happened");
    const mapped = mapError(original);
    expect(mapped).toBeInstanceOf(CoralSwapSDKError);
    expect(mapped.code).toBe(ErrorCode.UNKNOWN);
    expect((mapped as CoralSwapSDKError).cause).toBe(original);
  });
});