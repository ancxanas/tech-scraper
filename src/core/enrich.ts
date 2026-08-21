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
import { fetchDirect, fetchPageMarkdown, htmlToText } from "../lib/unlock.ts";
import { type CheckoutInfo, hasCheckoutInfo, parseCheckout } from "./offers.ts";
import type { RankedCandidate } from "./types.ts";

export interface EnrichResult {
  /** listing id -> extra spec text, consumable by `analyze()`. */
  text: Map<string, string>;
  /** listing id -> what the buyer actually pays, from the same fetch. */
  checkout: Map<string, CheckoutInfo>;
  fetched: number;
  failed: number;
  skipped: number;
  /** How each successful fetch was obtained. */
  viaDirect: number;
  viaUnlocker: number;
  /** First error per transport, for a useful failure message. */
  errors: string[];
}

export type FetchMode = "auto" | "direct" | "unlocker";

/**
 * Try the free path first, then the paid one.
 *
 * Returns the page as plain text plus which transport worked, so the CLI can
 * tell the user whether they need Web Unlocker at all.
 */
async function fetchPage(
  url: string,
  mode: FetchMode,
): Promise<{ text: string; via: "direct" | "unlocker" }> {
  const errors: string[] = [];

  if (mode === "auto" || mode === "direct") {
    try {
      const html = await fetchDirect(url);
      const text = htmlToText(html);
      // A block page is short and specless; treat it as a failure so we fall
      // through to the paid transport rather than "succeeding" with nothing.
      if (text.length > 2000) return { text, via: "direct" };
      errors.push(
        `direct: page too short (${text.length} chars, likely blocked)`,
      );
    } catch (err) {
      errors.push(`direct: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (mode === "auto" || mode === "unlocker") {
    try {
      return { text: await fetchPageMarkdown(url), via: "unlocker" };
    } catch (err) {
      errors.push(`unlocker: ${err instanceof Error ? err.message : err}`);
    }
  }

  throw new Error(errors.join(" | "));
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
  opts: { concurrency?: number; verbose?: boolean; mode?: FetchMode } = {},
): Promise<EnrichResult> {
  const mode = opts.mode ?? "auto";
  const result: EnrichResult = {
    text: new Map(),
    checkout: new Map(),
    fetched: 0,
    failed: 0,
    skipped: 0,
    viaDirect: 0,
    viaUnlocker: 0,
    errors: [],
  };
  if (count <= 0) return result;

  // Two different reasons to fetch a page, so two selection rules.
  //
  //  - Specs: target what we know least about. Filtering BEFORE taking N
  //    matters; slicing first spent the whole budget on ranks 1-N, nearly all
  //    already in the KB, and recovered nothing.
  //  - Checkout price: only obtainable by fetching, and only actionable for
  //    the products actually being recommended. So the leaders are always
  //    fetched even when their specs are already known.
  const LEADERS = Math.min(3, count);
  const leaders = ranked.slice(0, LEADERS);
  const leaderKeys = new Set(leaders.map((r) => r.key));

  const needsSpecs = ranked
    .filter((r) => !leaderKeys.has(r.key))
    .filter((r) => {
      if (r.specCompleteness >= 0.85 && r.kbConfidence === "high") {
        result.skipped++;
        return false;
      }
      return true;
    })
    .sort((a, b) => a.score.confidence - b.score.confidence);

  const targets = [...leaders, ...needsSpecs].slice(0, count);

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
        const { text, via } = await fetchPage(listing.url, mode);
        const section = extractSpecSection(text);
        // Offers are parsed from the whole page, not the spec section.
        const checkout = parseCheckout(text);
        // Attach to every listing in the group — they are the same product.
        for (const l of candidate.listings) {
          result.text.set(l.id, section);
          if (hasCheckoutInfo(checkout)) result.checkout.set(l.id, checkout);
        }
        result.fetched++;
        if (via === "direct") result.viaDirect++;
        else result.viaUnlocker++;
        if (opts.verbose) {
          console.error(
            colors.dim(`    enriched via ${via}: ${candidate.modelName}`),
          );
        }
      } catch (err) {
        result.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        if (result.errors.length < 3) result.errors.push(msg);
        if (opts.verbose) {
          console.error(
            colors.dim(`    enrich failed: ${candidate.modelName} — ${msg}`),
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

/** One-line summary that tells the user which transport actually worked. */
export function reportEnrichment(r: EnrichResult): void {
  const parts = [`enriched ${r.fetched}`];
  if (r.viaDirect) parts.push(`${r.viaDirect} direct (free)`);
  if (r.viaUnlocker) parts.push(`${r.viaUnlocker} via Web Unlocker`);
  if (r.skipped) parts.push(`${r.skipped} skipped (already known)`);
  if (r.failed) parts.push(`${r.failed} failed`);
  console.error(colors.dim(`  ${parts.join(", ")}`));

  if (r.fetched === 0 && r.failed > 0) {
    console.error(
      colors.yellow(
        "  Nothing could be fetched. Marketplaces block datacenter IPs, and Web\n  Unlocker needs business KYC. Running this from a home connection in India\n  usually makes --enrich-via direct work.",
      ),
    );
    for (const e of r.errors) console.error(colors.dim(`    ${e}`));
  } else if (r.viaDirect > 0 && r.viaUnlocker === 0) {
    console.error(
      colors.green("  Direct fetch worked — no Web Unlocker credit needed."),
    );
  }
  console.error("");
}
