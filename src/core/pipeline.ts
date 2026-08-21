/**
 * End-to-end analysis pipeline: raw platform payloads -> ranked candidates.
 *
 * Deliberately decoupled from BrightData. It takes raw JSON batches from
 * anywhere — a live scrape, a replay directory, or a unit test fixture — so the
 * expensive part (scraping) and the part that needs iteration (ranking) can be
 * developed independently.
 */

import type {
  AnalyzedListing,
  Candidate,
  PipelineDiagnostics,
  PipelineResult,
  PlatformId,
  RankIntent,
} from "./types.ts";
import { normalizeBatch } from "./normalize.ts";
import { analyze } from "./extract.ts";
import { groupListings } from "./group.ts";
import { rankCandidates, type RankOptions } from "./rank.ts";
import { categoryMatches } from "./classify.ts";

export interface RawBatch {
  platform: PlatformId;
  platformName: string;
  items: unknown[];
  status: "ok" | "error" | "empty";
  error?: string;
}

export interface PipelineOptions extends RankOptions {
  /** Extra PDP text keyed by listing id, from `--enrich`. */
  enrichText?: Map<string, string>;
  /** Checkout details keyed by listing id, from the same enrichment pass. */
  checkoutInfo?: Map<string, import("./checkout.ts").CheckoutInfo>;
  /** Verified external specs keyed by listing id. */
  externalSpecs?: Map<string, Partial<import("./types.ts").Specs>>;
  /** Mined review summaries keyed by listing id. */
  reviewData?: Map<string, import("./reviews.ts").ReviewSummary>;
  /** Keep rejected listings for the diagnostics view. */
  keepRejected?: boolean;
}

function fieldFill(listings: AnalyzedListing[]): number {
  if (listings.length === 0) return 0;
  const fields: Array<(l: AnalyzedListing) => boolean> = [
    (l) => l.title.length > 0,
    (l) => l.price !== null,
    (l) => l.mrp !== null,
    (l) => l.rating !== null,
    (l) => l.ratingCount !== null,
    (l) => l.imageUrl !== null,
    (l) => l.url.length > 0,
    (l) => l.specs.storageGb !== null,
  ];
  let hits = 0;
  for (const l of listings) for (const f of fields) if (f(l)) hits++;
  return hits / (listings.length * fields.length);
}

/**
 * When the query names a product but no category ("sony wh-1000xm5"), infer the
 * category from what actually came back. Without this the ranker falls through
 * to phone scoring and grades headphones on chipset and camera.
 */
function inferCategory(listings: AnalyzedListing[]): RankIntent["category"] {
  const tally = new Map<string, number>();
  for (const l of listings) {
    if (l.category === "unknown" || l.category === "accessory") continue;
    tally.set(l.category, (tally.get(l.category) ?? 0) + l.categoryConfidence);
  }
  if (tally.size === 0) return "unknown";
  const [top] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  return top[0] as RankIntent["category"];
}

/**
 * Phase 1: raw payloads -> grouped candidates, with no ranking yet.
 *
 * Exposed separately so specs can be resolved before anything is scored.
 * Ranking must not decide which products it is allowed to learn about.
 */
export function buildCandidates(
  intentIn: RankIntent,
  batches: RawBatch[],
  options: PipelineOptions = {},
): { intent: RankIntent; candidates: Candidate[] } {
  const analyzed = batches.flatMap((batch) => {
    const { listings } = normalizeBatch(batch.items, batch.platform);
    return listings.map((l) =>
      analyze(l, {
        enrichText: options.enrichText,
        externalSpecs: options.externalSpecs,
      })
    );
  });

  let intent = intentIn;
  if (intent.category === "unknown") {
    const inferred = inferCategory(analyzed);
    if (inferred !== "unknown") intent = { ...intent, category: inferred };
  }

  const candidates = groupListings(analyzed);
  if (options.reviewData?.size) {
    for (const c of candidates) {
      const hit = c.listings.find((l) => options.reviewData!.has(l.id));
      if (hit) c.reviews = options.reviewData!.get(hit.id);
    }
  }
  if (options.checkoutInfo?.size) {
    for (const c of candidates) {
      const hit = c.listings.find((l) => options.checkoutInfo!.has(l.id));
      if (!hit) continue;
      c.checkout = options.checkoutInfo!.get(hit.id);
      // The checkout block was read from the best offer's own page, so its
      // availability belongs to that offer. `best` is the same object as
      // offers[0], so the --in-stock-only gate sees this too.
      if (c.checkout?.inStock !== null && c.checkout?.inStock !== undefined) {
        c.best.inStock = c.checkout.inStock;
      }
    }
  }
  return { intent, candidates };
}

