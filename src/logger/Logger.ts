import { didRedact, redact, type RedactOptions } from "./redact";

export const LogLevel = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  SILENT: "silent",
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

const LEVEL_RANK: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
  [LogLevel.SILENT]: 100,
};

export interface LoggedContext {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: LoggedContext;
  redacted?: boolean;
}

export interface LoggerOptions {
  level?: LogLevel;
  /**
   * Redaction applied at the logger boundary before any sink sees the entry.
   *
   * Pass `false` or `{ disabled: true }` to opt out (not recommended for
   * shared/production logs). See `docs/LOGGING.md`.
   */
  redact?: boolean | RedactOptions;
  /** Hook that receives every emitted (already-redacted) entry. */
  sink?: (entry: LogEntry) => void;
  /** Base context merged into every entry and every child logger. */
  context?: LoggedContext;
  /** Include a redaction marker in entries that were modified. */
  failClosed?: boolean;
}

export type Sink = (entry: LogEntry) => void;

const DEFAULT_SINK: Sink = (entry) => {
  const line = `[${new Date(entry.timestamp).toISOString()}] ${entry.level.toUpperCase()}: ${entry.message}`;
  const method =
    entry.level === LogLevel.ERROR ? "error" : entry.level === LogLevel.WARN ? "warn" : entry.level === LogLevel.INFO ? "info" : "log";
  console[method](line);
  if (entry.context && Object.keys(entry.context).length > 0) {
    console[method](entry.context);
  }
};

/**
 * Minimal structured logger for the SDK.
 *
 * Every entry is passed through the {@link redact} helper at the boundary, so
 * secret keys and signed transaction payloads that surface in retry/polling
 * debug logs never reach the sink by default. See docs/LOGGING.md.
 */
export class Logger {
  readonly options: LoggerOptions;
  readonly context?: LoggedContext;

  constructor(options: LoggerOptions = {}) {
    this.options = options;
    this.context = options.context;
  }

  get level(): LogLevel {
    return this.options.level ?? LogLevel.INFO;
  }

  /** Whether a message at `level` would currently be emitted. */
  shouldLog(level: LogLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.level];
  }

  /**
   * Create a derived logger that merges `context` into every entry it emits.
   * Options (level, redaction, sink) are inherited.
   */
  child(context: LoggedContext): Logger {
    return new Logger({
      ...this.options,
      context: { ...this.context, ...context },
    });
  }

  debug(message: unknown, context?: LoggedContext): void {
    this.emit(LogLevel.DEBUG, message, context);
  }

  info(message: unknown, context?: LoggedContext): void {
    this.emit(LogLevel.INFO, message, context);
  }

  warn(message: unknown, context?: LoggedContext): void {
    this.emit(LogLevel.WARN, message, context);
  }

  error(message: unknown, context?: LoggedContext): void {
    this.emit(LogLevel.ERROR, message, context);
  }

  private emit(level: LogLevel, message: unknown, context?: LoggedContext): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const redactConfig = this.options.redact === false ? { disabled: true } : (this.options.redact ?? {}) as RedactOptions;

    const mergedContext = { ...this.context, ...context };
    const changed = didRedact(mergedContext, redactConfig) || didRedact(String(message), redactConfig);
    const redactedContext = redact(mergedContext, redactConfig) as LoggedContext;
    const redactedMessage = redact(String(message), redactConfig) as string;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message: redactedMessage,
      context: Object.keys(redactedContext).length > 0 ? redactedContext : undefined,
      redacted: changed || undefined,
    };

    const sink = this.options.sink ?? DEFAULT_SINK;
    sink(entry);
  }
}

/** Convenience factory for a logger with the given options. */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}