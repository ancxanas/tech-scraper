import { bdFetch, pollUntil } from "./brightdata.ts";

export interface PreScraperResult {
  title: string;
  price: number;
  originalPrice: number;
  discount: number;
  currency: string;
  rating: number | null;
  reviewsCount: number | null;
  brand: string;
  availability: string;
  imageUrl: string;
  url: string;
  asin?: string;
}

interface TriggerResponse {
  snapshot_id?: string;
  collection_id?: string;
}

interface AmazonSearchInput {
  keyword: string;
  url?: string;
  pages_to_search?: number;
}

const PRE_BUILT_SCRAPERS = {
  amazon: {
    name: "Amazon Products",
    datasetId: "gd_lwdb4vjm1ehb499uxs",
    searchUrl: "https://www.amazon.in",
  },
} as const;

export type PreBuiltPlatform = keyof typeof PRE_BUILT_SCRAPERS;

export function getAvailablePreScrapers(): Array<
  { id: string; name: string; datasetId: string }
> {
  return Object.entries(PRE_BUILT_SCRAPERS).map(([id, config]) => ({
    id,
    name: config.name,
    datasetId: config.datasetId,
  }));
}

export async function searchAmazonPreBuilt(
  keyword: string,
  pages = 3,
): Promise<PreScraperResult[]> {
  const config = PRE_BUILT_SCRAPERS.amazon;
  const input: AmazonSearchInput[] = [{
    keyword,
    url: config.searchUrl,
    pages_to_search: pages,
  }];

  const triggerRes = await bdFetch<TriggerResponse>(
    `/datasets/v3/trigger?dataset_id=${config.datasetId}&format=json`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

  const snapshotId = triggerRes.snapshot_id || triggerRes.collection_id;
  if (!snapshotId) {
    throw new Error("No snapshot_id returned from Amazon scraper");
  }

  const items = await pollUntil<Record<string, unknown>[]>(
    async () => {
      try {
        const data = await bdFetch<Record<string, unknown>[]>(
          `/datasets/v3/snapshot/${snapshotId}`,
        );
        if (Array.isArray(data) && data.length > 0) return data;
        return null;
      } catch {
        return null;
      }
    },
    15000,
    40,
    "Amazon scraper",
  );

  return items.map(parseAmazonItem);
}

function parseAmazonItem(item: Record<string, unknown>): PreScraperResult {
  const price = Number(
    item.final_price || item.price || item.current_price || 0,
  );
  const originalPrice = Number(item.initial_price || 0);
  const discount = originalPrice > 0 && price > 0
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : 0;

  return {
    title: String(item.name || item.title || item.product_name || "Unknown"),
    price,
    originalPrice,
    discount,
    currency: String(item.currency || "INR"),
    rating: typeof item.rating === "number" && item.rating > 0
      ? item.rating
      : null,
    reviewsCount: typeof item.num_ratings === "number"
      ? item.num_ratings
      : null,
    brand: String(item.brand || ""),
    availability: item.availability
      ? String(item.availability)
      : item.in_stock === false
      ? "Out of Stock"
      : "Unknown",
    imageUrl: String(item.image || item.main_image || item.image_url || ""),
    url: String(item.url || ""),
    asin: String(item.asin || ""),
  };
}
