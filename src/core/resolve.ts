/**
 * Spec resolution — run BEFORE ranking, not after.
 *
 * The old flow ranked first and enriched the top N. That is circular: a phone
 * ranks low *because* its specs are unknown, so it never gets enriched, so it
 * stays low. The ranking was deciding what it was allowed to learn.
 *
 * This resolves every candidate it can, then ranks on the result. It is
 * affordable because:
 *   - specs never change, so a persistent cache makes repeat runs free;
 *   - the free direct transport covers Flipkart, which is most of the catalogue;
 *   - paid transports stay opt-in and bounded.
 */

import { colors } from "@cliffy/ansi/colors";
import {
  fetchDirect,
  fetchPageMarkdown,
  pageToText,
} from "../lib/fetch-page.ts";
import {
  type CheckoutInfo,
  hasCheckoutInfo,
  parseCheckout,
} from "./checkout.ts";
import { SpecStore } from "./spec-cache.ts";
import {
  type ReviewSummary,
  reviewsUrlFor,
  summariseReviews,
} from "./reviews.ts";
import { matchSocDetailed } from "../knowledge/soc.ts";
import {
  fetchSpecs as fetchExternalSpecs,
  loadIndex,
  RateLimited,
  resolveModel,
} from "../knowledge/gsmarena.ts";
import { fetchBeebomSpecs } from "../knowledge/beebom.ts";
import type { ExternalSpecs } from "../knowledge/spec-source.ts";
import type { Candidate, Specs } from "./types.ts";

/**
 * Where spec pages may be fetched from.
 *   auto     free direct fetch, falling back to Web Unlocker if permitted
 *   direct   free only; blocked pages stay unresolved
 *   unlocker Web Unlocker only (billed per request)
 *   cache    no network at all; use what is already cached
 */
export type FetchMode = "auto" | "direct" | "unlocker" | "cache";

export interface ResolveOptions {
  mode?: FetchMode;
  /** Mine the reviews page too (Flipkart only). Default true. */
  withReviews?: boolean;
  /** Delay between spec-database requests, ms. */
  pace?: number;
  /** Consult the external spec database (default true when an index exists). */
  useExternal?: boolean;
  /** Hard ceiling on network fetches. Cache hits never count against it. */
  limit?: number;
  concurrency?: number;
  /** Allow transports that cost money (Web Unlocker). */
  allowPaid?: boolean;
  store?: SpecStore;
  verbose?: boolean;
}

export interface SpecConflict {
  product: string;
  field: string;
  knowledgeBase: string;
  productPage: string;
  /** The page used an abbreviation, so this needs a human, not an overwrite. */
  ambiguous: boolean;
  /** Merchant listings and a spec database are not equal evidence. */
  source: "merchant" | "spec-db";
}

