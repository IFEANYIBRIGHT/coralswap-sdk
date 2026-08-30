import { REDACTED_MARKER } from "../constants";
import { ValidationError } from "../errors";

/**
 * Key names treated as sensitive by default. Matches both plain keys and the
 * quoted JSON form (`"secretKey"`) so that stringified context is covered too.
 *
 * `networkPassphrase` is deliberately excluded: it is public network metadata
 * that shows up legitimately in client config logging.
 */
export const DEFAULT_SENSITIVE_KEY_PATTERN =
  /("?(?:secret[_-]?key|secret|seed|mnemonic|private[_-]?key|signing[_-]?key|signer|signature[s]?|preimage|password|passphrase[_-]?seed|auth[_-]?token|keypair)"?\s*[:=]\s*")/i;

/** Object key names whose values must always be redacted. */
export const DEFAULT_SENSITIVE_KEYS =
  /^(?:secret[_-]?key|secret|seed|mnemonic|private[_-]?key|signing[_-]?key|signer|signature|signatures|preimage|passphrase[_-]?seed|auth[_-]?token|keypair|envelopeXdr|signedXdr|signedPayload|preSignedPayload|txXdr)$/i;

/**
 * A Stellar secret key (StrKey seeded Ed25519) is 56 characters: the prefix
 * `S` followed by 55 base32 characters (`A-Z` and `2-7`). Also matched without
 * anchors so an inline secret inside a longer string is caught.
 */
export const STELLAR_SECRET_PATTERN = /S[A-Z2-7]{55}/g;

/**
 * Matches a value that "looks like" a signed Soroban transaction XDR envelope.
 *
 * Signed XDR envelopes start with the 4-byte little-endian `0x00000000` for the
 * `StellarTransaction` type, which base64-encodes to `AAAA`. We require a
 * generous minimum length so short, innocuous base64 strings are untouched.
 */
export const SIGNED_XDR_PAYLOAD_PATTERN = /^AAAA[A-Za-z0-9+/_-]{96,}={0,2}$/;

export const DEFAULT_MIN_SIGNED_PAYLOAD_LENGTH = 64;

/**
 * Unanchored, global variant used inside larger log lines so an envelope that
 * appears mid-string (e.g. inside `key="AAAA..."`) is still redacted. Min
 * length keeps short, innocuous base64 untouched.
 */
const INLINE_SIGNED_XDR_PATTERN = /AAAA[A-Za-z0-9+/_-]{96,}={0,2}/g;

/** Look like an already-redacted value (keeps repeated redaction idempotent). */
export function isRedactedMarker(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(REDACTED_MARKER);
}

export type RedactionKind = "secret" | "payload" | null;

export function classifyRedaction(
  value: unknown,
  minLength: number,
  redactPayloads: boolean,
): RedactionKind {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  if (/S[A-Z2-7]{55}/.test(value)) {
    return "secret";
  }
  if (redactPayloads && value.length >= minLength && /^AAAA[A-Za-z0-9+/_-]{96,}={0,2}$/.test(value)) {
    return "payload";
  }
  return null;
}

export interface RedactOptions {
  /**
   * Set `true` to disable ALL redaction. Mainly intended for local-only
   * debugging of obscured values; do not use in production or on shared logs.
   */
  disabled?: boolean;
  /** Set `false` to keep payload/value redaction but skip whitelisting controversies. */
  redactSecrets?: boolean;
  /** Whether values matching the signed-XDR shape are redacted. Default `true`. */
  redactSignedPayloads?: boolean;
  /** Minimum length for a value to be treated as a payload. Default `64`. */
  minSignedPayloadLength?: number;
  /** Sensitive key pattern applied to object keys. */
  sensitiveKeyPattern?: RegExp;
  /** Exact-key pattern for values that are always redacted. */
  sensitiveKeys?: RegExp;
  /** When `true`, throw a `ValidationError` if a secret is detected but could not be redacted (fail-closed). Default `false`. */
  failClosed?: boolean;
}

export interface RedactResult {
  value: unknown;
  redacted: boolean;
  matched: RedactionKind | null;
}

const DEFAULT_OPTIONS: Required<Pick<RedactOptions, "redactSecrets" | "redactSignedPayloads" | "minSignedPayloadLength">> =
  {
    redactSecrets: true,
    redactSignedPayloads: true,
    minSignedPayloadLength: DEFAULT_MIN_SIGNED_PAYLOAD_LENGTH,
  };

function redactScalarString(value: string, options: Required<RedactOptions>): RedactResult {
  let out = value;
  let matched: RedactionKind = null;
  let redacted = false;

  if (options.redactSecrets) {
    const seedResult = out.replace(STELLAR_SECRET_PATTERN, (m) =>
      isRedactedMarker(m) ? m : `${REDACTED_MARKER}-seed:56`,
    );
    if (seedResult !== out) {
      redacted = true;
      matched = matched ?? "secret";
      out = seedResult;
    }
  }

  if (options.redactSignedPayloads && out.length >= options.minSignedPayloadLength) {
    const payloadResult = out.replace(INLINE_SIGNED_XDR_PATTERN, (m) =>
      isRedactedMarker(m) ? m : `${REDACTED_MARKER}-xdr:${m.length}`,
    );
    if (payloadResult !== out) {
      redacted = true;
      matched = matched ?? "payload";
      out = payloadResult;
    }
  }

  const keyResult = out.replace(DEFAULT_SENSITIVE_KEY_PATTERN, (_m, prefix: string) => {
    return `${prefix}${REDACTED_MARKER}"`;
  });
  if (keyResult !== out) {
    redacted = true;
    matched = matched ?? "secret";
    out = keyResult;
  }

  if (options.failClosed && redacted) {
    throw new ValidationError(
      `Refusing to emit log output containing sensitive material (${matched}). ` +
        `Redaction is available and should be kept enabled.`,
    );
  }

  return { value: out, redacted, matched };
}

const SENSITIVE_OBJECT_KEYS = new WeakSet<object>();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function redactObject(value: Record<string, unknown>, options: Required<RedactOptions>): RedactResult {
  if (SENSITIVE_OBJECT_KEYS.has(value)) {
    return { value: REDACTED_MARKER, redacted: true, matched: "secret" };
  }

  let redacted = false;
  let matched: RedactionKind = null;
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(value)) {
    if (options.sensitiveKeys.test(key)) {
      out[key] = `${REDACTED_MARKER}-key:${key}`;
      redacted = true;
      matched = matched ?? "secret";
      continue;
    }
    const result = redactUnknown(val, options);
    out[key] = result.value;
    redacted = redacted || result.redacted;
    matched = matched ?? result.matched;
  }

  return { value: out, redacted, matched };
}

