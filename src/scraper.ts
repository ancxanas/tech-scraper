import { colors } from "@cliffy/ansi/colors";
import { type Platform, PLATFORMS } from "./config.ts";
import { parseCustomProducts, runCollector } from "./tools/scraper.ts";
import { fetchPageHtml } from "./lib/unlock.ts";
import { searchAmazonPreBuilt } from "./lib/prescrapers.ts";
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

  const scrapePromises = enabled.map(async (platform, i) => {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, SCRAPER_DELAY_MS));
    }

    const config = PLATFORMS[platform];
    console.error(`  Scraping ${config.name}...`);

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
        status: products.length > 0 ? "ok" : "empty",
      });
      console.error(colors.green(`  Found ${products.length} products`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(colors.red(`  ${config.name} failed: ${msg}`));
      results.push({
        query,
        platform: config.name,
        products: [],
        timestamp: new Date().toISOString(),
        status: "error",
        error: msg,
      });
    }
  });

  await Promise.allSettled(scrapePromises);

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
        console.error(colors.yellow(`  Retrying (attempt ${attempt + 1})...`));
        await new Promise((r) => setTimeout(r, SCRAPER_DELAY_MS));
      }

      const flipkartPages = platform === "flipkart" ? 1 : pages;
      const urls = buildPageUrls(platform, query, flipkartPages);
      const raw = await runCollector(config.collectorId!, urls);
      return parseCustomProducts(raw, platform);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("rate limit") && attempt < MAX_RETRIES) {
        console.log(colors.yellow(`  Rate limited, waiting before retry...`));
        continue;
      }

      console.error(colors.yellow(`  Scraper Studio failed: ${msg}`));
      console.error(colors.dim(`  Falling back to Web Unlocker...`));

      try {
        const fallback = await webUnlockerFallback(platform, query, pages);
        if (fallback.length > 0) return fallback;
      } catch (fallbackErr) {
        const fallbackMsg = fallbackErr instanceof Error
          ? fallbackErr.message
          : String(fallbackErr);
        console.error(colors.red(`  Fallback also failed: ${fallbackMsg}`));
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
  console.error(
    colors.dim(
      `  WARNING: HTML fallback parser is experimental for ${platform}`,
    ),
  );
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

    const cardStart = match.index ?? 0;
    const cardEnd = html.indexOf("</h2>", cardStart + 100);
    const cardHtml = html.slice(
      cardStart,
      cardEnd > 0 ? cardEnd : cardStart + 2000,
    );

    const priceMatch = cardHtml.match(/₹[\s]*([0-9,]+)/);
    const price = priceMatch
      ? parseInt(priceMatch[1].replace(/,/g, ""), 10)
      : 0;

    if (price <= 0) continue;

    const oldPriceMatch = cardHtml.match(/₹[\s]*([0-9,]+)/g);
    let originalPrice = price;
    if (oldPriceMatch && oldPriceMatch.length >= 2) {
      const parsed = parseInt(
        oldPriceMatch[1].replace(/[₹\s,]/g, ""),
        10,
      );
      if (parsed > price) originalPrice = parsed;
    }

    const discount = originalPrice > price
      ? Math.round(((originalPrice - price) / originalPrice) * 100)
      : 0;

    products.push({
      name: title,
      price,
      originalPrice,
      discount,
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
