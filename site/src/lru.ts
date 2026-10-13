// A toy LRU cache for the article's step-through diagram: the same policy as
// the Go and Rust caches, on a handful of keys.

/** What one write did. `order` runs most to least recently used. */
export interface Step {
  order: string[];
  hit: boolean;
  evicted?: string;
}

/**
 * Writes `key` to a cache holding `order` (most recent first) with room for
 * `capacity` keys. A cached key moves to the front; a new key goes in front and,
 * when the cache is full, pushes the last key out.
 */
export function write(order: readonly string[], key: string, capacity: number): Step {
  const rest = order.filter((k) => k !== key);
  if (rest.length < order.length) return { order: [key, ...rest], hit: true };
  const evicted = rest.length >= capacity ? rest.at(-1) : undefined;
  const kept = [key, ...rest].slice(0, capacity);
  return evicted === undefined ? { order: kept, hit: false } : { order: kept, hit: false, evicted };
}
