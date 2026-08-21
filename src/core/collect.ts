/**
 * Live collection layer.
 *
 * Returns RAW platform payloads — no parsing, no filtering. Everything
 * downstream (normalise → classify → group → rank) works identically on live
 * payloads and on replayed ones, so ranking can be iterated for free.
 *
 * Also fixes the URL construction bugs that poisoned the old runs:
 *   - Reliance was hard-coded to /collection/smartphones regardless of query,
 *     which is why a "phones under 15000" search returned ₹499 earphones.
 *   - Tata CLiQ used a category code glued into the text param, producing a
 *     URL whose product grid never renders (hence wait_element_timeout).
 */

import { colors } from "@cliffy/ansi/colors";
import { type Platform, PLATFORMS } from "../config.ts";
import { runCollector } from "../lib/collector.ts";
import { searchAmazonPreBuilt } from "../lib/prescrapers.ts";
import type { PlatformId, RankIntent } from "./types.ts";
import type { RawBatch } from "./pipeline.ts";

export interface CollectOptions {
  pages: number;
  /** Hard ceiling on collector invocations for this run — credit guard. */
  maxRequests?: number;
  timeoutMs?: number;
}

const CATEGORY_HINT: Record<string, string> = {
  phone: "mobile phone",
  earbuds: "earbuds",
  headphone: "headphones",
  laptop: "laptop",
  tablet: "tablet",
  smartwatch: "smartwatch",
  tv: "smart tv",
  camera: "camera",
};

/** The keyword string we actually send to a marketplace search box. */
export function searchTerm(intent: RankIntent): string {
  const parts: string[] = [];
  if (intent.brands.length) parts.push(intent.brands.join(" "));
  parts.push(CATEGORY_HINT[intent.category] ?? intent.category);
  if (intent.modelHint) parts.push(intent.modelHint);
  const term = parts.join(" ").trim();
  return term || intent.raw;
}

function flipkartUrl(intent: RankIntent, page: number): string {
  const params = [
    `q=${encodeURIComponent(searchTerm(intent))}`,
    `page=${page}`,
    // Sort by popularity so page 1 is the segment's real contenders rather
    // than whatever the relevance model surfaces for a fuzzy phrase.
    "sort=popularity",
  ];
  if (intent.budgetMax) {
    params.push(
      "p%5B%5D=facets.price_range.from%3DMin",
      `p%5B%5D=facets.price_range.to%3D${intent.budgetMax}`,
    );
  }
  if (intent.budgetMin) {
    params.push(`p%5B%5D=facets.price_range.from%3D${intent.budgetMin}`);
  }
  for (const b of intent.brands) {
    params.push(`p%5B%5D=${encodeURIComponent(`facets.brand[]=${b}`)}`);
  }
  return `https://www.flipkart.com/search?${params.join("&")}`;
}

function amazonUrl(intent: RankIntent, page: number): string {
  const params = [
    `k=${encodeURIComponent(searchTerm(intent))}`,
    `page=${page}`,
  ];
  if (intent.budgetMax) {
    // Amazon's price filter is in rupees, low-price/high-price.
    params.push("low-price=0", `high-price=${intent.budgetMax}`);
  }
  return `https://www.amazon.in/s?${params.join("&")}`;
}

/**
 * Reliance Digital: use the real search endpoint, not a static collection.
 * The collection URL ignores the query entirely — the root cause of the
 * earphones-in-a-phone-search bug.
 */
function relianceUrl(intent: RankIntent, page: number): string {
  const params = [
    `q=${encodeURIComponent(searchTerm(intent))}`,
    `page_no=${page}`,
    "page_size=40",
    "page_type=number",
  ];
  return `https://www.reliancedigital.in/search?${params.join("&")}`;
}

/**
 * Tata CLiQ: plain text search. The old builder embedded
 * "query:relevance:category:MSH1210" into `text`, which returns a page whose
 * product grid never mounts, so the collector timed out after 48 polls.
 */
function tataCliqUrl(intent: RankIntent, page: number): string {
  const params = [
    "searchCategory=all",
    `text=${encodeURIComponent(searchTerm(intent))}`,
    `page=${page}`,
  ];
  if (intent.budgetMax) {
    params.push(
      "p%5B%5D=facets.price_range.from%3DMin",
      `p%5B%5D=facets.price_range.to%3D${intent.budgetMax}`,
    );
  }
  return `https://www.tatacliq.com/search/?${params.join("&")}`;
}

export function buildUrls(
  platform: Platform,
  intent: RankIntent,
  pages: number,
): string[] {
  const urls: string[] = [];
  for (let page = 1; page <= pages; page++) {
    switch (platform) {
      case "flipkart":
        urls.push(flipkartUrl(intent, page));
        break;
      case "amazon":
        urls.push(amazonUrl(intent, page));
        break;
      case "reliance":
        urls.push(relianceUrl(intent, page));
        break;
      case "tatacliq":
        urls.push(tataCliqUrl(intent, page));
        break;
    }
  }
  return urls;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
        ms,
      )
    ),
  ]);
}

/** Collect raw payloads from every requested platform, in parallel. */
export async function collectRaw(
  platforms: Platform[],
  intent: RankIntent,
  options: CollectOptions,
): Promise<RawBatch[]> {
  const enabled = platforms.filter((p) => PLATFORMS[p].enabled);
  const timeoutMs = options.timeoutMs ?? 300_000;

  const jobs = enabled.map(async (platform): Promise<RawBatch> => {
    const config = PLATFORMS[platform];
    const platformName = config.name;
    const started = Date.now();
    console.error(colors.dim(`  → ${platformName}: collecting…`));

    try {
      let items: unknown[];

      if (config.tool === "prebuilt") {
        const results = await withTimeout(
          searchAmazonPreBuilt(searchTerm(intent), options.pages),
          timeoutMs,
          platformName,
        );
        // Re-shape into raw-style records so the normaliser treats every
        // platform identically.
        items = results.map((r) => ({
          product_name: r.title,
          selling_price: r.price,
          original_price: r.originalPrice,
          discount_percentage: r.discount ? `${r.discount}%` : undefined,
          rating: r.rating,
          review_count: r.reviewsCount,
          brand: r.brand,
          availability: r.availability,
          image_url: r.imageUrl,
          product_url: r.url,
          asin: r.asin,
          seller: r.seller,
        }));
      } else {
        if (!config.collectorId) throw new Error("No collector ID configured");
        const urls = buildUrls(platform, intent, options.pages);
        items = await withTimeout(
          runCollector(config.collectorId, urls.map((url) => ({ url }))),
          timeoutMs,
          platformName,
        );
      }

      const secs = ((Date.now() - started) / 1000).toFixed(0);
      console.error(
        colors.green(
          `  ✓ ${platformName}: ${items.length} raw cards in ${secs}s`,
        ),
      );
      return {
        platform: platform as PlatformId,
        platformName,
        items,
        status: items.length > 0 ? "ok" : "empty",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(colors.red(`  ✗ ${platformName}: ${msg}`));
      return {
        platform: platform as PlatformId,
        platformName,
        items: [],
        status: "error",
        error: msg,
      };
    }
  });

  return await Promise.all(jobs);
}
