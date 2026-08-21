import { bdFetch, pollUntil } from "../lib/brightdata.ts";
import { type Platform, PLATFORMS } from "../config.ts";
import type { Product } from "../types.ts";
import {
  ALL_BRANDS,
  extractBrandFromName,
  hashCode,
  normalizeName,
} from "../lib/catalog.ts";

interface TriggerBatchResponse {
  collection_id?: string;
  snapshot_id?: string;
  start_eta?: string;
}

interface ResultItem {
  product_name?: string;
  product_title?: string;
  name?: string;
  title?: string;
  price?: { value: number | string; currency: string } | number | string;
  selling_price?:
    | { value: number | string; currency: string }
    | number
    | string;
  final_price?: number | string;
  initial_price?: number | string;
  original_price?:
    | { value: number | string; currency: string }
    | number
    | string;
  mrp?: number | string;
  discount_percentage?: string;
  discount_text?: string;
  brand?: string;
  seller?: string;
  seller_name?: string;
  availability?: string;
  in_stock?: boolean;
  image_url?: string;
  image?: string;
  main_image?: string;
  product_url?: string;
  product_page_url?: string;
  url?: string;
  pid?: string;
  asin?: string;
  rating?: string | number;
  review_count?: number;
  reviews_count?: number;
  num_ratings?: number;
  offers?: string[];
  sponsored?: boolean;
  prime?: boolean;
  currency?: string;
  error?: string;
  [key: string]: unknown;
}

export interface CollectorInput {
  url?: string;
  keyword?: string;
  country?: string;
}

function filterByQuery(raw: ResultItem[], query: string): ResultItem[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const brandToken = tokens.find((t) => ALL_BRANDS.includes(t));

  return raw.filter((item) => {
    const name = (
      item.product_name || item.product_title || item.name || item.title || ""
    ).toLowerCase();

    if (!name || name.length < 3) return false;

    if (/compatible\s+with/i.test(name)) return false;

    if (brandToken && !name.includes(brandToken)) return false;

    return true;
  });
}

export async function runCollector(
  collectorId: string,
  inputs: CollectorInput[],
): Promise<ResultItem[]> {
  const body = inputs.map((input) => {
    if (input.url) return { url: input.url };
    if (input.keyword && input.country) {
      return { keyword: input.keyword, country: input.country };
    }
    return { url: "" };
  });

  const triggerRes = await bdFetch<TriggerBatchResponse>(
    `/dca/trigger?collector=${collectorId}&queue_next=1`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  const collectionId = triggerRes.collection_id || triggerRes.snapshot_id;

  if (!collectionId) {
    throw new Error("No collection_id or snapshot_id in trigger response");
  }

  let pollAttempt = 0;
  let consecutiveErrors = 0;
  const MAX_POLL_ERRORS = 3;
  const items = await pollUntil<ResultItem[]>(
    async () => {
      pollAttempt++;
      try {
        const data = await bdFetch<ResultItem[]>(
          `/dca/dataset?id=${collectionId}`,
        );
        consecutiveErrors = 0;
        if (Array.isArray(data) && data.length > 0) return data;
        if (
          data && typeof data === "object" && !Array.isArray(data)
        ) {
          const obj = data as Record<string, unknown>;
          if (obj.error || obj.status === "failed" || obj.status === "error") {
            throw new Error(
              `DCA collector error: ${JSON.stringify(data).slice(0, 200)}`,
            );
          }
          const wrapped = obj.products || obj.data || obj.results;
          if (Array.isArray(wrapped) && wrapped.length > 0) return wrapped;
        }
        if (pollAttempt <= 5) {
          let preview: string;
          if (Array.isArray(data)) {
            preview = `array(${data.length})`;
          } else if (data === null) {
            preview = "null";
          } else if (typeof data === "object") {
            const obj = data as Record<string, unknown>;
            const parts: string[] = [];
            for (const [k, v] of Object.entries(obj).slice(0, 5)) {
              const val = typeof v === "string"
                ? `"${v.slice(0, 60)}"`
                : Array.isArray(v)
                ? `array(${v.length})`
                : typeof v === "object" && v !== null
                ? `{...}`
                : String(v);
              parts.push(`${k}: ${val}`);
            }
            preview = `{${parts.join(", ")}}`;
          } else {
            preview = String(data);
          }
          console.error(
            `    ${
              collectorId.slice(0, 15)
            }: poll #${pollAttempt} → ${preview}`,
          );
        } else if (pollAttempt % 5 === 0) {
          console.error(
            `    ${
              collectorId.slice(0, 15)
            }: poll #${pollAttempt}... collecting`,
          );
        }
        return null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("DCA collector error")) throw err;
        consecutiveErrors++;
        console.error(
          `    ${
            collectorId.slice(0, 15)
          }: poll #${pollAttempt} error (${consecutiveErrors}/${MAX_POLL_ERRORS}): ${
            msg.slice(0, 120)
          }`,
        );
        if (consecutiveErrors >= MAX_POLL_ERRORS) {
          throw new Error(
            `${
              collectorId.slice(0, 15)
            }: ${consecutiveErrors} consecutive errors — ${msg.slice(0, 100)}`,
          );
        }
        return null;
      }
    },
    10000,
    48,
    `Scraper ${collectorId.slice(0, 15)}`,
  );

  return items;
}

