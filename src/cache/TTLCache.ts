export interface CacheOptions {
  /** Default TTL for entries, in milliseconds. Default `60_000`. */
  ttlMs?: number;
  /** Maximum number of live entries; evicts expired then oldest when exceeded. */
  maxEntries?: number;
}

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;

/**
 * Minimal TTL cache used across the SDK (reserves, fees, decimal lookups).
 *
 * All reads are O(1) amortized: `get` lazily evicts the single expired entry it
 * touches. See `docs/PERFORMANCE.md` and `docs/adr/ADR-003-caching-approach.md`.
 */
export class TTLCache<K, V> {
  private readonly map = new Map<K, CacheEntry<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? 500;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  set(key: K, value: V, ttlMs?: number): void {
    this.evictExpired();
    const now = Date.now();
    this.map.set(key, {
      value,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.ttlMs),
    });
    while (this.map.size > this.maxEntries) {
      this.evictOldest();
    }
  }

  catchable<T>(key: K, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return Promise.resolve(cached as unknown as T);
    }
    return loader().then((value) => {
      this.set(key, value as unknown as V, ttlMs);
      return value;
    });
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** Snapshot of current entries (for debugging/tests). */
  entries(): Array<{ key: K; value: V; expiresAt: number }> {
    const out: Array<{ key: K; value: V; expiresAt: number }> = [];
    for (const [key, entry] of this.map) {
      out.push({ key, value: entry.value, expiresAt: entry.expiresAt });
    }
    return out;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (now >= entry.expiresAt) {
        this.map.delete(key);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: K | undefined;
    let oldestAt = Infinity;
    for (const [key, entry] of this.map) {
      if (entry.createdAt < oldestAt) {
        oldestAt = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.map.delete(oldestKey);
    }
  }
}