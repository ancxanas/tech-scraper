import { colors } from "@cliffy/ansi/colors";
import { type Platform, PLATFORMS } from "../config.ts";
import { runCollector } from "../lib/collector.ts";
import { searchAmazonPreBuilt } from "../lib/amazon-dataset.ts";
import type { PlatformId, RankIntent } from "./types.ts";
import type { RawBatch } from "./pipeline.ts";

function depthFor(platform: Platform, pages: number): number {
  return platform === "amazon" ? pages * 3 : pages;
}

export interface CollectOptions {
  pages: number;
  maxRequests?: number;
  timeoutMs?: number;
}

const CATEGORY_HINT: Record<string, string> = {
  phone: "smartphone",
  earbuds: "earbuds",
  headphone: "headphones",
  laptop: "laptop",
  tablet: "tablet",
  smartwatch: "smartwatch",
  tv: "smart tv",
  camera: "camera",
};

const QUERY_NOISE =
  /\b(best|top|good|nice|great|show|find|me|some|please|the|a|an|list|of|any|which|what|are)\b/gi;

export function searchTerm(intent: RankIntent): string {
  const cleaned = intent.raw
    .replace(QUERY_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length >= 3) return cleaned;

  const parts: string[] = [];
  if (intent.brands.length) parts.push(intent.brands.join(" "));
  parts.push(CATEGORY_HINT[intent.category] ?? intent.category);
  if (intent.modelHint) parts.push(intent.modelHint);
  return parts.join(" ").trim() || intent.raw;
}

function flipkartUrl(intent: RankIntent, page: number): string {
  const params = [
    `q=${encodeURIComponent(searchTerm(intent))}`,
    `page=${page}`,
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
    params.push("low-price=0", `high-price=${intent.budgetMax}`);
  }
  return `https://www.amazon.in/s?${params.join("&")}`;
}

function relianceUrl(intent: RankIntent, page: number): string {
  const params = [
    `q=${encodeURIComponent(searchTerm(intent))}`,
    `page_no=${page}`,
    "page_size=40",
    "page_type=number",
  ];
  return `https://www.reliancedigital.in/search?${params.join("&")}`;
}

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

const COLLECTOR_STRIDE = 5;

export function buildUrls(
  platform: Platform,
  intent: RankIntent,
  pages: number,
): string[] {
  const urls: string[] = [];
  const stride = platform === "amazon" ? 1 : COLLECTOR_STRIDE;
  for (let i = 0; i < pages; i++) {
    const page = 1 + i * stride;
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

export async function collectRaw(
  platforms: Platform[],
  intent: RankIntent,
  options: CollectOptions,
): Promise<RawBatch[]> {
  const enabled = platforms;
  // Must exceed the collector's own polling budget (48 x 10s = 480s); a live
  // run lost all 168 Flipkart cards to a shorter wrapper timeout.
  const timeoutMs = options.timeoutMs ?? 540_000;

  const jobs = enabled.map(async (platform): Promise<RawBatch> => {
    const config = PLATFORMS[platform];
    const platformName = config.name;
    const started = Date.now();
    console.error(colors.dim(`  → ${platformName}: collecting…`));

    try {
      let items: unknown[];

      if (config.tool === "prebuilt") {
        const results = await withTimeout(
          searchAmazonPreBuilt(
            searchTerm(intent),
            depthFor("amazon", options.pages),
          ),
          timeoutMs,
          platformName,
        );
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
        const urls = buildUrls(
          platform,
          intent,
          depthFor(platform, options.pages),
        );
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
