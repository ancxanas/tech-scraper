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

  const productNames = products.map((p) => p.name);
  const searchKey = ["searches", query, timestamp];
  await kv.set(searchKey, {
    query,
    timestamp,
    productCount: products.length,
    productNames,
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

export async function getHistoryByQuery(
  query: string,
): Promise<{ query: string; products: PriceRecord[] }[]> {
  const kv = await getKv();
  const results: { query: string; products: PriceRecord[] }[] = [];

  const allPrices: PriceRecord[] = [];
  for await (const entry of kv.list({ prefix: ["prices"] })) {
    if (entry.value) {
      allPrices.push(entry.value as PriceRecord);
    }
  }

  for await (const entry of kv.list({ prefix: ["searches", query] })) {
    if (entry.value) {
      const search = entry.value as {
        query: string;
        timestamp: string;
        productNames?: string[];
      };
      const products: PriceRecord[] = [];
      if (search.productNames) {
        const nameSet = new Set(search.productNames.map((n) => normalize(n)));
        for (const record of allPrices) {
          if (nameSet.has(normalize(record.name))) {
            products.push(record);
          }
        }
      }
      results.push({ query: search.query, products });
    }
  }

  return results;
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
