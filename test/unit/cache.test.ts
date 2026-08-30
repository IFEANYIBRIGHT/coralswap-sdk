import { describe, it, expect, vi } from "vitest";
import { TTLCache } from "../../src/cache/TTLCache";

describe("TTLCache", () => {
  it("stores and retrieves values until the TTL elapses", () => {
    const cache = new TTLCache<string, number>({ ttlMs: 60_000 });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);
    cache.set("a", 2);
    expect(cache.get("a")).toBe(2);
  });

  it("expires stale entries", () => {
    const cache = new TTLCache<string, number>({ ttlMs: 60_000 });
    cache.set("gone", 1, -1);
    expect(cache.has("gone")).toBe(false);
    expect(cache.get("gone")).toBeUndefined();
  });

  it("deletes and clears", () => {
    const cache = new TTLCache<number, string>({ ttlMs: 60_000 });
    cache.set(1, "a");
    cache.set(2, "b");
    cache.delete(1);
    expect(cache.get(1)).toBeUndefined();
    cache.clear();
    expect(cache.has(2)).toBe(false);
  });

  it("evicts the oldest entry when at capacity", () => {
    const cache = new TTLCache<string, number>({ ttlMs: 60_000, maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("catchable memoizes the loader", async () => {
    const cache = new TTLCache<string, number>({ ttlMs: 60_000 });
    const loader = vi.fn(async () => 42);
    await expect(cache.catchable("k", loader)).resolves.toBe(42);
    await expect(cache.catchable("k", loader)).resolves.toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("entries reflects live state", () => {
    const cache = new TTLCache<string, number>({ ttlMs: 60_000 });
    cache.set("x", 1);
    const [entry] = cache.entries();
    expect(entry).toBeDefined();
    expect(entry!.key).toBe("x");
    expect(entry!.value).toBe(1);
    expect(typeof entry!.expiresAt).toBe("number");
  });
});