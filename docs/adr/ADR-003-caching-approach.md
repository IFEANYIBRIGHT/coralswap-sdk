# ADR-003: Caching Approach

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

A Soroban read costs one or more RPC round-trips (~0.5–2s on public endpoints).
Quotes and UIs read the same on-chain values repeatedly (reserves, fees, pair
addresses, token decimals). Caching transparently improves latency but risks stale
quotes if TTLs are too long.

## Decision

Use a small, dependency-free TTL cache (`TTLCache`) with:

- lazy expiry on read + periodic eviction on write;
- oldest-entry eviction at capacity (default 500);
- O(1) amortized `get`/`set`;
- default TTL 60s, overridable per-entry and via `cacheTtlMs` on
  `ContractConfig`/client options.

The client wraps contract reads in `catchable` memoized calls. Callers that need
freshness pass read options to bypass the cache, and `execute()` always re-quotes
with a fresh (uncached) read — the anti-manipulation guarantee takes precedence
over cache hits.

| Data | Default TTL | Rationale |
|---|---|---|
| `reserves` | `cacheTtlMs` (30s) | quote freshness; bots lower to 2s |
| `pair(tokenA, tokenB)` | 30s | immutable in practice |
| `fee` | 15s | dynamic fees move slower than reserves |
| `token decimals` | 10 min | immutable |

Cached values must never be treated as truth for submission bounds: slippage
minimums are always computed against a fresh read.

## Consequences

- Reads are cache-friendly; repeated quoting is a cache touch, not an RPC call.
- Staleness risk is bounded by explicit TTLs and by the fresh-read re-quote on
  `execute`.
- No external cache dependency; `TTLCache` is exported for callers integrating
  with their own pools.

Revisit if CoralSwap introduces per-block variance that invalidates the 2–60s TTL
range; a ledger-versioned cache key (`ledgerSeq`) would be the follow-up.
See `docs/PERFORMANCE.md` for tuned TTL examples per use case.