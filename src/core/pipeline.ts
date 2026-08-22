import type {
  AnalyzedListing,
  Candidate,
  Offer,
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

type CheckoutMap = Map<string, import("./checkout.ts").CheckoutInfo>;

export interface RawBatch {
  platform: PlatformId;
  platformName: string;
  items: unknown[];
  status: "ok" | "error" | "empty";
  error?: string;
}

export interface PipelineOptions extends RankOptions {
  enrichText?: Map<string, string>;
  checkoutInfo?: CheckoutMap;
  externalSpecs?: Map<string, Partial<import("./types.ts").Specs>>;
  reviewData?: Map<string, import("./reviews.ts").ReviewSummary>;
  keepRejected?: boolean;
}

/**
 * One place decides what checkout data does to a candidate, so the
 * interactive and replay paths cannot drift apart.
 *
 * A page we measured outranks every card quote: cards are scraped from
 * search listings whose cheapest seller is routinely dead by fetch time,
 * while the sampled offer was read off the buy box itself. If the sampled
 * listing is not already the headline, it is promoted - price, stock and
 * all - and the remaining offers follow it.
 */
export function attachCheckout(
  candidates: Candidate[],
  info?: CheckoutMap,
): void {
  if (!info?.size) return;
  for (const c of candidates) {
    const hit = c.listings.find((l) => info.has(l.id));
    if (!hit) continue;
    const co = info.get(hit.id)!;
    c.checkout = co;
    // A stock reading describes the PLATFORM's warehouse, not one listing.
    // When the page we read belongs to the same platform as the headline
    // offer, that reading must reach the offer - else a phone whose own
    // page says "currently unavailable" keeps ranking as buyable. A
    // different platform's offer is untouched; their stock is their own.
    const samePlatform = hit.platform === c.best.platform;
    const measuredStock = co.inStock !== null && co.inStock !== undefined
      ? co.inStock
      : null;
    // Seller, EMI and delivery notes ride along without reordering anything;
    // only a price actually read off the buy box may lead the candidate.
    if (co.pagePrice === null) {
      if (samePlatform && measuredStock !== null) {
        c.best.inStock = measuredStock;
      }
      continue;
    }
    // Already the headline: just carry the measured stock state.
    if (c.best.url === hit.url) {
      if (measuredStock !== null) {
        c.best.inStock = measuredStock;
      }
      continue;
    }
    const base = c.best.price || 1;
    // Within 2% of the cheapest card the cards are trusted; promotion is
    // for disagreement - a stale or dead seller's quote.
    if (Math.abs(co.pagePrice - base) / base <= 0.02) {
      if (samePlatform && measuredStock !== null) {
        c.best.inStock = measuredStock;
      }
      continue;
    }

    const verified: Offer = {
      platform: hit.platform,
      platformName: hit.platformName,
      price: co.pagePrice,
      mrp: co.pageMrp ?? hit.mrp,
      discountPct: null,
      url: hit.url,
      inStock: co.inStock,
      rating: hit.rating,
      ratingCount: hit.ratingCount,
    };
    if (verified.mrp && verified.mrp > verified.price) {
      verified.discountPct = Math.round(
        ((verified.mrp - verified.price) / verified.mrp) * 100,
      );
    }
    c.best = verified;
    c.offers = [
      verified,
      ...c.offers.filter((o) => o.url !== verified.url),
    ];
  }
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

export function buildCandidates(
  intentIn: RankIntent,
  batches: RawBatch[],
  options: PipelineOptions = {},
): { intent: RankIntent; candidates: Candidate[] } {
  const analyzed = batches.flatMap((batch) => {
    const { listings } = normalizeBatch(batch.items, batch.platform);
    return listings.map((l) => {
      applyPagePrice(l, options);
      return analyze(l, {
        enrichText: options.enrichText,
        externalSpecs: options.externalSpecs,
      });
    });
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
  attachCheckout(candidates, options.checkoutInfo);
  return { intent, candidates };
}

function applyPagePrice(
  l: import("./types.ts").Listing,
  options: PipelineOptions,
): void {
  const page = options.checkoutInfo?.get(l.id);
  const card = l.price;
  if (!page?.pagePrice || !card) return;
  if (Math.abs(page.pagePrice - card) / card <= 0.02) return;
  l.cardPrice = card;
  l.price = page.pagePrice;
  if (page.pageMrp) l.mrp = page.pageMrp;
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

  const analyzedByBatch = batches.map((batch) => {
    const { listings, stats } = normalizeBatch(batch.items, batch.platform);
    for (const l of listings) applyPagePrice(l, options);
    return {
      batch,
      stats,
      listings,
      analyzed: listings.map((l) =>
        analyze(l, {
          enrichText: options.enrichText,
          externalSpecs: options.externalSpecs,
        })
      ),
    };
  });

  if (intent.category === "unknown") {
    const inferred = inferCategory(analyzedByBatch.flatMap((b) => b.analyzed));
    if (inferred !== "unknown") intent = { ...intent, category: inferred };
  }
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
      survived: 0,
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
  attachCheckout(candidates, options.checkoutInfo);
  const { ranked, rejected } = rankCandidates(
    candidates,
    rankableIntent,
    options,
  );

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
