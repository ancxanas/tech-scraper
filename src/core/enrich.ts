/**
 * Optional live spec enrichment.
 *
 * The offline knowledge base covers the models it knows; everything else ranks
 * with inferred specs and a visibly low confidence score. This module closes
 * that gap for the handful of products that actually matter — the finalists —
 * by fetching their product pages and re-running extraction on the real spec
 * sheet.
 *
 * It is strictly opt-in (`--enrich N`) and bounded, because every fetch costs
 * Web Unlocker credit. Enriching the top 8 of a 120-card scrape costs ~6% of
 * what enriching everything would.
 */

import { colors } from "@cliffy/ansi/colors";
import { fetchPageMarkdown } from "../lib/unlock.ts";
import type { RankedCandidate } from "./types.ts";

export interface EnrichResult {
  /** listing id -> extra spec text, consumable by `analyze()`. */
  text: Map<string, string>;
  fetched: number;
  failed: number;
  skipped: number;
}

/** Trim a PDP to the part that actually contains specifications. */
function extractSpecSection(markdown: string): string {
  const lower = markdown.toLowerCase();
  const anchors = [
    "specifications",
    "technical details",
    "product details",
    "general\n",
    "key features",
    "highlights",
  ];
  let start = -1;
  for (const a of anchors) {
    const i = lower.indexOf(a);
    if (i !== -1 && (start === -1 || i < start)) start = i;
  }
  const slice = start === -1 ? markdown : markdown.slice(start);
  // 12k chars is plenty for a spec table and keeps regex work cheap.
  return slice.slice(0, 12_000);
}

/**
 * Enrich the top `count` candidates. Failures are non-fatal: a product that
 * cannot be enriched simply keeps its inferred specs and its lower confidence.
 */
export async function enrichTop(
  ranked: RankedCandidate[],
  count: number,
  opts: { concurrency?: number; verbose?: boolean } = {},
): Promise<EnrichResult> {
  const result: EnrichResult = {
    text: new Map(),
    fetched: 0,
    failed: 0,
    skipped: 0,
  };
  if (count <= 0) return result;

  const targets = ranked
    .slice(0, count)
    // Nothing to gain from re-fetching a product whose specs we already know.
    .filter((r) => {
      if (r.specCompleteness >= 0.85 && r.kbConfidence === "high") {
        result.skipped++;
        return false;
      }
      return true;
    });

  const concurrency = opts.concurrency ?? 3;
  const queue = [...targets];

  const worker = async () => {
    while (queue.length) {
      const candidate = queue.shift();
      if (!candidate) break;
      const listing = candidate.listings.find((l) =>
        l.url === candidate.best.url
      ) ??
        candidate.listings[0];
      if (!listing?.url) {
        result.failed++;
        continue;
      }
      try {
        const md = await fetchPageMarkdown(listing.url);
        const section = extractSpecSection(md);
        // Attach to every listing in the group — they are the same product.
        for (const l of candidate.listings) result.text.set(l.id, section);
        result.fetched++;
        if (opts.verbose) {
          console.error(colors.dim(`    enriched: ${candidate.modelName}`));
        }
      } catch (err) {
        result.failed++;
        if (opts.verbose) {
          console.error(
            colors.dim(
              `    enrich failed: ${candidate.modelName} — ${
                err instanceof Error ? err.message : err
              }`,
            ),
          );
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, worker),
  );
  return result;
}
