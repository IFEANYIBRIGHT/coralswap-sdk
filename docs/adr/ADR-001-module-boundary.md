# ADR-001: Module Boundary Decisions

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

CoralSwap SDK must expose swap, liquidity, flash loans, fees, oracle, and factory
features. Early prototypes put all calls on one object (`CoralSwap`), which made
tree-shaking impossible, blurred read vs. write paths, and bound every user to a
single API shape.

Issue #719 also requires every debug line to pass through a redaction boundary;
per-module logging makes the boundary simple to enforce per feature.

## Decision

Split the SDK into a thin `CoralSwapClient` (transport, cache, RPC retry,
redacted logger) plus feature modules constructed from it:

- `SwapModule` — quotes + executes swaps (single- and multi-hop).
- `LiquidityModule` — add/remove liquidity quotes + transactions.
- `FlashLoanModule` — estimate + execute flash loans.
- `FeeModule` — per-pair dynamic fees and cross-pair comparison.
- `OracleModule` — record observations, read TWAPs.
- `FactoryModule` — pair enumeration, pair lookup, token metadata.

Module boundaries follow the **read/quote vs. write/submit** rule:

- `getX`/`quoteX` methods are read-only simulations (with an optional `publicKey`
  only, no signer needed).
- `execute`/`addLiquidity`/`removeLiquidity`/`observe` methods build, sign, and
  submit transactions; they require `secretKey` (or external signing) and enforce
  slippage/deadline bounds before submission.

## Consequences

- Callers import only the module they need (`import { SwapModule } from "@coralswap/sdk"`).
- Quote functions are side-effect free and mockable in tests.
- Write paths share one submit pipeline (`ContractRunner`), so redaction, retry,
  deadline, and fee handling are centralized.
- Trade-off: callers of multiple features construct several modules sharing one
  client — an intentional, cheap trade for clearer responsibilities.

No changes planned; revisit only if a new write surface (e.g. governance or admin)
outgrows the client/module split.