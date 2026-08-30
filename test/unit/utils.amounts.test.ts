import { describe, it, expect } from "vitest";
import { toSorobanAmount, fromSorobanAmount, formatAmount } from "../../src/utils/amounts";
import { ValidationError } from "../../src/errors";

describe("toSorobanAmount", () => {
  it("scales decimal strings to the token decimals", () => {
    expect(toSorobanAmount("1.5", 7)).toBe(15000000n);
    expect(toSorobanAmount("0.1", 7)).toBe(1000000n);
    expect(toSorobanAmount("1", 7)).toBe(10000000n);
    expect(toSorobanAmount("0", 18)).toBe(0n);
  });

  it("handles negative values and numbers", () => {
    expect(toSorobanAmount("-0.25", 2)).toBe(-25n);
    expect(toSorobanAmount(2.5, 7)).toBe(25000000n);
    expect(toSorobanAmount("3.14", 6)).toBe(3140000n);
  });

  it("passes bigints through unchanged", () => {
    expect(toSorobanAmount(10n ** 40n, 7)).toBe(10n ** 40n);
  });

  it("rejects values with more fractional places than decimals", () => {
    expect(() => toSorobanAmount("1.12345678", 7)).toThrow(ValidationError);
    expect(() => toSorobanAmount("0.01", 1)).toThrow(/refusing to silently truncate/);
  });

  it("rejects malformed input", () => {
    expect(() => toSorobanAmount("abc", 7)).toThrow(ValidationError);
    expect(() => toSorobanAmount("", 7)).toThrow(ValidationError);
    expect(() => toSorobanAmount("1.2.3", 7)).toThrow(ValidationError);
    expect(() => toSorobanAmount("1", -1)).toThrow(ValidationError);
  });
});

describe("fromSorobanAmount", () => {
  it("formats scaled amounts to fixed-decimal strings", () => {
    expect(fromSorobanAmount(15000000n, 7)).toBe("1.5000000");
    expect(fromSorobanAmount(1n, 7)).toBe("0.0000001");
    expect(fromSorobanAmount(-25n, 2)).toBe("-0.25");
  });

  it("rejects negative decimals", () => {
    expect(() => fromSorobanAmount(1n, -1)).toThrow(ValidationError);
  });
});

describe("formatAmount", () => {
  it("truncates to at most maxDigits decimal places", () => {
    expect(formatAmount(15000000n, 7, 2)).toBe("1.50");
    expect(formatAmount(1234567n, 7, 2)).toBe("0.12");
    expect(formatAmount(10000000n, 7, 2)).toBe("1.00");
    expect(formatAmount(199n, 7, 4)).toBe("0.0000");
  });

  it("trims trailing zeros when maxDigits is omitted", () => {
    expect(formatAmount(10000000n, 7)).toBe("1");
    expect(formatAmount(15000000n, 7)).toBe("1.5");
  });

  it("rejects negative maxDigits", () => {
    expect(() => formatAmount(1n, 7, -1)).toThrow(ValidationError);
  });
});