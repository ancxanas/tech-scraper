import { bdFetch, pollUntil } from "./brightdata.ts";
import { extractBrandFromName } from "./catalog.ts";

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
  seller?: string;
}

interface TriggerResponse {
  snapshot_id?: string;
  collection_id?: string;
}

interface ProgressResponse {
  status: string;
  data?: unknown[];
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
    console.error(
      `  Amazon trigger returned no snapshot_id: ${JSON.stringify(triggerRes)}`,
    );
    throw new Error("No snapshot_id returned from Amazon scraper");
  }
  console.error(`  Amazon trigger snapshot_id: ${snapshotId}`);

  await pollUntil<ProgressResponse>(
    async () => {
      try {
        const data = await bdFetch<ProgressResponse>(
          `/datasets/v3/progress/${snapshotId}`,
        );
        if (data.status === "ready" || data.status === "done") return data;
        if (data.status === "failed") {
          throw new Error("Amazon scraper failed");
        }
        return null;
      } catch {
        return null;
      }
    },
    15000,
    40,
    "Amazon scraper",
  );

  const snapshotData = await bdFetch<unknown[]>(
    `/datasets/v3/snapshot/${snapshotId}`,
  );

  if (!Array.isArray(snapshotData)) {
    console.error(
      `  Amazon snapshot returned non-array: ${typeof snapshotData}`,
    );
    const obj = snapshotData as Record<string, unknown>;
    console.error(
      `  Amazon snapshot keys: ${obj ? Object.keys(obj).join(", ") : "null"}`,
    );
    for (const [k, v] of Object.entries(obj)) {
      const vtype = Array.isArray(v) ? `array(${v.length})` : typeof v;
      console.error(`    ${k}: ${vtype}`);
    }
    return [];
  }

  console.error(`  Amazon snapshot returned ${snapshotData.length} items`);
  return snapshotData.map((item) =>
    parseAmazonItem(item as Record<string, unknown>)
  );
}

function parseAmazonItem(item: Record<string, unknown>): PreScraperResult {
  const price = Number(
    item.final_price || item.price || item.current_price || 0,
  );
  const originalPrice = Number(item.initial_price || item.mrp || 0);
  const discount = originalPrice > 0 && price > 0
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : 0;

  const name = String(
    item.name || item.title || item.product_name || "Unknown",
  );
  const brand = String(item.brand || "") || extractBrandFromName(name);

  return {
    title: name,
    price,
    originalPrice,
    discount,
    currency: String(item.currency || "INR"),
    rating: typeof item.rating === "number" && item.rating > 0
      ? item.rating
      : null,
    reviewsCount:
      (typeof item.reviews_count === "number" && item.reviews_count > 0)
        ? item.reviews_count
        : (typeof item.num_ratings === "number" && item.num_ratings > 0)
        ? item.num_ratings
        : null,
    brand,
    availability: item.availability
      ? String(item.availability)
      : item.in_stock === false
      ? "Out of Stock"
      : "Unknown",
    imageUrl: String(item.image || item.main_image || item.image_url || ""),
    url: String(item.url || ""),
    asin: String(item.asin || ""),
    seller: String(item.seller_name || item.seller || ""),
  };
}
