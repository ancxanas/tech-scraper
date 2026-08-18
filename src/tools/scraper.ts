import { bdFetch, pollUntil } from "../lib/brightdata.ts";
import { type Platform, PLATFORMS } from "../config.ts";
import type { Product } from "../types.ts";

interface TriggerBatchResponse {
  collection_id: string;
  start_eta?: string;
}

interface ResultItem {
  product_name?: string;
  price?: { value: number; currency: string } | number;
  original_price?: { value: number; currency: string } | number;
  discount_percentage?: string;
  brand?: string;
  availability?: string;
  image_url?: string;
  product_url?: string;
  product_page_url?: string;
  rating?: string;
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

  const collectionId = triggerRes.collection_id;

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
    .filter((item) => !item.error && item.product_name)
    .map((item) => {
      const price = extractNumber(item.price);
      const originalPrice = extractNumber(item.original_price);
      const discount = parseDiscount(item.discount_percentage);

      return {
        name: item.product_name || "Unknown",
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
