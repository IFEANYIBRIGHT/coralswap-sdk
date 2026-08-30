export { CoralSwapClient, type CoralSwapClientOptions, type ReadContractOptions, type Reserves } from "./client/CoralSwapClient";
export { Network, NETWORKS, getNetworkConfig, type NetworkConfig } from "./client/Network";

export { ABI, validateContractConfig, type ContractConfig } from "./contracts";

export { ErrorCode, type ErrorCode as ErrorCodeType } from "./errors/codes";
export { CoralSwapSDKError, type CoralSwapSDKErrorOptions } from "./errors/CoralSwapSDKError";
export {
  ConfigError,
  DeadlineError,
  InsufficientLiquidityError,
  NetworkError,
  NotFoundError,
  RedactionBlockedError,
  RpcError,
  SlippageError,
  TransactionFailedError,
  UnauthorizedError,
  ValidationError,
} from "./errors/index";
export { mapError } from "./errors/mapError";

export {
  redact,
  redactText,
  didRedact,
  classifyRedaction,
  isRedactedMarker,
  DEFAULT_SENSITIVE_KEY_PATTERN,
  DEFAULT_SENSITIVE_KEYS,
  STELLAR_SECRET_PATTERN,
  SIGNED_XDR_PAYLOAD_PATTERN,
  DEFAULT_MIN_SIGNED_PAYLOAD_LENGTH,
  type RedactOptions,
  type RedactResult,
  type RedactionKind,
} from "./logger";
export { Logger, createLogger, LogLevel, type LoggerOptions, type LogEntry, type LoggedContext, type Sink } from "./logger";

export {
  TTLCache,
  type CacheOptions,
} from "./cache";

export {
  toSorobanAmount,
  fromSorobanAmount,
  formatAmount,
} from "./utils/amounts";
export { isValidAddress, isValidContractAddress, sortTokens } from "./utils/address";
export { withRetry, delay, type RetryOptions, type RetryInfo } from "./utils/retry";
export { nowSeconds, secondsFromNow, computeDeadline, assertNotExpired, applySlippageToAmount } from "./utils/time";
export {
  isNativeToken,
  resolveTokenIdentifier,
  getNativeAssetContractAddress,
  NATIVE_ASSET_SYMBOLS,
  DEFAULT_NATIVE_SAC_ADDRESSES,
  type NativeAssetSymbol,
} from "./utils/tokenIdentifier";
export { FEE_SCALE, getAmountOut, getAmountIn, getPriceImpactBps } from "./utils/swapMath";
export { sqrt, quote, bigintMin, getAddLiquidityAmounts, getRemoveLiquidityAmounts, type ReservesState } from "./utils/liquidityMath";

export { FactoryModule, type PairInfo } from "./modules/FactoryModule";
export { SwapModule, TradeType, type GetQuoteParams, type SwapQuote, type HopQuote, type SwapExecuteParams } from "./modules/SwapModule";
export {
  LiquidityModule,
  type AddLiquidityQuote,
  type GetAddLiquidityQuoteParams,
  type AddLiquidityParams,
  type RemoveLiquidityQuote,
  type RemoveLiquidityParams,
} from "./modules/LiquidityModule";
export { FlashLoanModule, type FlashLoanEstimate, type FlashLoanParams, type FlashLoanResult } from "./modules/FlashLoanModule";
export { FeeModule, type FeeEstimate, type FeeComparisonEntry } from "./modules/FeeModule";
export { OracleModule, computeTWAP, type Observation, type TWAPQuote, type GetTWAPOptions } from "./modules/OracleModule";

export { SorobanRpc, type SorobanRpcOptions, type SorobanServer, type PollOptions } from "./soroban/rpc";
export {
  ContractRunner,
  type ContractRunnerOptions,
  type ContractCallOperation,
  type ReadContractSpec,
  type SubmitContractSpec,
  type SubmitContractResult,
} from "./soroban/contractRunner";
export {
  toScVal,
  fromScVal,
  normalizeScValNative,
  i128,
  u32,
  u64,
  address,
  boolValue,
  stringValue,
  bytesValue,
  type ScVal,
  type ArgType,
  type ContractArg,
} from "./soroban/scval";

export { DEFAULT_SLIPPAGE_BPS, DEFAULT_DEADLINE_SECONDS, FEE_SCALE_BPS, REDACTED_MARKER } from "./constants";