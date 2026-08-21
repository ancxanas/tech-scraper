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

export function runPipeline(
  query: string,
  intent: RankIntent,
  batches: RawBatch[],
  options: PipelineOptions = {},
): PipelineResult {
  const diagnostics: PipelineDiagnostics[] = [];
  const allAnalyzed: AnalyzedListing[] = [];

  for (const batch of batches) {
    const { listings, stats } = normalizeBatch(batch.items, batch.platform);
    const analyzed = listings.map((l) =>
      analyze(l, { enrichText: options.enrichText })
    );

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
  const { ranked, rejected } = rankCandidates(candidates, intent, options);

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
