import { describe, it, expect } from "vitest";
import { isValidAddress, isValidContractAddress, sortTokens } from "../../src/utils/address";
import { ValidationError } from "../../src/errors";
import { testAccountId, testContractId } from "./helpers";

describe("isValidAddress", () => {
  it("accepts account and contract addresses", () => {
    expect(isValidAddress(testAccountId())).toBe(true);
    expect(isValidAddress(testContractId(1))).toBe(true);
  });

  it("rejects junk", () => {
    expect(isValidAddress("")).toBe(false);
    expect(isValidAddress("not-an-address")).toBe(false);
    expect(isValidAddress("S1234567890")).toBe(false);
  });
});

describe("isValidContractAddress", () => {
  it("accepts only C... addresses", () => {
    expect(isValidContractAddress(testContractId(2))).toBe(true);
    expect(isValidContractAddress(testAccountId())).toBe(false);
    expect(isValidContractAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB")).toBe(false);
  });
});

describe("sortTokens", () => {
  it("returns the canonical token0/token1 ordering", () => {
    const a = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const b = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
    const [token0, token1] = sortTokens(a, b);
    expect(token0 < token1).toBe(true);
    expect([token0, token1]).toEqual([b, a]);
  });

  it("throws on identical or invalid identifiers", () => {
    const a = testContractId(3);
    expect(() => sortTokens(a, a)).toThrow(ValidationError);
    expect(() => sortTokens(a, "junk")).toThrow(ValidationError);
  });
});