function redactArray(value: unknown[], options: Required<RedactOptions>): RedactResult {
  let redacted = false;
  let matched: RedactionKind = null;
  const out = value.map((item) => {
    const result = redactUnknown(item, options);
    redacted = redacted || result.redacted;
    matched = matched ?? result.matched;
    return result.value;
  });
  return { value: out, redacted, matched };
}

function redactUnknown(input: unknown, options: Required<RedactOptions>): RedactResult {
  if (input === null || input === undefined) {
    return { value: input, redacted: false, matched: null };
  }
  if (typeof input === "string") {
    return redactScalarString(input, options);
  }
  if (Array.isArray(input)) {
    return redactArray(input, options);
  }
  if (isPlainRecord(input)) {
    return redactObject(input, options);
  }
  if (input instanceof Error) {
    const clone = new (input.constructor as new (message?: string) => Error)(input.message);
    clone.name = input.name;
    (clone as { stack?: string }).stack = input.stack;
    const result = redactUnknown(clone.message, options);
    clone.message = result.value as string;
    return { value: clone, redacted: result.redacted, matched: result.matched };
  }
  return { value: input, redacted: false, matched: null };
}

function normalizeOptions(options?: RedactOptions): Required<RedactOptions> | null {
  if (options?.disabled === true) {
    return null;
  }
  const opts = options ?? {};
  const sensitiveKeys = opts.sensitiveKeys ?? DEFAULT_SENSITIVE_KEYS;
  return {
    disabled: false,
    redactSecrets: opts.redactSecrets ?? DEFAULT_OPTIONS.redactSecrets,
    redactSignedPayloads: opts.redactSignedPayloads ?? DEFAULT_OPTIONS.redactSignedPayloads,
    minSignedPayloadLength: opts.minSignedPayloadLength ?? DEFAULT_OPTIONS.minSignedPayloadLength,
    sensitiveKeyPattern: opts.sensitiveKeyPattern ?? DEFAULT_SENSITIVE_KEY_PATTERN,
    sensitiveKeys,
    failClosed: opts.failClosed ?? false,
  };
}

/**
 * Redact sensitive material from a value at the logging boundary.
 *
 * Redacts, by default:
 * - Stellar secret keys (`S...`) anywhere in strings,
 * - object fields whose key is a known secret/payload name (e.g. `secretKey`,
 *   `envelopeXdr`, `signedPayload`),
 * - base64 values that look like signed XDR transaction envelopes.
 *
 * The public `networkPassphrase` config field is never redacted.
 *
 * @param input value to redact (string, object, array, or scalar)
 * @param options redaction tuning; pass `{ disabled: true }` to opt out
 * @returns a deep-cloned, redacted copy of the value
 */
export function redact(input: unknown, options?: RedactOptions): unknown {
  const normalized = normalizeOptions(options);
  if (normalized === null) {
    return input;
  }
  return redactUnknown(input, normalized).value;
}

/** Redact a string of log text (message lines). */
export function redactText(input: string, options?: RedactOptions): string {
  const result = redact(input, options);
  return typeof result === "string" ? result : String(result);
}

/** Whether applying redaction to this value changed anything. */
export function didRedact(input: unknown, options?: RedactOptions): boolean {
  const normalized = normalizeOptions(options);
  if (normalized === null) {
    return false;
  }
  return redactUnknown(input, normalized).redacted;
}