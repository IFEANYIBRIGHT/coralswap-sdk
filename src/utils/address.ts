import * as StellarSdk from "@stellar/stellar-sdk";
import { ValidationError } from "../errors";

const StrKey = StellarSdk.StrKey;

/**
 * Whether `address` is a well-formed Stellar account (`G...`) or contract
 * (`C...`) address with a valid checksum.
 */
export function isValidAddress(address: string): boolean {
  if (typeof address !== "string" || address.length === 0) {
    return false;
  }
  try {
    return StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address);
  } catch {
    return false;
  }
}

/** True for `C...` contract addresses. */
export function isValidContractAddress(address: string): boolean {
  if (typeof address !== "string" || address.length === 0) {
    return false;
  }
  try {
    return StrKey.isValidContract(address);
  } catch {
    return false;
  }
}

/**
 * Canonical V2 token ordering: sorts two token identifiers by contract address,
 * lower first. Returns a tuple `[token0, token1]`.
 *
 * Throws a `ValidationError` when both identifiers are equal, since a
 * single-asset "pair" is meaningless.
 */
export function sortTokens(tokenA: string, tokenB: string): [string, string] {
  if (tokenA === tokenB) {
    throw new ValidationError(`cannot sort identical token identifiers: ${tokenA}`);
  }
  if (!isValidAddress(tokenA) || !isValidAddress(tokenB)) {
    throw new ValidationError(`cannot sort invalid token identifiers: "${tokenA}", "${tokenB}"`);
  }
  return tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
}