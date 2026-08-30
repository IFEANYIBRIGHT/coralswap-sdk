# ADR-002: Error Handling Strategy

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

Callers need to distinguish recoverable failures (slippage, deadline, temporary
RPC failure) from permanent ones, and to switch on failures without parsing
message strings. The SDK also throws non-SDK errors from the underlying
`@stellar/stellar-sdk` RPC layer.

## Decision

Every SDK error extends `CoralSwapSDKError` and carries a stable machine-readable
`code`:

| Code | Thrown by |
|---|---|
| `CONFIG_ERROR` | missing/invalid client or contract config |
| `VALIDATION_ERROR` | bad user input, malformed amounts/addresses |
| `RPC_ERROR` | Soroban RPC request/response failures |
| `NETWORK_ERROR` | connection-level failures (ECONNREFUSED, fetch failed) |
| `DEADLINE_EXCEEDED` | expired tx deadline or `deadlineMs` retry budget |
| `SLIPPAGE_EXCEEDED` | quote moved beyond the user's slippage tolerance |
| `INSUFFICIENT_LIQUIDITY` | pool lacks the reserves for the requested size |
| `NOT_FOUND` | missing pair, missing factory pair, unknown contract |
| `UNAUTHORIZED` | auth/signature rejection by a contract |
| `TRANSACTION_FAILED` | a submitted transaction failed on-chain |
| `REDACTION_BLOCKED` | logger refused (fail-closed) to emit an unsafe line |

Errors expose `cause` (the original error) and an optional non-sensitive
`details` record — **never** secret keys or signed XDR.

`mapError(err)` normalizes any thrown value:

1. Passes `CoralSwapSDKError` instances through unchanged.
2. Re-maps by a known code string (message marker or a `code` property).
3. Classifies heuristically from SDK-style messages.
4. Falls back to `UNKNOWN`, preserving `cause`.

Callers switch on `err.code` (string literals, not message parsing).

## Consequences

- All SDK surfaces throw `CoralSwapSDKError`; foreign errors are wrapped at
  module boundaries via `mapError`.
- Deadlines and slippage are enforced *before* submission (fail fast) and
  re-verified during execution re-quotes.
- Redaction stays verifiable: error `details` must not carry `S...` secrets or
  `AAAA...` payloads; the logger boundary redacts if they slip through anyway.

See `docs/LOGGING.md` for the redaction boundary complementing this policy.