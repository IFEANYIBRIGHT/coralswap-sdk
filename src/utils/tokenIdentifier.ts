import { ConfigError, ValidationError } from "../errors";
import { isValidContractAddress } from "./address";

export const NATIVE_ASSET_SYMBOLS = ["XLM", "native"] as const;
export type NativeAssetSymbol = (typeof NATIVE_ASSET_SYMBOLS)[number];

/**
 * Stellar Asset Contract (SAC) addresses for the native XLM asset, keyed by
 * network passphrase.
 *
 * Derived from the `native` asset (no issuer) via the standard asset-to-SAC
 * mapping:
 * - Testnet: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
 * - Mainnet: `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA`
 *
 * If CoralSwap has deployed its own SAC wrapper on a network, override the map
 * with `resolveTokenIdentifier("XLM", passphrase, sacAddresses)`.
 */
export const DEFAULT_NATIVE_SAC_ADDRESSES: Record<string, string> = {
  "Test SDF Network ; September 2015": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "Public Global Stellar Network ; September 2015":
    "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
};

/** True when `tokenId` means "native XLM" (`"XLM"` or `"native"`, case-insensitive). */
export function isNativeToken(tokenId: string): boolean {
  return NATIVE_ASSET_SYMBOLS.some((symbol) => symbol === tokenId || symbol.toUpperCase() === tokenId.toUpperCase());
}

/**
 * Resolve the SAC contract address for the native asset on `networkPassphrase`.
 */
export function getNativeAssetContractAddress(
  networkPassphrase: string,
  sacAddresses: Record<string, string> = DEFAULT_NATIVE_SAC_ADDRESSES,
): string {
  const address = sacAddresses[networkPassphrase];
  if (!address) {
    throw new ConfigError(
      `no native SAC address registered for passphrase "${networkPassphrase}". ` +
        `Supply one via the \`sacAddresses\` map or CoralSwapClient \`networkConfig\`.`,
    );
  }
  return address;
}

/**
 * Resolve any token identifier to a concrete contract address:
 *
 * - `"XLM"` / `"native"`  → the network's SAC contract address
 * - a `C...` address      → validated and returned unchanged
 *
 * @example
 * resolveTokenIdentifier("XLM", passphrase); // CDLZFC3...
 */
export function resolveTokenIdentifier(
  tokenId: string,
  networkPassphrase: string,
  sacAddresses?: Record<string, string>,
): string {
  if (isNativeToken(tokenId)) {
    return getNativeAssetContractAddress(networkPassphrase, sacAddresses);
  }
  if (!isValidContractAddress(tokenId)) {
    throw new ValidationError(
      `"${tokenId}" is neither a native asset symbol nor a valid contract address`,
    );
  }
  return tokenId;
}