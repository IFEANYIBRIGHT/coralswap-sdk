# 🔒 Logging, Sinks, and Redaction

**Issue #719 — Logger redaction policy: never print secret keys or full signed payloads in debug logs.**

Debug logging (retry/polling/simulation) can surface full transaction XDRs and — if
callers log client options carelessly — secret keys. This document defines the
SDK's redaction policy, the opt-out, and guidance for custom sinks.

## Policy

**Default:** every log entry emitted by the SDK passes through a redaction helper
at the logger boundary, *before* any sink sees it. A redacted entry never contains:

| Material | Redacted as |
|---|---|
| Stellar secret keys (`S[A-Z2-7]{55}`) | `[REDACTED]-seed:56` |
| Signed transaction payloads (`AAAA...` ≥ 64 chars) | `[REDACTED]-xdr:<len>` |
| Sensitive object keys (`secretKey`, `envelopeXdr`, `signedPayload`, `signer`, `mnemonic`, `preimage`, …) | `[REDACTED]-key:<name>` |

The public `networkPassphrase` config field is **never** redacted — it is network
metadata, not a secret, and appears legitimately in client config logging.

Redaction is idempotent: already-redacted markers are left untouched, so piping
log output through the SDK twice is safe.

```ts
import { redact, redactText, didRedact, classifyRedaction } from "@coralswap/sdk";

const safe = redact({ secretKey: "S...", envelopeXdr: xdr });     // deep-cloned
const line = redactText(`hash=0xabc envelopeXdr="${xdr}"`);       // inline payloads too
const changed = didRedact(context);                               // true if modified
```

## Logger boundary

`Logger.emit` (used by `debug`/`info`/`warn`/`error`) runs every message and
context through `redact` before invoking the sink. Both the base context registered
on the client and per-call contexts are covered.

```ts
import { Logger, LogLevel } from "@coralswap/sdk";

const logger = new Logger({
  level: LogLevel.DEBUG,
});

// Routing/retry debug lines that include tx result shapes are safe by default:
logger.debug("polling tx", { hash: "0xabc", envelopeXdr: signedXdr });
// sink receives: envelopeXdr -> "[REDACTED]-xdr:328", hash stays "0xabc"
```

### Custom sinks

Custom sinks (console, JSON transport, Sentry, …) only ever receive **already
redacted** entries, so a misconfigured sink cannot leak a secret either.

```ts
const logger = new Logger({
  level: "debug",
  sink: (entry) => {
    transport.send({
      message: entry.message,
      context: entry.context,        // already redacted
      redacted: entry.redacted,      // boolean marker when something was masked
    });
  },
});
```

Child loggers merge context and inherit options:

```ts
const moduleLogger = client.logger.child({ module: "SwapModule" });
moduleLogger.debug("quote computed", { amountOut }); // includes module: "SwapModule"
```

## Opt-out

Redaction is on by default. Actions that disable it are **explicit** and aimed only
at local debugging:

```ts
const logger = new Logger({ level: "debug", redact: false });        // whole logger off
const logger = new Logger({ level: "debug", redact: { disabled: true } });

redactText(raw, { disabled: true });                                  // single call off
client.logger.options.redact = { redactSecrets: false };              // keep payload redaction
```

> Do not use the opt-out in production or on shared logs: it defeats the
> acceptance criteria of issue #719 ("no secret leakage in default debug output").

## `failClosed` mode

For high-security deployments you can make redaction **fail closed** — the logger
throws `ValidationError` (`code: "REDACTION_BLOCKED"`) rather than emit a line
that redaction could not make safe:

```ts
const logger = new Logger({ level: "debug", failClosed: true });
```

## Tuning

`RedactOptions` lets you tune patterns without disabling redaction:

```ts
const logger = new Logger({
  level: "debug",
  redact: {
    redactSecrets: true,
    redactSignedPayloads: true,
    minSignedPayloadLength: 128,      // only mask payloads ≥ 128 chars
    sensitiveKeyPattern: /(apiKey|access[_-]?key)\s*:\s*"/i,
  },
});
```

## Checklist for libraries consuming the SDK's logger

- [ ] Never put `secretKey`, `signedXdr`, or `envelopeXdr` in *your* `console.log`.
      Pass them as logger context instead — the boundary redacts them.
- [ ] Treat any value matching `S[A-Z2-7]{55}` as a secret: do not echo it in
      errors, CI output, or support tickets.
- [ ] If you build a transport, honor `entry.redacted` for alerting/audit.
- [ ] For high-security deployments, send `failClosed: true`.