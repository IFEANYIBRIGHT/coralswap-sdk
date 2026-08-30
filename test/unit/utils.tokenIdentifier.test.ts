import { describe, it, expect } from "vitest";
import {
  isNativeToken,
  getNativeAssetContractAddress,
  resolveTokenIdentifier,
  DEFAULT_NATIVE_SAC_ADDRESSES,
} from "../../src/utils/tokenIdentifier";
import { ConfigError, ValidationError } from "../../src/errors";
import { testContractId } from "./helpers";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

describe("isNativeToken", () => {
  it("recognizes XLM and native case-insensitively", () => {
    expect(isNativeToken("XLM")).toBe(true);
    expect(isNativeToken("xlm")).toBe(true);
    expect(isNativeToken("native")).toBe(true);
    expect(isNativeToken("NATIVE")).toBe(true);
    expect(isNativeToken("USDC")).toBe(false);
  });
});

describe("resolveTokenIdentifier", () => {
  it("resolves native symbols to the registered SAC address", () => {
    expect(resolveTokenIdentifier("XLM", TESTNET_PASSPHRASE)).toBe(DEFAULT_NATIVE_SAC_ADDRESSES[TESTNET_PASSPHRASE]);
    expect(resolveTokenIdentifier("native", MAINNET_PASSPHRASE)).toBe(
      DEFAULT_NATIVE_SAC_ADDRESSES[MAINNET_PASSPHRASE],
    );
  });

  it("passes valid contract addresses through", () => {
    const id = testContractId(4);
    expect(resolveTokenIdentifier(id, TESTNET_PASSPHRASE)).toBe(id);
  });

  it("throws on unknown passphrases and invalid identifiers", () => {
    expect(() => resolveTokenIdentifier("XLM", "An Unknown Network ; 1970")).toThrow(ConfigError);
    expect(() => resolveTokenIdentifier("bogus", TESTNET_PASSPHRASE)).toThrow(ValidationError);
  });

  it("honors a custom sacAddresses map", () => {
    const custom = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
    expect(resolveTokenIdentifier("XLM", TESTNET_PASSPHRASE, { [TESTNET_PASSPHRASE]: custom })).toBe(custom);
  });
});

describe("getNativeAssetContractAddress", () => {
  it("throws when no address is registered", () => {
    expect(() => getNativeAssetContractAddress("Unknown ; 1970")).toThrow(ConfigError);
  });
});