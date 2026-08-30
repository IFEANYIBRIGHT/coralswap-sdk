import * as StellarSdk from "@stellar/stellar-sdk";
import { ValidationError } from "../errors";

export type ScVal = StellarSdk.xdr.ScVal;

export type ArgType =
  | "i128"
  | "u128"
  | "i64"
  | "u64"
  | "i32"
  | "u32"
  | "bool"
  | "string"
  | "bytes"
  | "address"
  | "symbol"
  | "addressVec";

export interface ContractArg {
  type: ArgType;
  value: bigint | number | boolean | string | Buffer | Uint8Array | string[];
}

/** Convert a typed SDK argument into a Soroban `ScVal`. */
export function toScVal(arg: ContractArg): ScVal {
  const { type, value } = arg;
  switch (type) {
    case "address":
      if (typeof value !== "string") {
        throw new ValidationError("address arg requires a string");
      }
      return new StellarSdk.Address(value).toScVal();
    case "addressVec":
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
        throw new ValidationError("addressVec arg requires an array of address strings");
      }
      return StellarSdk.xdr.ScVal.scvVec(
        (value as string[]).map((item) => new StellarSdk.Address(item).toScVal()),
      );
    case "bytes":
      if (!(value instanceof Uint8Array) && !Buffer.isBuffer(value)) {
        throw new ValidationError("bytes arg requires a Uint8Array or Buffer");
      }
      return StellarSdk.nativeToScVal(value as Uint8Array, { type: "bytes" });
    default:
      return StellarSdk.nativeToScVal(value, { type });
  }
}

/** Convenience: build an i128 (bigint) contract argument. */
export function i128(value: bigint): ContractArg {
  return { type: "i128", value };
}

export function address(value: string): ContractArg {
  return { type: "address", value };
}

export function u32(value: number): ContractArg {
  return { type: "u32", value };
}

export function u64(value: bigint): ContractArg {
  return { type: "u64", value };
}

export function boolValue(value: boolean): ContractArg {
  return { type: "bool", value };
}

export function stringValue(value: string): ContractArg {
  return { type: "string", value };
}

export function bytesValue(value: Buffer | Uint8Array): ContractArg {
  return { type: "bytes", value };
}

/** Convert a raw Soroban `ScVal` into a native TypeScript value. */
export function fromScVal(raw: ScVal): unknown {
  const native = StellarSdk.scValToNative(raw);
  return normalizeScValNative(native);
}

/**
 * `scValToNative` produces object keys as symbols for structs/maps. Normalize
 * them to their string descriptions and coerce Buffer/Uint8Array into Buffer.
 */
export function normalizeScValNative(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeScValNative(item));
  }
  if (value !== null && typeof value === "object") {
    if (value instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [key, val] of value) {
        out[String(typeof key === "symbol" ? key.description ?? key : key)] = normalizeScValNative(val);
      }
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = normalizeScValNative(val);
    }
    return out;
  }
  return value;
}