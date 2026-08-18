import type { Product } from "./types.ts";

interface PriceRecord {
  name: string;
  price: number;
  originalPrice: number;
  discount: number;
  platform: string;
  timestamp: string;
}

let kvInstance: Deno.Kv | null = null;

async function getKv(): Promise<Deno.Kv> {
  if (!kvInstance) {
    kvInstance = await Deno.openKv();
  }
  return kvInstance;
}

export async function savePrices(
  products: Product[],
  query: string,
): Promise<void> {
  const kv = await getKv();
  const timestamp = new Date().toISOString();

  for (const product of products) {
    const key = ["prices", normalize(product.name), timestamp];
    const value: PriceRecord = {
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      platform: product.platform,
      timestamp,
    };
    await kv.set(key, value);
  }

  const searchKey = ["searches", query, timestamp];
  await kv.set(searchKey, {
    query,
    timestamp,
    productCount: products.length,
  });
}

export async function getPriceHistory(
  productName: string,
): Promise<PriceRecord[]> {
  const kv = await getKv();
  const records: PriceRecord[] = [];
  const prefix = ["prices", normalize(productName)];

  for await (const entry of kv.list({ prefix })) {
    if (entry.value) {
      records.push(entry.value as PriceRecord);
    }
  }

  return records.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export async function getTrackedProducts(): Promise<string[]> {
  const kv = await getKv();
  const names = new Set<string>();

  for await (const entry of kv.list({ prefix: ["prices"] })) {
    if (entry.value) {
      const record = entry.value as PriceRecord;
      names.add(record.name);
    }
  }

  return Array.from(names).sort();
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}
