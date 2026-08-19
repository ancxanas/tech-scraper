import { colors } from "@cliffy/ansi/colors";
import { type Platform, PLATFORMS } from "./config.ts";
import {
  type CollectorInput,
  parseCustomProducts,
  runCollector,
} from "./tools/scraper.ts";
import { searchAmazonPreBuilt } from "./lib/prescrapers.ts";
import { runHealFlow } from "./tools/healer.ts";
import type { Product, SearchResult } from "./types.ts";

const MAX_RETRIES = 2;

export interface ScrapeOptions {
  pages: number;
  noHeal: boolean;
  enrichCount: number;
}

export function scrapeProducts(
  query: string,
  platforms: Platform[],
  options: ScrapeOptions,
): Promise<SearchResult[]> {
  const enabled = platforms.filter((p) => PLATFORMS[p].enabled);

  const scrapePromises = enabled.map((platform) =>
    scrapePlatform(platform, query, options)
  );

  return Promise.allSettled(scrapePromises).then((settled) =>
    settled.map((r, i) =>
      r.status === "fulfilled" ? r.value : {
        query,
        platform: PLATFORMS[enabled[i]].name,
        products: [],
        timestamp: new Date().toISOString(),
        status: "error" as const,
        error: r.reason?.message || "Unknown error",
        requestedPages: options.pages,
        rawCount: 0,
        parsedCount: 0,
        healAttempted: false,
        healSuccess: false,
        coverage: { fieldFillRate: 0 },
      }
    )
  );
}

async function scrapePlatform(
  platform: Platform,
  query: string,
  options: ScrapeOptions,
): Promise<SearchResult> {
  const config = PLATFORMS[platform];
  console.error(`  Scraping ${config.name}...`);

  let products: Product[] = [];
  let rawCount = 0;
  let healAttempted = false;
  let healSuccess = false;
  let lastError = "";

  if (config.tool === "prebuilt") {
    const result = await scrapePreBuilt(platform, query, options.pages);
    products = result.products;
    rawCount = result.rawCount;
    lastError = result.error;
  } else {
    const result = await scrapeScraperStudio(platform, query, options);
    products = result.products;
    rawCount = result.rawCount;
    healAttempted = result.healAttempted;
    healSuccess = result.healSuccess;
    lastError = result.error;
  }

  const fieldFillRate = calcFieldFillRate(products);
  const status = products.length > 0 ? "ok" : lastError ? "error" : "empty";

  console.error(
    colors.green(`  ${config.name}: ${products.length} products (${status})`),
  );

  return {
    query,
    platform: config.name,
    products,
    timestamp: new Date().toISOString(),
    status,
    error: lastError || undefined,
    requestedPages: options.pages,
    rawCount,
    parsedCount: products.length,
    healAttempted,
    healSuccess,
    coverage: { fieldFillRate },
  };
}

