import { colors } from "@cliffy/ansi/colors";
import { type Platform, PLATFORMS } from "./config.ts";
import {
  type CollectorInput,
  parseCustomProducts,
  runCollector,
} from "./tools/scraper.ts";
import { searchAmazonPreBuilt } from "./lib/prescrapers.ts";
import { runHealFlow } from "./tools/healer.ts";
import { fetchPageMarkdown } from "./lib/unlock.ts";
import type { ParsedIntent, Product, SearchResult } from "./types.ts";
import { hashCode } from "./lib/catalog.ts";

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
  intent?: ParsedIntent,
): Promise<SearchResult[]> {
  const enabled = platforms.filter((p) => PLATFORMS[p].enabled);

  const scrapePromises = enabled.map((platform) =>
    scrapePlatform(platform, query, options, intent)
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
  intent?: ParsedIntent,
): Promise<SearchResult> {
  const config = PLATFORMS[platform];
  console.error(`  Scraping ${config.name}...`);

  let products: Product[] = [];
  let rawCount = 0;
  let healAttempted = false;
  let healSuccess = false;
  let lastError = "";

  if (config.tool === "prebuilt") {
    const result = await scrapePreBuilt(platform, query, options.pages, intent);
    products = result.products;
    rawCount = result.rawCount;
    lastError = result.error;
  } else {
    const result = await scrapeScraperStudio(platform, query, options, intent);
    products = result.products;
    rawCount = result.rawCount;
    healAttempted = result.healAttempted;
    healSuccess = result.healSuccess;
    lastError = result.error;
  }

  const fieldFillRate = calcFieldFillRate(products);
  const status = products.length > 0 ? "ok" : lastError ? "error" : "empty";

  if (status === "error" && lastError) {
    console.error(
      colors.red(`  ${config.name}: ${lastError}`),
    );
  }
  const statusColor = status === "error" ? colors.red : colors.green;
  console.error(
    statusColor(`  ${config.name}: ${products.length} products (${status})`),
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
  intent?: ParsedIntent,
): Promise<{ products: Product[]; rawCount: number; error: string }> {
  try {
    let searchQuery = query;
    if (intent) {
      const parts: string[] = [query];
      if (intent.brand) parts.unshift(intent.brand);
      if (intent.budget && intent.budgetOperator === "under") {
        parts.push(`under ${intent.budget}`);
      }
      searchQuery = parts.join(" ");
    }

    const now = new Date().toISOString();
    const items = await searchAmazonPreBuilt(searchQuery, pages);
    const rawCount = items.length;
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
  intent?: ParsedIntent,
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

      const inputs = buildCollectorInputs(
        platform,
        query,
        options.pages,
        intent,
      );
      const raw = await runCollector(collectorId, inputs);
      const rawCount = raw.length;
      if (rawCount > 0) {
        const first = raw[0] as Record<string, unknown>;
        const name = String(
          first.product_name || first.product_title || first.name ||
            first.title || "?",
        ).slice(0, 50);
        const price = first.selling_price || first.final_price || first.price ||
          "?";
        console.error(
          `    ${config.name}: got ${rawCount} raw items, first: "${name}" price=${price}`,
        );
      } else {
        console.error(`    ${config.name}: got 0 raw items from DCA`);
      }
      const products = parseCustomProducts(raw, platform, undefined, query);

      if (rawCount > 0 && products.length === 0) {
        console.error(
          `    ${config.name}: ${rawCount} raw items parsed to 0 products — checking first item:`,
        );
        const first = raw[0] as Record<string, unknown>;
        const debugKeys = [
          "product_name",
          "product_title",
          "name",
          "title",
          "selling_price",
          "final_price",
          "price",
          "error",
        ];
        for (const k of debugKeys) {
          if (first[k] !== undefined) {
            console.error(
              `      ${k}: ${JSON.stringify(first[k]).slice(0, 80)}`,
            );
          }
        }
      }

      const enriched = options.enrichCount > 0
        ? await enrichProducts(products, options.enrichCount)
        : products;

      if (enriched.length > 0) {
        return {
          products: enriched,
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
        intent,
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
      const isTransient = msg.includes("rate limit") ||
        msg.includes("503") ||
        msg.includes("502") ||
        msg.includes("network") ||
        msg.includes("ECONNRESET");
      if (isTransient && attempt < MAX_RETRIES) {
        const backoff = 3000 * Math.pow(2, attempt);
        console.error(
          colors.yellow(
            `  Transient error on ${config.name}, retrying in ${
              backoff / 1000
            }s...`,
          ),
        );
        await delay(backoff);
        continue;
      }
      lastError = msg;
      break;
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
  intent?: ParsedIntent,
): Promise<{ products: Product[]; rawCount: number; error: string }> {
  console.error(colors.yellow(`  Auto-healing ${platformName} scraper...`));

  try {
    const inputs = buildCollectorInputs(platform, query, options.pages, intent);
    const customInput = inputs.map((input) => {
      if (input.url) return { url: input.url, country: input.country || "in" };
      if (input.keyword) {
        return { keyword: input.keyword, country: input.country || "in" };
      }
      return { url: "", country: "in" };
    });

    const healResult = await runHealFlow(
      collectorId,
      "The scraper returns empty results or missing price/name fields. Fix selectors to capture product title, price, original price, discount, rating, reviews, brand, image URL, and product URL from the page.",
      true,
      customInput,
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
    const retryInputs = buildCollectorInputs(
      platform,
      query,
      options.pages,
      intent,
    );
    const raw = await runCollector(collectorId, retryInputs);
    const products = parseCustomProducts(raw, platform, undefined, query);
    return { products, rawCount: raw.length, error: "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(colors.red(`  Auto-heal failed: ${msg}`));
    return { products: [], rawCount: 0, error: msg };
  }
}

function buildFlipkartUrl(
  query: string,
  page: number,
  intent?: ParsedIntent,
): string {
  const encoded = encodeURIComponent(query);
  const params: string[] = [`q=${encoded}`, `page=${String(page)}`];

  if (intent) {
    if (intent.budget && intent.budgetOperator === "under") {
      params.push(
        `p%5B%5D=facets.price_range.from%3DMin`,
        `p%5B%5D=facets.price_range.to%3D${intent.budget}`,
      );
    }

    if (intent.brand) {
      const brandParam = encodeURIComponent(
        `facets.brand[]=${
          intent.brand.charAt(0).toUpperCase() + intent.brand.slice(1)
        }`,
      );
      params.push(`p%5B%5D=${brandParam}`);
    }

    if (
      intent.superlative === "cheapest" ||
      intent.superlative === "most affordable"
    ) {
      params.push("sort=price_asc");
    } else if (intent.superlative === "premium") {
      params.push("sort=price_desc");
    }
  }

  return `https://www.flipkart.com/search?${params.join("&")}`;
}

function buildAmazonUrl(
  query: string,
  page: number,
  intent?: ParsedIntent,
): string {
  const encoded = encodeURIComponent(query);
  const params: string[] = [`k=${encoded}`, `page=${String(page)}`];

  if (intent) {
    if (intent.budget && intent.budgetOperator === "under") {
      params.push(`low-price=0`, `high-price=${intent.budget}`);
    }

    if (
      intent.superlative === "cheapest" ||
      intent.superlative === "most affordable"
    ) {
      params.push("s=price-asc-rank");
    } else if (intent.superlative === "premium") {
      params.push("s=price-desc-rank");
    }
  }

  return `https://www.amazon.in/s?${params.join("&")}`;
}

function buildTataCliqUrl(query: string, intent?: ParsedIntent): string {
  const encoded = encodeURIComponent(query);
  const params: string[] = [`searchCategory=all`];

  const categoryCode = intent?.category === "phone" ? "MSH1210" : undefined;
  const textValue = categoryCode
    ? `${encoded}:relevance:category:${categoryCode}`
    : encoded;
  params.push(`text=${encodeURIComponent(textValue)}`);

  if (intent) {
    if (intent.budget && intent.budgetOperator === "under") {
      params.push(
        `p%5B%5D=facets.price_range.from%3DMin`,
        `p%5B%5D=facets.price_range.to%3D${intent.budget}`,
      );
    }

    if (intent.brand) {
      const brandParam = encodeURIComponent(`facets.brand=${intent.brand}`);
      params.push(`p%5B%5D=${brandParam}`);
    }

    if (
      intent.superlative === "cheapest" ||
      intent.superlative === "most affordable"
    ) {
      params.push("sortby=price_low_to_high");
    } else if (intent.superlative === "premium") {
      params.push("sortby=price_high_to_low");
    }
  }

  return `https://www.tatacliq.com/search/?${params.join("&")}`;
}

function buildRelianceUrl(query: string, intent?: ParsedIntent): string {
  if (intent?.category === "phone") {
    return "https://www.reliancedigital.in/collection/smartphones";
  }
  const encoded = encodeURIComponent(query);
  return `https://www.reliancedigital.in/products?q=${encoded}`;
}

function buildCollectorInputs(
  platform: Platform,
  query: string,
  pages: number,
  intent?: ParsedIntent,
): CollectorInput[] {
  const config = PLATFORMS[platform];
  const inputs: CollectorInput[] = [];

  if (config.pagination === "page") {
    for (let i = 0; i < pages; i++) {
      const pageNum = config.startIndex + i;
      let url: string;

      switch (platform) {
        case "flipkart":
          url = buildFlipkartUrl(query, pageNum, intent);
          break;
        case "amazon":
          url = buildAmazonUrl(query, pageNum, intent);
          break;
        case "tatacliq":
          url = buildTataCliqUrl(query, intent);
          break;
        case "reliance":
          url = buildRelianceUrl(query, intent);
          break;
        default:
          url = config.searchUrlTemplate
            .replace("{q}", encodeURIComponent(query))
            .replace("{page}", String(pageNum));
      }

      inputs.push({ url, country: "in" });
    }
  } else {
    let url: string;

    switch (platform) {
      case "flipkart":
        url = buildFlipkartUrl(query, config.startIndex, intent);
        break;
      case "tatacliq":
        url = buildTataCliqUrl(query, intent);
        break;
      case "reliance":
        url = buildRelianceUrl(query, intent);
        break;
      default:
        url = config.searchUrlTemplate.replace(
          "{q}",
          encodeURIComponent(query),
        );
    }

    inputs.push({ url, country: "in" });
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

async function enrichProducts(
  products: Product[],
  count: number,
): Promise<Product[]> {
  const hasZone = !!Deno.env.get("UNLOCKER_ZONE");
  if (!hasZone || products.length === 0) return products;

  const toEnrich = products
    .slice()
    .sort((a, b) => (a.listingPosition || 999) - (b.listingPosition || 999))
    .slice(0, Math.min(count, products.length));

  console.error(
    colors.dim(`  Enriching top ${toEnrich.length} products via PDP...`),
  );

  const enriched = new Map<string, Product>();
  for (const p of products) enriched.set(p.id, p);

  for (const product of toEnrich) {
    if (!product.productUrl) continue;
    try {
      const md = await fetchPageMarkdown(product.productUrl);
      if (!md) continue;

      const descMatch = md.match(
        /(?:description|about this item)[:\s]*\n([\s\S]{20,500}?)(?:\n\n|\n#|\n\*\*)/i,
      );
      if (descMatch && !product.description) {
        product.description = descMatch[1].trim().slice(0, 500);
      }

      const highlights: string[] = [];
      const bulletMatch = md.match(
        /(?:highlights|key features)[:\s]*\n([\s\S]{10,800}?)(?:\n\n|\n#)/i,
      );
      if (bulletMatch) {
        const lines = bulletMatch[1]
          .split("\n")
          .map((l) => l.replace(/^[\s•\-\*]+/, "").trim())
          .filter((l) => l.length > 5 && l.length < 200);
        highlights.push(...lines.slice(0, 8));
      }
      if (
        highlights.length > 0 &&
        (!product.highlights || product.highlights.length === 0)
      ) {
        product.highlights = highlights;
      }

      const specs: Record<string, string> = {};
      const specBlock = md.match(
        /(?:specifications|specs|technical details)[:\s]*\n([\s\S]{10,1000}?)(?:\n\n|\n#)/i,
      );
      if (specBlock) {
        const rows = specBlock[1].split("\n").filter((l) => l.includes(":"));
        for (const row of rows.slice(0, 20)) {
          const colonIdx = row.indexOf(":");
          const key = row.slice(0, colonIdx).trim();
          const val = row.slice(colonIdx + 1).trim();
          if (key && val && key.length < 50 && val.length < 200) {
            specs[key] = val;
          }
        }
      }
      if (
        Object.keys(specs).length > 0 &&
        (!product.specifications ||
          Object.keys(product.specifications).length === 0)
      ) {
        product.specifications = specs;
      }

      const warrantyMatch = md.match(
        /warranty[:\s]*([\w\s]{5,100}?)(?:\n|\.)/i,
      );
      if (warrantyMatch && !product.warranty) {
        product.warranty = warrantyMatch[1].trim();
      }

      product.enriched = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Enrichment failed for ${product.name}: ${msg}`);
    }
  }

  return Array.from(enriched.values());
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