export function parseCustomProducts(
  raw: ResultItem[],
  platform: Platform,
  pageNumber?: number,
  query?: string,
): Product[] {
  const now = new Date().toISOString();

  const filtered = query ? filterByQuery(raw, query) : raw;

  const seen = new Map<string, ResultItem>();
  const deduped: ResultItem[] = [];
  for (const item of filtered) {
    if (item.error) continue;
    const name = (item.product_name || item.product_title || item.name ||
      item.title || "").trim();
    if (!name) continue;
    const dedupKey = `${normalizeName(name)}:${
      extractNumber(item.selling_price || item.final_price || item.price)
    }`;
    if (seen.has(dedupKey)) continue;
    seen.set(dedupKey, item);
    deduped.push(item);
  }

  return deduped
    .map((item, index) => {
      const price = extractNumber(
        item.selling_price || item.final_price || item.price,
      );
      if (price <= 0) return null;

      const originalPrice = extractNumber(
        item.original_price || item.initial_price || item.mrp,
      );
      const discountFromPrices = originalPrice > 0 && price > 0
        ? Math.round(((originalPrice - price) / originalPrice) * 100)
        : 0;
      const discountFromText = parseDiscount(
        item.discount_percentage || item.discount_text,
      );
      const discount = discountFromPrices > 0
        ? discountFromPrices
        : discountFromText;
      const name =
        (item.product_name || item.product_title || item.name || item.title ||
          "Unknown")
          .replace(/\.\.\. more$/, "")
          .trim();
      const id = generateId(item, platform);
      const currency = item.currency || "INR";

      const productUrl = item.product_url || item.product_page_url ||
        item.url ||
        "";
      if (productUrl && !isValidUrl(productUrl)) return null;

      const imageUrl = item.image_url || item.image || item.main_image || "";
      if (imageUrl && !imageUrl.startsWith("http")) return null;

      const offers: string[] = [];
      if (Array.isArray(item.offers)) {
        offers.push(...item.offers.map(String));
      }

      const product: Product = {
        id,
        name,
        price,
        originalPrice: originalPrice || price,
        discount,
        currency,
        productUrl,
        imageUrl,
        platform: PLATFORMS[platform].name,
        scrapedAt: now,
        extras: collectExtras(item),
      };

      if (item.brand) {
        product.brand = String(item.brand);
      } else {
        const extracted = extractBrandFromName(name);
        if (extracted) product.brand = extracted;
      }
      let rating = parseRating(item.rating);
      if (rating !== undefined) {
        rating = Math.max(0, Math.min(5, rating));
        product.rating = rating;
      }
      const reviewsCount = parseReviewsCount(item);
      if (reviewsCount !== undefined) product.reviewsCount = reviewsCount;
      if (item.seller || item.seller_name) {
        product.seller = String(item.seller || item.seller_name);
      }
      if (item.availability) {
        const avail = String(item.availability).trim();
        const lower = avail.toLowerCase();
        if (
          lower.includes("out of stock") ||
          lower.includes("currently unavailable")
        ) {
          product.availability = "Out of Stock";
        } else if (
          lower.includes("in stock") ||
          lower.includes("available") ||
          lower.includes("usually ships") ||
          lower.includes("in stock.")
        ) {
          product.availability = "In Stock";
        } else if (
          lower.includes("pincode") ||
          lower.includes("enter") ||
          lower === "unknown" ||
          lower === ""
        ) {
          product.availability = "In Stock";
        } else {
          product.availability = avail;
        }
      } else if (item.in_stock === false) {
        product.availability = "Out of Stock";
      } else {
        product.availability = "In Stock";
      }
      if (item.sku || item.asin || item.pid) {
        product.sku = String(item.sku || item.asin || item.pid);
      }
      product.inStock = !product.availability.toLowerCase().includes(
        "out of stock",
      );
      if (offers.length > 0) product.offers = offers;
      if (index < 500) product.listingPosition = index + 1;
      if (pageNumber !== undefined) product.pageNumber = pageNumber;

      return product;
    })
    .filter((p): p is Product => p !== null && p.name !== "Unknown");
}

