import { bdFetch, pollUntil } from "./brightdata.ts";

export interface PreScraperResult {
  title: string;
  price: number;
  currency: string;
  rating: number | null;
  reviewsCount: number | null;
  brand: string;
  availability: string;
  imageUrl: string;
  url: string;
  asin?: string;
}

interface AmazonSearchInput {
  keyword: string;
  url?: string;
  pages_to_search?: number;
}

interface TriggerResponse {
  snapshot_id?: string;
  collection_id?: string;
}

const PRE_BUILT_SCRAPERS = {
  amazon: {
    name: "Amazon Products",
    datasetId: "gd_lwdb4vjm1ehb499uxs",
    searchUrl: "https://www.amazon.in",
  },
  google_shopping: {
    name: "Google Shopping",
    datasetId: "gd_ltppk50q18kdw67omz",
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
    10000,
    30,
    "Amazon scraper",
  );

  return items.map(parseAmazonItem);
}

export async function searchGoogleShoppingPreBuilt(
  keyword: string,
): Promise<PreScraperResult[]> {
  const config = PRE_BUILT_SCRAPERS.google_shopping;

  const triggerRes = await bdFetch<TriggerResponse>(
    `/datasets/v3/trigger?dataset_id=${config.datasetId}&format=json`,
    {
      method: "POST",
      body: JSON.stringify([{ keyword }]),
    },
  );

  const snapshotId = triggerRes.snapshot_id || triggerRes.collection_id;
  if (!snapshotId) {
    throw new Error("No snapshot_id returned from Google Shopping scraper");
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
    10000,
    30,
    "Google Shopping scraper",
  );

  return items.map(parseGoogleShoppingItem);
}

function parseAmazonItem(item: Record<string, unknown>): PreScraperResult {
  return {
    title: String(item.title || item.product_name || "Unknown"),
    price: Number(item.price || item.current_price || 0),
    currency: String(item.currency || "INR"),
    rating: typeof item.rating === "number" ? item.rating : null,
    reviewsCount: typeof item.reviews_count === "number"
      ? item.reviews_count
      : null,
    brand: String(item.brand || ""),
    availability: String(item.availability || "Unknown"),
    imageUrl: String(item.main_image || item.image_url || ""),
    url: String(item.url || ""),
    asin: String(item.asin || ""),
  };
}

function parseGoogleShoppingItem(
  item: Record<string, unknown>,
): PreScraperResult {
  return {
    title: String(item.title || item.product_name || "Unknown"),
    price: Number(item.price || 0),
    currency: String(item.currency || "INR"),
    rating: typeof item.rating === "number" ? item.rating : null,
    reviewsCount: typeof item.reviews_count === "number"
      ? item.reviews_count
      : null,
    brand: String(item.brand || ""),
    availability: String(item.availability || "Unknown"),
    imageUrl: String(item.image || item.image_url || ""),
    url: String(item.url || item.link || ""),
  };
}
