/**
 * Persistent spec cache.
 *
 * Specs do not change for a given product, so a page fetched once should never
 * be fetched again. This is what makes "resolve every candidate before ranking"
 * affordable: the first run pays for the fetches, every subsequent run on the
 * same catalogue is free and instant.
 *
 * Stored as one JSON file rather than KV so it survives without --unstable-kv
 * and can be inspected, diffed and deleted by hand.
 */

const DEFAULT_PATH = ".cache/specs.json";
/** Specs are immutable in practice; a month is a conservative refresh window. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  /** Trimmed spec-section text from the product page. */
  text: string;
  fetchedAt: string;
  /** Which transport produced it, for reporting. */
  via: "direct" | "unlocker";
}

export interface SpecStoreStats {
  hits: number;
  misses: number;
  writes: number;
  entries: number;
}

export class SpecStore {
  #path: string;
  #data = new Map<string, CacheEntry>();
  #loaded = false;
  #dirty = false;
  stats: SpecStoreStats = { hits: 0, misses: 0, writes: 0, entries: 0 };

  constructor(path = DEFAULT_PATH) {
    this.#path = path;
  }

  /** Cache key: the product URL without tracking noise. */
  static key(url: string): string {
    try {
      const u = new URL(url);
      const pid = u.searchParams.get("pid") ?? u.searchParams.get("asin") ?? "";
      return `${u.hostname}${u.pathname}${pid ? `?pid=${pid}` : ""}`;
    } catch {
      return url.split("?")[0];
    }
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const raw = JSON.parse(await Deno.readTextFile(this.#path)) as Record<
        string,
        CacheEntry
      >;
      const now = Date.now();
      for (const [k, v] of Object.entries(raw)) {
        if (now - Date.parse(v.fetchedAt) < TTL_MS) this.#data.set(k, v);
      }
    } catch {
      // No cache yet, or it is corrupt. Either way, start clean.
    }
    this.stats.entries = this.#data.size;
  }

  get(url: string): string | null {
    const hit = this.#data.get(SpecStore.key(url));
    if (hit) {
      this.stats.hits++;
      return hit.text;
    }
    this.stats.misses++;
    return null;
  }

  set(url: string, text: string, via: "direct" | "unlocker"): void {
    this.#data.set(SpecStore.key(url), {
      text,
      fetchedAt: new Date().toISOString(),
      via,
    });
    this.stats.writes++;
    this.#dirty = true;
  }

  async save(): Promise<void> {
    if (!this.#dirty) return;
    try {
      const dir = this.#path.split("/").slice(0, -1).join("/");
      if (dir) await Deno.mkdir(dir, { recursive: true });
      const out: Record<string, CacheEntry> = {};
      for (const [k, v] of this.#data) out[k] = v;
      await Deno.writeTextFile(this.#path, JSON.stringify(out));
      this.#dirty = false;
      this.stats.entries = this.#data.size;
    } catch {
      // A cache that cannot be written is a performance problem, not a
      // correctness one. Never fail a run over it.
    }
  }
}