function generateId(item: ResultItem, platform: Platform): string {
  if (item.pid) return `${platform}:${item.pid}`;
  if (item.asin) return `${platform}:${item.asin}`;
  const url = item.product_url || item.product_page_url || item.url || "";
  if (url) {
    const match = url.match(/\/p\/(itm\w+)|\/dp\/(\w+)|\/product\/(\S+)/);
    if (match) return `${platform}:${match[1] || match[2] || match[3]}`;
    return `${platform}:${hashCode(url)}`;
  }
  const name = item.product_name || item.product_title || item.name ||
    item.title || "";
  return `${platform}:${hashCode(name + item.selling_price)}`;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function extractNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseInrString(val);
  if (typeof val === "object" && val !== null && "value" in val) {
    const obj = val as Record<string, unknown>;
    if (typeof obj.value === "number") return obj.value;
    if (typeof obj.value === "string") return parseInrString(obj.value);
    return Number(obj.value) || 0;
  }
  return 0;
}

function parseInrString(val: string): number {
  const cleaned = val.replace(/[₹,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseDiscount(val: string | undefined): number {
  if (!val) return 0;
  const match = val.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseRating(val: string | number | undefined): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number") return val > 0 ? val : undefined;
  if (val === "Share your opinion") return undefined;
  const match = val.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : undefined;
}

function parseReviewsCount(item: ResultItem): number | undefined {
  if (typeof item.reviews_count === "number" && item.reviews_count > 0) {
    return item.reviews_count;
  }
  if (typeof item.num_ratings === "number" && item.num_ratings > 0) {
    return item.num_ratings;
  }
  if (typeof item.review_count === "number" && item.review_count > 0) {
    return item.review_count;
  }
  return undefined;
}

const SKIP_FIELDS = new Set([
  "product_name",
  "product_title",
  "name",
  "title",
  "price",
  "selling_price",
  "final_price",
  "original_price",
  "initial_price",
  "mrp",
  "discount_percentage",
  "discount_text",
  "brand",
  "seller",
  "seller_name",
  "availability",
  "in_stock",
  "image_url",
  "image",
  "main_image",
  "product_url",
  "product_page_url",
  "url",
  "pid",
  "asin",
  "rating",
  "review_count",
  "reviews_count",
  "num_ratings",
  "offers",
  "sponsored",
  "prime",
  "currency",
  "error",
]);

function collectExtras(item: ResultItem): Record<string, unknown> | undefined {
  const extras: Record<string, unknown> = {};
  let hasExtras = false;
  for (const [key, value] of Object.entries(item)) {
    if (
      !SKIP_FIELDS.has(key) && value !== undefined && value !== null &&
      value !== ""
    ) {
      extras[key] = value;
      hasExtras = true;
    }
  }
  return hasExtras ? extras : undefined;
}
