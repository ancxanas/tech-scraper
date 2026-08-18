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
  price?: { value: number | string; currency: string } | number | string;
  selling_price?: { value: number | string; currency: string } | number | string;
  original_price?: { value: number | string; currency: string } | number | string;
  discount_percentage?: string;
  brand?: string;
  seller?: string;
  availability?: string;
  image_url?: string;
  product_url?: string;
  product_page_url?: string;
  rating?: string | number;
  review_count?: number;
  num_ratings?: number;
  error?: string;
}

export async function runCollector(
  collectorId: string,
  urls: string[],
): Promise<ResultItem[]> {
  const body = urls.map((url) => ({ url }));

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
  return raw
    .filter((item) => !item.error && (item.product_name || item.product_title))
    .map((item) => {
      const price = extractNumber(item.selling_price || item.price);
      const originalPrice = extractNumber(item.original_price);
      const discount = parseDiscount(item.discount_percentage);
      const name = item.product_name || item.product_title || "Unknown";

      return {
        name: name.replace(/\.\.\. more$/, "").trim(),
        price,
        originalPrice: originalPrice || price,
        discount,
        brand: item.brand || "",
        availability: item.availability || "Unknown",
        imageUrl: item.image_url || "",
        productUrl: item.product_url || item.product_page_url || "",
        platform: PLATFORMS[platform].name,
        rating: parseRating(item.rating),
      };
    })
    .filter((p) => p.price > 0);
}

function extractNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseInrString(val);
  if (typeof val === "object" && val !== null && "value" in val) {
    const obj = val as Record<string, unknown>;
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
