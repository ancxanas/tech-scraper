import { type Platform, PLATFORMS } from "./config.ts";
import { parseCustomProducts, runCollector } from "./tools/scraper.ts";
import type { SearchResult } from "./types.ts";

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
        `  Waiting ${SCRAPER_DELAY_MS / 1000}s before next scraper...`,
      );
      await new Promise((r) => setTimeout(r, SCRAPER_DELAY_MS));
    }

    console.log(`  Scraping ${config.name} (${pages} pages)...`);

    let success = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`  Retrying (attempt ${attempt + 1})...`);
          await new Promise((r) => setTimeout(r, SCRAPER_DELAY_MS));
        }

        const urls = buildPageUrls(platform, query, pages);
        const raw = await runCollector(config.collectorId, urls);
        const products = parseCustomProducts(raw, platform);
        results.push({
          query,
          platform: config.name,
          products,
          timestamp: new Date().toISOString(),
        });
        console.log(`  Found ${products.length} products`);
        success = true;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("rate limit") && attempt < MAX_RETRIES) {
          console.log(`  Rate limited, waiting before retry...`);
          continue;
        }
        console.error(`  Failed: ${msg}`);
        results.push({
          query,
          platform: config.name,
          products: [],
          timestamp: new Date().toISOString(),
        });
        break;
      }
    }

    if (!success) {
      console.error(
        `  Skipped ${config.name} after ${MAX_RETRIES + 1} attempts`,
      );
    }
  }

  return results;
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
