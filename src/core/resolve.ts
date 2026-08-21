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
import { matchSocDetailed, matchSocExact } from "../knowledge/soc.ts";
import {
  fetchSpecs as fetchExternalSpecs,
  loadIndex,
  RateLimited,
  resolveModel,
} from "../knowledge/gsmarena.ts";
import { fetchBeebomSpecs } from "../knowledge/beebom.ts";
import type { ExternalSpecs } from "../knowledge/spec-source.ts";
import type { Candidate, Specs } from "./types.ts";

export type FetchMode = "auto" | "direct" | "unlocker" | "cache";

export interface ResolveOptions {
  mode?: FetchMode;
  withReviews?: boolean;
  pace?: number;
  useExternal?: boolean;
  limit?: number;
  concurrency?: number;
  allowPaid?: boolean;
  store?: SpecStore;
  verbose?: boolean;
}

export interface SpecConflict {
  product: string;
  field: string;
  knowledgeBase: string;
  productPage: string;
  ambiguous: boolean;
  source: "merchant" | "spec-db";
}

export interface ResolveResult {
  text: Map<string, string>;
  checkout: Map<string, CheckoutInfo>;
  external: Map<string, Partial<Specs>>;
  reviews: Map<string, ReviewSummary>;
  reviewsFetched: number;
  gsmMatched: number;
  gsmUnmatched: number;
  beebomMatched: number;
  gsmRateLimited: boolean;
  fromCache: number;
  fetchedDirect: number;
  fetchedPaid: number;
  failed: number;
  skippedComplete: number;
  skippedPaid: number;
  conflicts: SpecConflict[];
  errors: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function fetchPage(
  url: string,
  mode: FetchMode,
  allowPaid: boolean,
): Promise<{ text: string; via: "direct" | "unlocker" }> {
  const errors: string[] = [];

  if (mode === "auto" || mode === "direct") {
    try {
      const text = pageToText(await fetchDirect(url));
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

export function toSpecs(g: ExternalSpecs): Partial<Specs> {
  const out: Partial<Specs> = {};
  const set = <K extends keyof Specs>(k: K, v: Specs[K] | null) => {
    if (v !== null && v !== undefined) out[k] = v;
  };
  if (g.socName) {
    const exact = matchSocExact(g.socName);
    const soc = exact ? { soc: exact } : matchSocDetailed(g.socName);
    set("socName", soc ? soc.soc.name : g.socName);
    set("antutu", soc?.soc.antutu ?? g.antutu ?? null);
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

function conflictsAgainstKb(c: Candidate, g: ExternalSpecs): SpecConflict[] {
  const out: SpecConflict[] = [];
  if (
    c.specs.socName && c.specSources.socName === "kb" && g.socName &&
    // Exact-match first: the value came from a structured field, so it needs
    // no context word to be believed.
    (matchSocExact(g.socName) ?? matchSocDetailed(g.socName)?.soc)?.name !==
      c.specs.socName
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

  if (opts.useExternal !== false) {
    const index = await loadIndex();
    if (index.length > 0) {
      let fetchedThisRun = 0;
      for (const c of candidates) {
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
            if (fetchedThisRun > 0) await sleep(opts.pace ?? 1100);
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
            break;
          }
          result.gsmUnmatched++;
        }
      }
    }
  }

  if (opts.useExternal !== false) {
    let fetchedThisRun = 0;
    for (const c of candidates) {
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
        const kbDisagrees = c.kbConfidence === "high" &&
          c.specSources.socName === "kb" && c.specs.socName &&
          partial.socName &&
          partial.socName !== c.specs.socName;
        if (kbDisagrees) {
          delete partial.socName;
          delete partial.antutu;
        }
        for (const l of c.listings) result.external.set(l.id, partial);
        result.beebomMatched++;
        result.conflicts.push(...conflictsAgainstKb(c, b));
      } catch {
        // ignored
      }
    }
  }

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
        // ignored
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
    if (r.conflicts.length > 5) {
      console.error(
        colors.yellow(`    …and ${r.conflicts.length - 5} more`),
      );
    }
    console.error(
      colors.dim(
        "    A high-confidence knowledge-base entry wins and the page is ignored;\n    below that the page wins. Either way, correct the loser in\n    src/knowledge/models.ts.",
      ),
    );
  }
}
