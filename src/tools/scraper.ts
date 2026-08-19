import { bdFetch, pollUntil } from "../lib/brightdata.ts";
import { type Platform, PLATFORMS } from "../config.ts";
import type { Product } from "../types.ts";

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

  const items = await pollUntil<ResultItem[]>(
    async () => {
      try {
        const data = await bdFetch<ResultItem[]>(
          `/dca/dataset?id=${collectionId}`,
        );
        if (Array.isArray(data) && data.length > 0) return data;
        return null;
      } catch {
        return null;
      }
    },
    10000,
    40,
    `Scraper ${collectorId.slice(0, 15)}`,
  );

  return items;
}

export function parseCustomProducts(
  raw: ResultItem[],
  platform: Platform,
): Product[] {
  const now = new Date().toISOString();

  return raw
    .filter((item) =>
      !item.error &&
      (item.product_name || item.product_title || item.name || item.title)
    )
    .map((item, index) => {
      const price = extractNumber(
        item.selling_price || item.final_price || item.price,
      );
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
        productUrl: item.product_url || item.product_page_url || item.url || "",
        imageUrl: item.image_url || item.image || item.main_image || "",
        platform: PLATFORMS[platform].name,
        scrapedAt: now,
        extras: collectExtras(item),
      };

      if (item.brand) product.brand = String(item.brand);
      const rating = parseRating(item.rating);
      if (rating !== undefined) product.rating = rating;
      const reviewsCount = parseReviewsCount(item);
      if (reviewsCount !== undefined) product.reviewsCount = reviewsCount;
      if (item.seller || item.seller_name) {
        product.seller = String(item.seller || item.seller_name);
      }
      if (item.availability) {
        product.availability = String(item.availability);
      } else if (item.in_stock === false) {
        product.availability = "Out of Stock";
      } else {
        product.availability = "Unknown";
      }
      if (offers.length > 0) product.offers = offers;
      if (index < 500) product.listingPosition = index + 1;

      return product;
    })
    .filter((p) => p.name && (p.price > 0 || p.productUrl));
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

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
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
