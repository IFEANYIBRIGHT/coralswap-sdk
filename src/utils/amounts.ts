import { ValidationError } from "../errors";

/**
 * Convert a human decimal value (string, number, or already-scaled bigint) to a
 * Soroban i128 amount represented as a bigint of `decimals` places.
 *
 * Values with more fractional places than `decimals` are rejected rather than
 * silently truncated, so an accidental precision loss cannot land on-chain.
 *
 * @example
 * toSorobanAmount("1.5", 7);  // 15000000n
 * toSorobanAmount("0.1", 7);  // 1000000n
 */
export function toSorobanAmount(value: string | number | bigint, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new ValidationError(`decimals must be a non-negative integer, got ${decimals}`);
  }

  if (typeof value === "bigint") {
    return value;
  }

  const text = typeof value === "number" ? String(value) : value;
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new ValidationError(`cannot convert "${text}" to a Soroban amount`);
  }

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [integerPart, fractionPart = ""] = unsigned.split(".") as [string, string];

  if (fractionPart.length > decimals) {
    throw new ValidationError(
      `value "${text}" has more than ${decimals} decimal places; ` +
        `refusing to silently truncate. Use a value with at most ${decimals} decimals.`,
    );
  }

  const scaled = BigInt(integerPart) * 10n ** BigInt(decimals) + BigInt(fractionPart.padEnd(decimals, "0") || "0");
  return negative ? -scaled : scaled;
}

/**
 * Format a Soroban i128 bigint amount as a fixed-decimal string.
 *
 * @example
 * fromSorobanAmount(15000000n, 7); // "1.5000000"
 */
export function fromSorobanAmount(amount: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new ValidationError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const divisor = 10n ** BigInt(decimals);
  const integerPart = abs / divisor;
  const fractionPart = (abs % divisor).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${integerPart}.${fractionPart}`;
}

/**
 * Format an amount to a compact display string, truncating (not rounding) the
 * fractional part to at most `maxDigits` decimal places. Trailing zeros are
 * kept so prices are shown to a stable precision.
 *
 * @example
 * formatAmount(15000000n, 7, 2); // "1.50"
 * formatAmount(1234567n, 7, 2);  // "0.12"
 * formatAmount(10000000n, 7);    // "1"
 */
export function formatAmount(amount: bigint, decimals: number, maxDigits?: number): string {
  const full = fromSorobanAmount(amount, decimals);
  if (maxDigits === undefined) {
    return trimTrailingZeros(full);
  }
  if (!Number.isInteger(maxDigits) || maxDigits < 0) {
    throw new ValidationError(`maxDigits must be a non-negative integer, got ${maxDigits}`);
  }
  const separatorIndex = full.indexOf(".");
  const integerPart = separatorIndex === -1 ? full : full.slice(0, separatorIndex);
  const fractionPart = separatorIndex === -1 ? "" : full.slice(separatorIndex + 1);
  const truncated = fractionPart.slice(0, maxDigits);
  return truncated.length > 0 ? `${integerPart}.${truncated}` : integerPart;
}

function trimTrailingZeros(full: string): string {
  return full.includes(".") ? full.replace(/0+$/, "").replace(/\.$/, "") : full;
}