async function scrapePreBuilt(
  _platform: Platform,
  query: string,
  pages: number,
): Promise<{ products: Product[]; rawCount: number; error: string }> {
  try {
    const items = await searchAmazonPreBuilt(query, pages);
    const rawCount = items.length;
    const now = new Date().toISOString();

    const products = items
      .filter((item) => item.price > 0)
      .map((item) => ({
        id: `amazon:${item.asin || hashCode(item.url)}`,
        name: item.title,
        price: item.price,
        originalPrice: item.originalPrice || item.price,
        discount: item.discount,
        currency: item.currency,
        productUrl: item.url,
        imageUrl: item.imageUrl,
        platform: "Amazon India",
        scrapedAt: now,
        brand: item.brand || undefined,
        rating: item.rating ?? undefined,
        reviewsCount: item.reviewsCount ?? undefined,
        seller: item.seller || undefined,
        availability: item.availability || "Unknown",
      }));

    return { products, rawCount, error: "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { products: [], rawCount: 0, error: msg };
  }
}

interface ScrapeStudioResult {
  products: Product[];
  rawCount: number;
  healAttempted: boolean;
  healSuccess: boolean;
  error: string;
}

async function scrapeScraperStudio(
  platform: Platform,
  query: string,
  options: ScrapeOptions,
): Promise<ScrapeStudioResult> {
  const config = PLATFORMS[platform];
  const collectorId = config.collectorId;

  if (!collectorId) {
    return {
      products: [],
      rawCount: 0,
      healAttempted: false,
      healSuccess: false,
      error: "No collector ID configured",
    };
  }

  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.error(
          colors.yellow(
            `  Retrying ${config.name} (attempt ${attempt + 1})...`,
          ),
        );
        await delay(3000);
      }

      const inputs = buildCollectorInputs(platform, query, options.pages);
      const raw = await runCollector(collectorId, inputs);
      const rawCount = raw.length;
      const products = parseCustomProducts(raw, platform);

      if (products.length > 0) {
        return {
          products,
          rawCount,
          healAttempted: false,
          healSuccess: false,
          error: "",
        };
      }

      if (options.noHeal) {
        return {
          products: [],
          rawCount,
          healAttempted: false,
          healSuccess: false,
          error: "Empty results",
        };
      }

      const healResult = await tryHeal(
        collectorId,
        config.name,
        platform,
        query,
        options,
      );
      if (healResult.products.length > 0) {
        return {
          products: healResult.products,
          rawCount: healResult.rawCount,
          healAttempted: true,
          healSuccess: true,
          error: "",
        };
      }

      return {
        products: [],
        rawCount,
        healAttempted: true,
        healSuccess: false,
        error: healResult.error || "Empty after heal",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("rate limit") && attempt < MAX_RETRIES) {
        console.error(
          colors.yellow(`  Rate limited on ${config.name}, waiting...`),
        );
        await delay(5000);
        continue;
      }
      lastError = msg;
    }
  }

  return {
    products: [],
    rawCount: 0,
    healAttempted: false,
    healSuccess: false,
    error: lastError || "All retries failed",
  };
}

async function tryHeal(
  collectorId: string,
  platformName: string,
  platform: Platform,
  query: string,
  options: ScrapeOptions,
): Promise<{ products: Product[]; rawCount: number; error: string }> {
  console.error(colors.yellow(`  Auto-healing ${platformName} scraper...`));

  try {
    const healResult = await runHealFlow(
      collectorId,
      "The scraper returns empty results or missing price/name fields. Fix selectors to capture product title, price, original price, discount, rating, reviews, brand, image URL, and product URL from the page.",
      false,
    );

    if (!healResult.success) {
      return {
        products: [],
        rawCount: 0,
        error: "Heal was rejected or failed",
      };
    }

    console.error(
      colors.green(`  Heal applied. Re-running ${platformName}...`),
    );
    const inputs = buildCollectorInputs(platform, query, options.pages);
    const raw = await runCollector(collectorId, inputs);
    const products = parseCustomProducts(raw, platform);
    return { products, rawCount: raw.length, error: "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(colors.red(`  Auto-heal failed: ${msg}`));
    return { products: [], rawCount: 0, error: msg };
  }
}

function buildCollectorInputs(
  platform: Platform,
  query: string,
  pages: number,
): CollectorInput[] {
  const config = PLATFORMS[platform];
  const encoded = encodeURIComponent(query);
  const inputs: CollectorInput[] = [];

  if (config.pagination === "page") {
    for (let i = 0; i < pages; i++) {
      const pageNum = config.startIndex + i;
      const url = config.searchUrlTemplate
        .replace("{q}", encoded)
        .replace("{page}", String(pageNum));
      inputs.push({ url });
    }
  } else {
    const url = config.searchUrlTemplate.replace("{q}", encoded);
    inputs.push({ url });
  }

  return inputs;
}

function calcFieldFillRate(products: Product[]): number {
  if (products.length === 0) return 0;

  const requiredFields = [
    "name",
    "price",
    "productUrl",
    "imageUrl",
    "currency",
  ];
  const optionalFields = [
    "brand",
    "rating",
    "reviewsCount",
    "seller",
    "availability",
  ];
  const allFields = [...requiredFields, ...optionalFields];

  let totalFill = 0;
  const totalCells = products.length * allFields.length;

  for (const product of products) {
    for (const field of allFields) {
      const val = product[field as keyof Product];
      if (
        val !== undefined && val !== null && val !== "" && val !== "Unknown"
      ) {
        totalFill++;
      }
    }
  }

  return totalCells > 0 ? Math.round((totalFill / totalCells) * 100) / 100 : 0;
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
