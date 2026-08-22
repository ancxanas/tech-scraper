const DEFAULT_PATH = ".cache/specs.json";

import { isoNow, now } from "./clock.ts";

/** Compact age for one timestamp, e.g. "19m", "27h 00m", "2d 4h". */
export function ageLabel(iso: string, now = Date.now()): string | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  let s = Math.max(0, Math.round((now - then) / 1000));
  const d = Math.floor(s / 86_400);
  s -= d * 86_400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  // Hours until two days out: replay staleness lives on that scale.
  if (d >= 2) return `${d}d ${h}h`;
  if (d === 1) return `${24 + h}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

const SPEC_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PRICE_TTL_MS = 60 * 60 * 1000;
// Bumped when the parser changes, so entries written by an older, worse
// parser cannot be served back as if they were still valid. A run that
// stored markdown no parser could read looked like a warm cache for an hour.
const PRICE_PREFIX = "price://v2/";

function ttlFor(key: string): number {
  return key.startsWith(PRICE_PREFIX) ? PRICE_TTL_MS : SPEC_TTL_MS;
}

interface CacheEntry {
  text: string;
  fetchedAt: string;
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

  static priceKey(url: string): string {
    return `${PRICE_PREFIX}${SpecStore.key(url)}`;
  }

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
      for (const [k, v] of Object.entries(raw)) {
        if (now() - Date.parse(v.fetchedAt) < ttlFor(k)) this.#data.set(k, v);
      }
    } catch {
      // ignored
    }
    this.stats.entries = this.#data.size;
  }

  getPrice(url: string): string | null {
    const key = SpecStore.priceKey(url);
    const hit = this.#data.get(key);
    if (hit && now() - Date.parse(hit.fetchedAt) < PRICE_TTL_MS) {
      this.stats.hits++;
      return hit.text;
    }
    if (hit) this.#data.delete(key);
    this.stats.misses++;
    return null;
  }

  /** When the cached price sample was fetched, if it is still fresh. */
  priceFetchedAt(url: string): string | null {
    const hit = this.#data.get(SpecStore.priceKey(url));
    if (hit && now() - Date.parse(hit.fetchedAt) < PRICE_TTL_MS) {
      return hit.fetchedAt;
    }
    return null;
  }

  /** When the cached spec page was fetched. Spec entries live 30 days. */
  fetchedAt(url: string): string | null {
    const hit = this.#data.get(SpecStore.key(url));
    return hit?.fetchedAt ?? null;
  }

  setPrice(url: string, text: string, via: "direct" | "unlocker"): void {
    this.#data.set(SpecStore.priceKey(url), {
      text,
      fetchedAt: isoNow(),
      via,
    });
    this.stats.writes++;
    this.#dirty = true;
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
      fetchedAt: isoNow(),
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
      // ignored
    }
  }
}
