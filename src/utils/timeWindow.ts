/**
 * Stockage en mémoire avec expiration, utilisé par les détecteurs (anti-spam, anti-raid, anti-nuke…).
 * Aucune requête SQL : les états vivent uniquement en RAM et sont purgés périodiquement.
 */
export class ExpiringMap<K, V> {
  private readonly map = new Map<K, { value: V; touchedAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: K, now = Date.now()): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (now - entry.touchedAt > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  getOrCreate(key: K, factory: () => V, now = Date.now()): V {
    const existing = this.get(key, now);
    if (existing !== undefined) {
      this.map.get(key)!.touchedAt = now;
      return existing;
    }
    const value = factory();
    this.map.set(key, { value, touchedAt: now });
    return value;
  }

  set(key: K, value: V, now = Date.now()): void {
    this.map.set(key, { value, touchedAt: now });
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  /** Supprime les entrées expirées. Retourne le nombre d'entrées supprimées. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [k, entry] of this.map) {
      if (now - entry.touchedAt > this.ttlMs) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }
}

/** Retire en place les éléments plus anciens que `windowMs`. Les éléments doivent être triés par `ts`. */
export function pruneOlderThan<T extends { ts: number }>(items: T[], windowMs: number, now: number): T[] {
  let i = 0;
  while (i < items.length && now - items[i]!.ts > windowMs) i++;
  if (i > 0) items.splice(0, i);
  return items;
}