export function runPipeline(
  query: string,
  intentIn: RankIntent,
  batches: RawBatch[],
  options: PipelineOptions = {},
): PipelineResult {
  const diagnostics: PipelineDiagnostics[] = [];
  const allAnalyzed: AnalyzedListing[] = [];
  let intent = intentIn;

  // First pass: normalise + analyse everything, so category inference has
  // evidence to work from before any gating happens.
  const analyzedByBatch = batches.map((batch) => {
    const { listings, stats } = normalizeBatch(batch.items, batch.platform);
    return {
      batch,
      stats,
      listings,
      analyzed: listings.map((l) =>
        analyze(l, { enrichText: options.enrichText })
      ),
    };
  });

  if (intent.category === "unknown") {
    const inferred = inferCategory(analyzedByBatch.flatMap((b) => b.analyzed));
    if (inferred !== "unknown") intent = { ...intent, category: inferred };
  }
  // Only phones are ranked. If the query turned out to be for something else,
  // every candidate will be gated out below and the caller reports why.
  const rankableIntent: RankIntent = { ...intent, category: "phone" };

  for (const { batch, stats, listings, analyzed } of analyzedByBatch) {
    const rejectionReasons: Record<string, number> = {};
    let categoryMatched = 0;
    let inBudget = 0;
    for (const a of analyzed) {
      const catOk = categoryMatches(intent.category, a.category);
      if (catOk) categoryMatched++;
      else {
        const k = `category:${a.category}`;
        rejectionReasons[k] = (rejectionReasons[k] ?? 0) + 1;
      }
      const budgetOk = !intent.budgetMax ||
        (a.price !== null && a.price <= intent.budgetMax);
      if (catOk && budgetOk) inBudget++;
      else if (catOk && !budgetOk) {
        rejectionReasons["over budget"] =
          (rejectionReasons["over budget"] ?? 0) + 1;
      }
      if (a.price === null) {
        rejectionReasons["no price"] = (rejectionReasons["no price"] ?? 0) + 1;
      }
    }

    diagnostics.push({
      platform: batch.platformName,
      rawCards: batch.items.length,
      normalized: listings.length,
      titleRecovered: stats.titleRecovered,
      priced: listings.filter((l) => l.price !== null).length,
      categoryMatched,
      inBudget,
      survived: 0, // filled after ranking
      fieldFill: fieldFill(analyzed),
      status: batch.status,
      error: batch.error,
      rejectionReasons,
    });

    allAnalyzed.push(...analyzed);
  }

  const candidates = groupListings(allAnalyzed);
  if (options.reviewData?.size) {
    for (const c of candidates) {
      const hit = c.listings.find((l) => options.reviewData!.has(l.id));
      if (hit) c.reviews = options.reviewData!.get(hit.id);
    }
  }
  if (options.checkoutInfo?.size) {
    for (const c of candidates) {
      const hit = c.listings.find((l) => options.checkoutInfo!.has(l.id));
      if (!hit) continue;
      c.checkout = options.checkoutInfo!.get(hit.id);
      // The checkout block was read from the best offer's own page, so its
      // availability belongs to that offer. `best` is the same object as
      // offers[0], so the --in-stock-only gate sees this too.
      if (c.checkout?.inStock !== null && c.checkout?.inStock !== undefined) {
        c.best.inStock = c.checkout.inStock;
      }
    }
  }
  const { ranked, rejected } = rankCandidates(
    candidates,
    rankableIntent,
    options,
  );

  // Attribute survivors back to their source platforms for the coverage table.
  const survivedByPlatform = new Map<string, number>();
  for (const r of ranked) {
    for (const l of r.listings) {
      survivedByPlatform.set(
        l.platformName,
        (survivedByPlatform.get(l.platformName) ?? 0) + 1,
      );
    }
  }
  for (const d of diagnostics) {
    d.survived = survivedByPlatform.get(d.platform) ?? 0;
  }

  const prices = ranked.map((r) => r.best.price).sort((a, b) => a - b);

  return {
    query,
    intent,
    ranked,
    rejected: options.keepRejected
      ? rejected.flatMap(({ candidate, reasons }) =>
        candidate.listings.map((l) => ({ ...l, rejected: reasons }))
      )
      : [],
    diagnostics,
    stats: {
      rawCards: batches.reduce((s, b) => s + b.items.length, 0),
      candidates: candidates.length,
      ranked: ranked.length,
      medianPrice: prices.length ? prices[Math.floor(prices.length / 2)] : null,
      priceRange: prices.length ? [prices[0], prices[prices.length - 1]] : null,
    },
  };
}
