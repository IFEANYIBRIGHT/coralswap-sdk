# Migration Guide — v0 → v1

CoralSwap SDK 0.x was an internal prototype. 1.x is the contract-first SDK shipped
in this repository. This guide covers the breaking changes, before/after examples,
and step-by-step migration instructions.

## Breaking changes at a glance

| Area | 0.x | 1.x |
|---|---|---|
| Client | `CoralSwap` + raw helper functions | `CoralSwapClient` with `network`, `rpcUrl`, `secretKey`, `deadlineMs` |
| Modules | Everything on one object | `SwapModule`, `LiquidityModule`, `FlashLoanModule`, `FeeModule`, `OracleModule`, `FactoryModule` |
| Amounts | `string` amounts, implicit decimals | `bigint` (i128) everywhere; `toSorobanAmount`/`fromSorobanAmount` for conversion |
| Errors | Generic `Error` | `CoralSwapSDKError` subclasses with a stable `code`, plus `mapError` |
| Native asset | Classic `XLM` asset object | `"XLM"` / `"native"` tokens resolved to the SAC contract address |
| Redaction | None (secrets could leak in debug logs) | Boundary redaction; see [docs/LOGGING.md](LOGGING.md) |

## Before/after examples

### 1. Client construction

```ts
// 0.x
const client = new CoralSwap({ rpc: RPC_URL, keypair: kp });

// 1.x
import { CoralSwapClient, Network } from "@coralswap/sdk";
const client = new CoralSwapClient({
  network: Network.TESTNET,
  rpcUrl: "https://soroban-testnet.stellar.org",
  secretKey: "S...",               // publicKey is derived
  deadlineMs: 5000,                // optional hard cap per RPC call
});
```

### 2. Swapping

```ts
// 0.x
const out = await client.swap(tokenA, tokenB, "0.5", "0.3%");

// 1.x
import { SwapModule, TradeType, toSorobanAmount } from "@coralswap/sdk";
const swap = new SwapModule(client);
const quote = await swap.getQuote({
  tokenIn: tokenA,
  tokenOut: tokenB,
  amount: toSorobanAmount("0.5", 7),
  tradeType: TradeType.EXACT_IN,
  slippageBps: 50,
});
const result = await swap.execute({ /* same params, optional deadline */ });
```

### 3. Amounts are always i128 `bigint`

```ts
// 0.x — strings with implicit decimals, easy to overflow
const amount = "1.5";                        // ambiguous

// 1.x — explicit, precision-loss-free
const amount = toSorobanAmount("1.5", 7);     // 15000000n
const display = fromSorobanAmount(amount, 7); // "1.5000000"
```

`toSorobanAmount` **rejects** values with more fractional places than the token's
`decimals` instead of silently truncating, so an accidental precision loss can
never land on-chain.

### 4. Errors

```ts
// 0.x
try { await client.addLiquidity(...); } catch (err) { console.error(err.message); }

// 1.x
import { mapError } from "@coralswap/sdk";
try { await liquidity.addLiquidity(params); }
catch (err) {
  const sdkError = mapError(err);
  switch (sdkError.code) {
    case "SLIPPAGE_EXCEEDED":     /* warn the user            */ break;
    case "DEADLINE_EXCEEDED":     /* re-quote and retry       */ break;
    case "INSUFFICIENT_LIQUIDITY"/* notify the user          */ break;
    default:                      /* unexpected — see details */;
  }
}
```

### 5. Native XLM

```ts
// 0.x — passed the classic Asset.native() around
import { Asset } from "@stellar/stellar-sdk";

// 1.x — string identifiers, resolved to the SAC contract automatically
swap.getQuote({
  tokenIn: "XLM",          // or "native"
  tokenOut: tokenB,
  amount: toSorobanAmount("10", 7),
  tradeType: TradeType.EXACT_IN,
});
const resolved = resolveTokenIdentifier("XLM", client.networkConfig.networkPassphrase);
```

## Step-by-step migration

1. **Install** `@coralswap/sdk` and replace the old import.
2. **Construct** `CoralSwapClient` with `network`, `rpcUrl`, and `secretKey` (or
   `publicKey` + external signer handling). If you run bots, set `deadlineMs`.
3. **Split** your single client usage into the module you need per feature:
   `SwapModule`, `LiquidityModule`, `FlashLoanModule`, `FeeModule`, `OracleModule`,
   `FactoryModule` — all constructed with the same client.
4. **Convert amounts** to `bigint` i128 with `toSorobanAmount`. Update any
   formatting to `fromSorobanAmount`/`formatAmount`.
5. **Add error handling**: wrap calls with `mapError` and switch on `err.code`.
6. **Update settings UI / tx builders** that passed deadlines in blocks to the new
   `deadline` (unix seconds) param; the SDK flushes expired deadlines with
   `DEADLINE_EXCEEDED`.
7. **Review logs**: enable `client.logger` and confirm no `S...` secret or full
   `AAAA...` XDR appears. Use logger context instead of string interpolation.
   See [docs/LOGGING.md](LOGGING.md).

## Removed APIs

| 0.x | Replacement |
|---|---|
| `CoralSwap` | `CoralSwapClient` + modules |
| `toAmount/fromAmount` (inferring decimals) | `toSorobanAmount`/`fromSorobanAmount` with explicit `decimals` |
| `client.swapExactIn(..., { slippage })` string variants | `SwapModule.getQuote` / `execute` with `slippageBps` |
| `client.on("error")` | `new Logger({ level })`, `client.logger` |

## Contract ABI remapping

CoralSwap is contract-first and ABI method names sit behind one configuration
object (`ABI` / `ContractConfig`). If a deployment ships a different ABI, remap the
names without code changes — see [docs/PERFORMANCE.md](PERFORMANCE.md) and the
`contractConfig` tab in the README.