import { colors } from "@cliffy/ansi/colors";
import { type Platform, PLATFORMS } from "./config.ts";
import { parseCustomProducts, runCollector } from "./tools/scraper.ts";
import { fetchPageHtml } from "./lib/unlock.ts";
import {
  searchAmazonPreBuilt,
  searchFlipkartViaSerp,
} from "./lib/prescrapers.ts";
import type { Product, SearchResult } from "./types.ts";

const SCRAPER_DELAY_MS = 5000;
const MAX_RETRIES = 2;

export async function scrapeProducts(
  query: string,
  platforms: Platform[],
  pages = 5,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  const enabled = platforms.filter((p) => PLATFORMS[p].enabled);

  for (let i = 0; i < enabled.length; i++) {
    const platform = enabled[i];
    const config = PLATFORMS[platform];

    if (i > 0) {
      console.log(
        colors.dim(
          `  Waiting ${SCRAPER_DELAY_MS / 1000}s before next scraper...`,
        ),
      );
      await new Promise((r) => setTimeout(r, SCRAPER_DELAY_MS));
    }

    console.log(`  Scraping ${config.name}...`);

    try {
      let products: Product[];

      if (config.tool === "prebuilt") {
        products = await scrapePreBuilt(platform, query, pages);
      } else {
        products = await scrapeScraperStudio(platform, query, pages);
      }

      results.push({
        query,
        platform: config.name,
        products,
        timestamp: new Date().toISOString(),
      });
      console.log(colors.green(`  Found ${products.length} products`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(colors.red(`  ${config.name} failed: ${msg}`));
      results.push({
        query,
        platform: config.name,
        products: [],
        timestamp: new Date().toISOString(),
      });
    }
  }

  return results;
}

async function scrapePreBuilt(
  platform: Platform,
  query: string,
  pages: number,
): Promise<Product[]> {
  switch (platform) {
    case "amazon": {
      const items = await searchAmazonPreBuilt(query, pages);
      return items
        .filter((item) => item.price > 0)
        .map((item) => ({
          name: item.title,
          price: item.price,
          originalPrice: item.originalPrice,
          discount: item.discount,
          brand: item.brand,
          availability: item.availability,
          imageUrl: item.imageUrl,
          productUrl: item.url,
          platform: "Amazon India",
          rating: item.rating ?? undefined,
        }));
    }
    case "flipkart": {
      const items = await searchFlipkartViaSerp(query);
      return items
        .filter((item) => item.price > 0)
        .map((item) => ({
          name: item.title,
          price: item.price,
          originalPrice: item.originalPrice,
          discount: item.discount,
          brand: item.brand,
          availability: item.availability,
          imageUrl: item.imageUrl,
          productUrl: item.url,
          platform: "Flipkart",
          rating: item.rating ?? undefined,
        }));
    }
    default:
      throw new Error(`No prebuilt scraper for ${platform}`);
  }
}

async function scrapeScraperStudio(
  platform: Platform,
  query: string,
  pages: number,
): Promise<Product[]> {
  const config = PLATFORMS[platform];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(colors.yellow(`  Retrying (attempt ${attempt + 1})...`));
        await new Promise((r) => setTimeout(r, SCRAPER_DELAY_MS));
      }

      const urls = buildPageUrls(platform, query, pages);
      const raw = await runCollector(config.collectorId!, urls);
      return parseCustomProducts(raw, platform);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("rate limit") && attempt < MAX_RETRIES) {
        console.log(colors.yellow(`  Rate limited, waiting before retry...`));
        continue;
      }

      console.log(colors.yellow(`  Scraper Studio failed: ${msg}`));
      console.log(colors.dim(`  Falling back to Web Unlocker...`));

      try {
        return await webUnlockerFallback(platform, query, pages);
      } catch (fallbackErr) {
        const fallbackMsg = fallbackErr instanceof Error
          ? fallbackErr.message
          : String(fallbackErr);
        console.error(colors.red(`  Fallback also failed: ${fallbackMsg}`));
        return [];
      }
    }
  }

  return [];
}

async function webUnlockerFallback(
  platform: Platform,
  query: string,
  pages: number,
): Promise<Product[]> {
  const urls = buildPageUrls(platform, query, Math.min(pages, 1));
  const products: Product[] = [];

  for (const url of urls) {
    const html = await fetchPageHtml(url);
    const parsed = parseHtmlProducts(html, platform);
    products.push(...parsed);
  }

  return products;
}

function parseHtmlProducts(html: string, platform: Platform): Product[] {
  const products: Product[] = [];
  const config = PLATFORMS[platform];

  const titleMatches = html.matchAll(
    /<h2[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]*?)<\/h2>/gi,
  );

  for (const match of titleMatches) {
    const titleHtml = match[1];
    const title = titleHtml.replace(/<[^>]+>/g, "").trim();
    if (!title || title.length < 3) continue;

    products.push({
      name: title,
      price: 0,
      originalPrice: 0,
      discount: 0,
      brand: "",
      availability: "Unknown",
      imageUrl: "",
      productUrl: "",
      platform: config.name,
    });
  }

  return products;
}

function buildPageUrls(
  platform: Platform,
  query: string,
  pages: number,
): string[] {
  const config = PLATFORMS[platform];
  const encoded = encodeURIComponent(query);
  const urls: string[] = [];

  for (let i = 0; i < pages; i++) {
    const pageNum = config.startIndex + i;
    const qs = platform === "tatacliq"
      ? `searchCategory=all&text=${encoded}&page=${pageNum}`
      : `q=${encoded}&page=${pageNum}`;
    urls.push(`${config.url}${config.searchPath}?${qs}`);
  }

  return urls;
}
