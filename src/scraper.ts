import { PLATFORMS, type Platform } from "./config.ts";
import type { Product, SearchResult } from "./types.ts";

export async function scrapeProducts(
  query: string,
  platforms: Platform[],
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const config = PLATFORMS[platform];
    const searchUrl = buildSearchUrl(platform, query);

    if (i > 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log(`  Scraping ${config.name}...`);

    try {
      const raw = await runScraper(config.collectorId, searchUrl);
      const products = parseProducts(raw, platform);
      results.push({
        query,
        platform: config.name,
        products,
        timestamp: new Date().toISOString(),
      });
      console.log(`  Found ${products.length} products`);
    } catch (err) {
      console.error(`  Failed: ${err instanceof Error ? err.message : err}`);
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

function buildSearchUrl(platform: Platform, query: string): string {
  const config = PLATFORMS[platform];
  const encoded = encodeURIComponent(query);
  return `${config.url}/search?q=${encoded}`;
}

async function runScraper(
  collectorId: string,
  url: string,
): Promise<unknown[]> {
  const command = new Deno.Command("brightdata", {
    args: [
      "scraper", "run", collectorId, url,
      "--json", "--timeout", "600",
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout);

  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr);
    throw new Error(stderr || `Scraper failed with code ${output.code}`);
  }

  const lines = stdout.trim().split("\n");
  const lastLine = lines[lines.length - 1];
  const parsed = JSON.parse(lastLine);
  return Array.isArray(parsed) ? parsed : [];
}

function parseProducts(raw: unknown[], platform: Platform): Product[] {
  return raw
    .filter((item) => {
      const p = item as Record<string, unknown>;
      return !p.error && p.product_name;
    })
    .map((item) => {
      const p = item as Record<string, unknown>;
      const price = extractNumber(p.price);
      const originalPrice = extractNumber(p.original_price);
      const discount = parseDiscount(p.discount_percentage as string);

      return {
        name: (p.product_name as string) || "Unknown",
        price,
        originalPrice: originalPrice || price,
        discount,
        brand: (p.brand as string) || "",
        availability: (p.availability as string) || "Unknown",
        imageUrl: (p.image_url as string) || "",
        productUrl: (p.product_url as string) || (p.product_page_url as string) || "",
        platform: PLATFORMS[platform].name,
        rating: parseRating(p.rating as string),
      };
    })
    .filter((p) => p.price > 0);
}

function extractNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "object" && val !== null && "value" in val) {
    return Number((val as Record<string, unknown>).value) || 0;
  }
  return 0;
}

function parseDiscount(val: string | undefined): number {
  if (!val) return 0;
  const match = val.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseRating(val: string | undefined): number | undefined {
  if (!val || val === "Share your opinion") return undefined;
  const match = val.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : undefined;
}
