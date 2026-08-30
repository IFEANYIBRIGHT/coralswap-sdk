import * as StellarSdk from "@stellar/stellar-sdk";
import { describe, it, expect } from "vitest";
import {
  redact,
  redactText,
  didRedact,
  classifyRedaction,
} from "../../src/logger/redact";
import { REDACTED_MARKER } from "../../src/constants";
import { Logger } from "../../src/logger/Logger";

/** Build a real, signed Soroban transaction envelope XDR (as retry/poll logs would see). */
function signedTransactionXdr(): string {
  const contractId = StellarSdk.StrKey.encodeContract(Buffer.alloc(32).fill(7));
  const keypair = StellarSdk.Keypair.random();
  const account = new StellarSdk.Account(keypair.publicKey(), "1234");
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: StellarSdk.Networks.TESTNET,
  });
  builder.addOperation(new StellarSdk.Contract(contractId).call("swap", StellarSdk.nativeToScVal(1n, { type: "i128" })));
  builder.setTimeout(StellarSdk.TimeoutInfinite);
  const tx = builder.build();
  tx.sign(keypair);
  return tx.toXDR();
}

const SECRET = StellarSdk.Keypair.random().secret();

describe("redact", () => {
  it("redacts Stellar secret keys anywhere in a string", () => {
    const output = redactText(`connect with ${SECRET} please`);
    expect(output).not.toContain(SECRET);
    expect(output).toContain(`${REDACTED_MARKER}-seed:56`);
  });

  it("redacts object fields by sensitive key name", () => {
    const output = redact({ secretKey: SECRET }) as Record<string, unknown>;
    expect(String(output.secretKey)).toContain(REDACTED_MARKER);
  });

  it("redacts signed transaction XDR payloads and never leaks them", () => {
    const xdr = signedTransactionXdr();
    expect(xdr.length).toBeGreaterThan(100);

    const context = {
      pair: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      envelopeXdr: xdr,
      signedPayload: xdr,
      nested: { envelopeXdr: xdr },
    };
    const output = redact(context) as Record<string, unknown>;

    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain(xdr);
    expect(serialized).toContain(REDACTED_MARKER);
    expect(JSON.stringify(output.nested)).toContain(REDACTED_MARKER);
  });

  it("redacts signed XDR appearing inline inside a JSON log line", () => {
    const xdr = signedTransactionXdr();
    const line = `submitted tx hash=0xabc envelopeXdr="${xdr}" status=PENDING`;
    const out = redactText(line);
    expect(out).not.toContain(xdr);
    expect(out).toContain(REDACTED_MARKER);
  });

  it("never redacts the public networkPassphrase field", () => {
    const output = redact({
      networkPassphrase: "Test SDF Network ; September 2015",
      account: "GBLL6WL4LP2EFFFQRDTOI6LAHVCE5XKTNOJFGJANJUW2YD3PUWH2ALTE",
    }) as Record<string, unknown>;
    expect(output.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });

  it("is idempotent on already-redacted strings", () => {
    const once = redactText(`key ${SECRET}`);
    const twice = redactText(once!);
    expect(twice).toBe(once);
  });

  it("opts out via { disabled: true } or redact:false", () => {
    expect(redact({ secretKey: SECRET }, { disabled: true })).toEqual({ secretKey: SECRET });
    expect(redactText(`x ${SECRET}`, { disabled: true })).toContain(SECRET);
  });

  it("didRedact reports whether output changed", () => {
    expect(didRedact({ secretKey: SECRET })).toBe(true);
    expect(didRedact({ amount: 100n, hash: "0xabc" })).toBe(false);
  });

  it("classifyRedaction distinguishes seeds from payloads", () => {
    expect(classifyRedaction(SECRET, 64, true)).toBe("secret");
    const xdr = signedTransactionXdr();
    expect(classifyRedaction(xdr, 64, true)).toBe("payload");
    expect(classifyRedaction("hello world", 64, true)).toBeNull();
  });
});

describe("Logger boundary (issue #719: never print secret keys or full signed payloads)", () => {
  it("asserts secrets never appear in default debug output", () => {
    const xdr = signedTransactionXdr();
    const emitted: Array<{ message: string; context?: unknown }> = [];
    const logger = new Logger({
      level: "debug",
      sink: (entry) => emitted.push({ message: entry.message, context: entry.context }),
    });

    logger.debug("retrying tx submission", {
      secretKey: SECRET,
      envelopeXdr: xdr,
      signedXdr: xdr,
      hash: "0xabcdef",
      attempts: 3,
    });

    expect(emitted).toHaveLength(1);
    const serialized = JSON.stringify(emitted[0]);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(xdr);
    // markers remain so operators know something was redacted
    expect(serialized).toContain(REDACTED_MARKER);
    // safe telemetry is preserved
    expect(serialized).toContain("0xabcdef");
    expect(serialized).toContain("retrying tx submission");
  });

  it("documents and honors the opt-out (redact:false)", () => {
    const xdr = signedTransactionXdr();
    const emitted: Array<{ message: string; context?: unknown }> = [];
    const logger = new Logger({
      level: "debug",
      redact: false,
      sink: (entry) => emitted.push({ message: entry.message, context: entry.context }),
    });
    logger.debug("raw debug line", { secretKey: SECRET, envelopeXdr: xdr });
    expect(JSON.stringify(emitted[0])).toContain(SECRET);
  });

  it("redaction applies before the sink, so custom sinks receive safe data", () => {
    const emitted: Array<string> = [];
    const logger = new Logger({
      level: "debug",
      sink: (entry) => emitted.push(JSON.stringify(entry)),
    });
    logger.debug("polling tx", { envelopeXdr: signedTransactionXdr() });
    expect(emitted[0]).not.toContain("AAAAAAA");
  });
});