export interface ResolveResult {
  text: Map<string, string>;
  checkout: Map<string, CheckoutInfo>;
  /** Verified specs from the external database, keyed by listing id. */
  external: Map<string, Partial<Specs>>;
  /** Mined review summaries, keyed by listing id. */
  reviews: Map<string, ReviewSummary>;
  reviewsFetched: number;
  gsmMatched: number;
  gsmUnmatched: number;
  /** Models the secondary spec source resolved after the primary missed. */
  beebomMatched: number;
  /** The spec database throttled us; remaining models were left unresolved. */
  gsmRateLimited: boolean;
  fromCache: number;
  fetchedDirect: number;
  fetchedPaid: number;
  failed: number;
  skippedComplete: number;
  skippedPaid: number;
  /** Where the knowledge base disagrees with the actual product page. */
  conflicts: SpecConflict[];
  errors: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Trim a page to the part that actually contains specifications. */
function extractSpecSection(text: string): string {
  const lower = text.toLowerCase();
  const anchors = [
    "product highlights",
    "specifications",
    "technical details",
    "product details",
    "key features",
    "highlights",
  ];
  let start = -1;
  for (const a of anchors) {
    const i = lower.indexOf(a);
    if (i !== -1 && (start === -1 || i < start)) start = i;
  }
  const slice = start === -1 ? text : text.slice(start);
  return slice.slice(0, 24_000);
}

/** Paid transports are only reached when explicitly allowed. */
async function fetchPage(
  url: string,
  mode: FetchMode,
  allowPaid: boolean,
): Promise<{ text: string; via: "direct" | "unlocker" }> {
  const errors: string[] = [];

  if (mode === "auto" || mode === "direct") {
    try {
      const text = pageToText(await fetchDirect(url));
      // A block page is short and specless; treat it as a failure so we can
      // fall through rather than caching junk.
      if (text.length > 2000) return { text, via: "direct" };
      errors.push(`direct: ${text.length} chars (likely blocked)`);
    } catch (err) {
      errors.push(`direct: ${err instanceof Error ? err.message : err}`);
    }
  }

  if ((mode === "auto" || mode === "unlocker") && allowPaid) {
    try {
      return { text: await fetchPageMarkdown(url), via: "unlocker" };
    } catch (err) {
      errors.push(`unlocker: ${err instanceof Error ? err.message : err}`);
    }
  }

  throw new Error(errors.join(" | ") || "no transport available");
}

/**
 * Does the product page contradict what the knowledge base claims?
 *
 * Now that every candidate is fetched, this comes almost free — and it is the
 * only mechanism that can catch a KB entry being *wrong* rather than merely
 * missing. Hand-entered data is exactly the kind that drifts.
 */
function detectConflicts(c: Candidate, pageText: string): SpecConflict[] {
  const out: SpecConflict[] = [];
  const claimed = c.specs.socName;
  const fromSource = c.specSources.socName;
  if (claimed && (fromSource === "kb" || fromSource === "inferred")) {
    const found = matchSocDetailed(pageText);
    if (found && found.soc.name !== claimed) {
      out.push({
        product: c.modelName,
        field: "chipset",
        knowledgeBase: claimed,
        productPage: found.soc.name,
        ambiguous: found.ambiguous,
        source: "merchant",
      });
    }
  }
  return out;
}

/** External record -> the pipeline's spec shape. */
function toSpecs(g: ExternalSpecs): Partial<Specs> {
  const out: Partial<Specs> = {};
  const set = <K extends keyof Specs>(k: K, v: Specs[K] | null) => {
    if (v !== null && v !== undefined) out[k] = v;
  };
  if (g.socName) {
    const soc = matchSocDetailed(g.socName);
    set("socName", soc ? soc.soc.name : g.socName);
    // Prefer a measured benchmark over the approximation in our own table.
    set("antutu", g.antutu ?? soc?.soc.antutu ?? null);
  }
  set("batteryMah", g.batteryMah);
  set("chargingW", g.chargingW);
  set("panel", g.panel);
  set("displayInches", g.inches);
  set("refreshHz", g.refreshHz);
  set("resolution", g.resolution);
  set("mainCameraMp", g.mainCameraMp);
  set("ipRating", g.ipRating);
  set("nfc", g.nfc);
  if (g.ois) set("ois", true);
  return out;
}

/** Compare our hand-typed knowledge base against the external database. */
function conflictsAgainstKb(c: Candidate, g: ExternalSpecs): SpecConflict[] {
  const out: SpecConflict[] = [];
  if (
    c.specs.socName && c.specSources.socName === "kb" && g.socName &&
    matchSocDetailed(g.socName)?.soc.name !== c.specs.socName
  ) {
    out.push({
      product: c.modelName,
      field: "chipset",
      knowledgeBase: c.specs.socName,
      productPage: g.socName,
      ambiguous: false,
      source: "spec-db",
    });
  }
  return out;
}

/** True when there is nothing left worth fetching for this product. */
function isFullySpecced(c: Candidate): boolean {
  return c.specCompleteness >= 0.95 && c.kbConfidence === "high" &&
    c.checkout !== undefined;
}

export async function resolveSpecs(
  candidates: Candidate[],
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const mode = opts.mode ?? "auto";
  const allowPaid = opts.allowPaid ?? false;
  const store = opts.store ?? new SpecStore();
  await store.load();

  const result: ResolveResult = {
    text: new Map(),
    checkout: new Map(),
    external: new Map(),
    reviews: new Map(),
    reviewsFetched: 0,
    gsmMatched: 0,
    beebomMatched: 0,
    gsmUnmatched: 0,
    gsmRateLimited: false,
    fromCache: 0,
    fetchedDirect: 0,
    fetchedPaid: 0,
    failed: 0,
    skippedComplete: 0,
    skippedPaid: 0,
    conflicts: [],
    errors: [],
  };

  // Everything gets resolved, because ranking must not decide what it is
  // allowed to learn. Order still matters for the fetch budget: least-known
  // first, so a truncated run buys the most information.
  const queue = candidates
    .filter((c) => {
      if (isFullySpecced(c)) {
        result.skippedComplete++;
        return false;
      }
      return Boolean(c.best.url);
    })
    .sort((a, b) => a.specCompleteness - b.specCompleteness);

  let budget = opts.limit ?? Number.POSITIVE_INFINITY;

  const apply = (c: Candidate, text: string) => {
    const section = extractSpecSection(text);
    for (const l of c.listings) result.text.set(l.id, section);
    const checkout = parseCheckout(text);
    if (hasCheckoutInfo(checkout)) {
      for (const l of c.listings) result.checkout.set(l.id, checkout);
    }
    result.conflicts.push(...detectConflicts(c, section));
  };

  // External spec database first — it is the highest-quality source and it
  // corrects merchant pages rather than merely filling their gaps.
  //
  // Sequential and rate-limited on purpose. The first version fired ~70
  // parallel requests with no cache and was promptly blocked, which showed up
  // as "matched 19" on one run and "matched 0" on the next — an intermittent
  // failure that would have been very unpleasant to debug later.
  if (opts.useExternal !== false) {
    const index = await loadIndex();
    if (index.length > 0) {
      let fetchedThisRun = 0;
      for (const c of candidates) {
        // Match on the model identity, not the display name: the latter
        // carries a config suffix ("POCO M7 Pro 5G (6GB/128GB)") that no spec
        // database will ever contain.
        const lookupName = c.key.split("|")[0].split("#")[0].trim();
        const hit = resolveModel(lookupName, c.brand, index);
        if (!hit) {
          result.gsmUnmatched++;
          continue;
        }
        try {
          const cacheKey = `gsm://${hit.slug}`;
          let g: ExternalSpecs | null = null;

          const cached = store.get(cacheKey);
          if (cached) {
            g = JSON.parse(cached) as ExternalSpecs;
          } else {
            // Be a guest on someone else's server.
            if (fetchedThisRun > 0) await sleep(opts.pace ?? 1100);
            // Free first, always. --allow-paid grants permission to fall back,
            // it is not an instruction to spend: routing every lookup through
            // the paid transport would bill for pages the free one serves.
            let via: "direct" | "unlocker" = "direct";
            g = await fetchExternalSpecs(hit, lookupName, async (u) => {
              try {
                return await fetchDirect(u, 15000);
              } catch (err) {
                if (!allowPaid) throw err;
                via = "unlocker";
                result.fetchedPaid++;
                return await fetchPageMarkdown(u);
              }
            });
            fetchedThisRun++;
            if (g) store.set(cacheKey, JSON.stringify(g), via);
          }

          if (!g) {
            result.gsmUnmatched++;
            continue;
          }
          const partial = toSpecs(g);
          for (const l of c.listings) result.external.set(l.id, partial);
          result.gsmMatched++;
          result.conflicts.push(...conflictsAgainstKb(c, g));
        } catch (err) {
          if (err instanceof RateLimited) {
            result.gsmRateLimited = true;
            break; // every further request would fail identically
          }
          result.gsmUnmatched++;
        }
      }
    }
  }

  // Secondary spec source, for everything the primary could not answer.
  //
  // The primary has the better data but throttles hard: in the 2026-08-21 run
  // it resolved 4 models and then returned 429 for the remainder, which is
  // why 44 of 64 ranked phones showed "SoC ?". This host answered ten
  // back-to-back requests without complaint and covers the Indian budget
  // shelf the primary indexes late. Same cache, same pacing, same rule that
  // a miss is a normal outcome rather than an error.
  if (opts.useExternal !== false) {
    let fetchedThisRun = 0;
    for (const c of candidates) {
      // Only what is still missing — a model the primary already answered
      // must not be re-fetched, let alone overwritten by the weaker source.
      if (c.listings.some((l) => result.external.has(l.id))) continue;
      if (c.specs.socName && c.specSources.socName === "gsmarena") continue;

      const lookupName = c.key.split("|")[0].split("#")[0].trim();
      const cacheKey = `beebom://${lookupName.toLowerCase()}`;
      try {
        let b: ExternalSpecs | null = null;
        const cached = store.get(cacheKey);
        if (cached) {
          b = JSON.parse(cached) as ExternalSpecs;
        } else {
          if (fetchedThisRun > 0) await sleep(opts.pace ?? 1100);
          b = await fetchBeebomSpecs(lookupName, c.brand ?? undefined);
          fetchedThisRun++;
          if (b) store.set(cacheKey, JSON.stringify(b), "direct");
        }
        if (!b) continue;

        const partial = toSpecs(b);
        for (const l of c.listings) result.external.set(l.id, partial);
        result.beebomMatched++;
        result.conflicts.push(...conflictsAgainstKb(c, b));
      } catch {
        // A source that does not know this phone is not a failure.
      }
    }
  }

  // Cache pass first — free, instant, and it shrinks the fetch queue.
  const needsFetch: Candidate[] = [];
  for (const c of queue) {
    const cached = store.get(c.best.url);
    if (cached) {
      apply(c, cached);
      result.fromCache++;
    } else {
      needsFetch.push(c);
    }
  }

  if (mode === "cache") return result;

  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const pending = [...needsFetch];

  const worker = async () => {
    while (pending.length) {
      if (budget <= 0) return;
      const c = pending.shift();
      if (!c) return;
      budget--;
      try {
        const { text, via } = await fetchPage(c.best.url, mode, allowPaid);
        apply(c, text);
        store.set(c.best.url, extractSpecSection(text), via);
        if (via === "direct") result.fetchedDirect++;
        else result.fetchedPaid++;
        if (opts.verbose) {
          console.error(colors.dim(`    ${via}: ${c.modelName}`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/no transport|unlocker/.test(msg) && !allowPaid) {
          result.skippedPaid++;
        }
        result.failed++;
        if (result.errors.length < 3) {
          result.errors.push(`${c.modelName}: ${msg}`);
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, worker),
  );

  // Reviews are a separate page per product. Only Flipkart serves one we can
  // read, so coverage is partial by construction and the UI says so.
  const reviewMode: FetchMode = opts.mode ?? "auto";
  if (opts.withReviews !== false && reviewMode !== "unlocker") {
    for (const c of candidates) {
      const url = reviewsUrlFor(c.best.url);
      if (!url) continue;
      try {
        const key = `reviews://${url}`;
        let text = store.get(key);
        if (!text) {
          if (reviewMode === "cache") continue;
          text = pageToText(await fetchDirect(url, 15000));
          store.set(key, text.slice(0, 24_000), "direct");
          result.reviewsFetched++;
          await sleep(250);
        }
        const summary = summariseReviews(text);
        if (summary.sampled > 0 || summary.distribution) {
          for (const l of c.listings) result.reviews.set(l.id, summary);
        }
      } catch {
        // A missing reviews page is not a failure worth reporting per product.
      }
    }
  }

  await store.save();
  return result;
}

export function reportResolution(r: ResolveResult): void {
  const parts: string[] = [];
  if (r.gsmMatched) parts.push(`${r.gsmMatched} from spec database`);
  if (r.gsmRateLimited) parts.push("spec DB throttled");
  if (r.beebomMatched) parts.push(`${r.beebomMatched} from secondary source`);
  if (r.fromCache) parts.push(`${r.fromCache} cached`);
  if (r.fetchedDirect) parts.push(`${r.fetchedDirect} fetched free`);
  if (r.fetchedPaid) parts.push(`${r.fetchedPaid} via Web Unlocker`);
  if (r.reviews.size) parts.push(`${r.reviews.size} review pages`);
  if (r.skippedComplete) parts.push(`${r.skippedComplete} already complete`);
  if (r.failed) parts.push(`${r.failed} unavailable`);
  console.error(colors.dim(`  Specs: ${parts.join(", ") || "nothing to do"}`));

  if (r.gsmRateLimited) {
    console.error(
      colors.yellow(
        "  The spec database rate-limited this IP. Resolved models are cached\n  permanently, so re-running later continues where this left off.",
      ),
    );
  }

  if (r.conflicts.length) {
    console.error(
      colors.yellow(
        `  ${r.conflicts.length} knowledge-base conflict(s) — the product page disagrees:`,
      ),
    );
    for (const c of r.conflicts.slice(0, 5)) {
      console.error(
        colors.yellow(
          `    ${c.product}: KB says ${c.knowledgeBase}, page says ${c.productPage}${
            c.ambiguous
              ? colors.dim(" (page abbreviated — verify by hand)")
              : ""
          }`,
        ),
      );
    }
    console.error(
      colors.dim(
        "    Unambiguous page values win automatically; abbreviated ones are kept\n    as-is pending a correction to src/knowledge/models.ts.",
      ),
    );
  }
}
