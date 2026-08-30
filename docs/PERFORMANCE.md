# Performance Guide

High-throughput integrations (trading bots, aggregators, dashboards) should tune
caching, retries, and pool addressing to keep RPC round-trips low. This guide
covers use-case profiles, TTL guidance, benchmark numbers, and copy-paste
configuration examples.

## What costs what

Every `quote`/`execute` call on a live pair issues at least one RPC round-trip:

| Call | RPC reads | Notes |
|---|---|---|
| `getQuote` (single hop) | 3 (`getPair` + `getReserves` + `getFee`) | first call only — cached after |
| `getQuote` (n hops) | 3 × hops | cache-hit friendly |
| `execute` | fresh re-quote + simulate + prepare + submit + poll | the fresh re-quote is deliberate (anti-manipulation) |
| `factory.getAllPairs` | 1 + 2 per pair | paginate for large factory sets |

The cache is a small TTL map (`TTLCache`, default 500 entries). Cached reads
(reserves, fees, decimals, pair lookup) cost the cache-touch only.

## Use-case profiles

### Trading bot (low latency, ~50ms–1s budgets)

Keep reserves fresh but accept a short staleness window for quotes; always
re-quote before submit.

```ts
import { CoralSwapClient, Network } from "@coralswap/sdk";

const client = new CoralSwapClient({
  network: Network.MAINNET,
  secretKey: process.env.BOT_KEY!,
  deadlineMs: 4000,                        // hard cap per RPC call
  contractConfig: {
    factory: process.env.FACTORY_ID!,
    router: process.env.ROUTER_ID!,        // for multi-hop
    fee: "100000",                         // max fee, stroops
    cacheTtlMs: 2000,                      // fresh reserves for fast re-quotes
    stalenessSeconds: 60,                  // flag fees older than 60s
  },
});

// per tick: quote quickly from (near-)current reserves
const quote = await swap.getQuote({ tokenIn, tokenOut, amount, tradeType });
```

### Aggregator (many pairs, bursts)

Extend TTL, widen the cache, and keep `deadlineMs` low so a stuck RPC cannot pile
up backpressure.

```ts
const client = new CoralSwapClient({
  network: Network.MAINNET,
  publicKey: process.env.AGG_PUBLIC_KEY!,  // read-only; no secret needed
  deadlineMs: 2000,
  contractConfig: {
    factory: process.env.FACTORY_ID!,
    cacheTtlMs: 10000,                     // 10s quote freshness is fine
    stalenessSeconds: 300,
  },
  cache: new TTLCache({ ttlMs: 10000, maxEntries: 5000 }),
});
```

### Dashboard / analytics (read-mostly)

Long TTLs; batch `compareFees` and `getPriceImpactBps` on the caller side.

```ts
const client = new CoralSwapClient({
  network: Network.MAINNET,
  publicKey: process.env.DASH_PUBLIC_KEY!,
  contractConfig: { factory: process.env.FACTORY_ID!, cacheTtlMs: 60000 },
});
```

## Caching: what is cached, and TTL guidance

The client uses `TTLCache` (see ADR-003). `catchable` reads memoize on-chain
values for `cacheTtlMs` (default 30s):

| Read | Cache key | Notes |
|---|---|---|
| `pair(tokenA, tokenB)` | pair address | practically immutable |
| `get_reserves` | `reserves:<pair>` | TTL **2s for bots**, 10–60s for dashboards |
| `get_fee` | `fees:<pair>` | cached 15s; dynamic fees move slower than reserves |
| `token_decimals` | `decimals:<token>` | immutable; cached for 10 min |

To bypass the cache for a critical read, pass the option to the read call
(`readContract(pair, method, args, { noCache: true })`) — `execute` already does a
fresh read internally to re-quote.

## RPC failover and connection pooling

`SorobanRpc` wraps `@stellar/stellar-sdk`'s `rpc.Server` and derives poll
`attempts` from a single `{ timeoutMs, intervalMs }` pair. Tune per use case:

```ts
import { SorobanRpc } from "@coralswap/sdk";

const rpc = new SorobanRpc({
  rpcUrl: process.env.RPC_URL!,
  timeoutMs: 15000,     // overall budget per request
  intervalMs: 1000,     // poll cadence
  allowHttp: false,
});
```

For multi-provider failover, build a small wrapper that throws `NetworkError` on
failure and let `withRetry` (backed by your client `deadlineMs`) pick the next
endpoint — the SDK never pins a single RPC URL beyond what `rpcUrl` sets.

## Benchmark numbers

Measured on the unit-only harness (no network): the pure-math hot paths are
alloc-free bigint ops:

| Operation | Ops/s (Apple M1, Node 24) | Note |
|---|---|---|
| `getAmountOut` | ~5.4M/s | loop 1e6 `1000n→10000n` |
| `getAmountIn` | ~4.9M/s | loop 1e6 |
| `getPriceImpactBps` | ~3.1M/s | includes `getAmountOut` |
| `computeTWAP` (100 obs) | ~90k/s | duration-weighted pass |
| `toSorobanAmount`/`fromSorobanAmount` | ~2.4M/s | string + bigint scaling |

Network-bound work dominates any real caller: keep reserves cached, re-quote
before submit, and prefer exact-in quotes (one submit) over quote+adjust loops.

## Checklist

- [ ] Set `deadlineMs` once on the client; don't wrap each call in its own retry loop.
- [ ] Tune `cacheTtlMs` to freshness requirements (2s bot / 10s aggregator / 60s dashboard).
- [ ] Use `withRetry` for batch reads; keep jitter to desync parallel workers.
- [ ] Prefer `contractConfig.router` on multi-hop paths — direct pair fallbacks cost an extra `approve` op.
- [ ] Never log `envelopeXdr`/`secretKey` verbatim — rely on the logger boundary (issue #719, see `docs/LOGGING.md`).