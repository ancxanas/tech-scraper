import type { Product } from "./types.ts";

interface PriceRecord {
  name: string;
  price: number;
  originalPrice: number;
  discount: number;
  platform: string;
  timestamp: string;
}

interface PriceHistory {
  name: string;
  records: PriceRecord[];
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

export async function getSearchHistory(): Promise<
  { query: string; timestamp: string; productCount: number }[]
> {
  const kv = await getKv();
  const records: { query: string; timestamp: string; productCount: number }[] =
    [];

  for await (const entry of kv.list({ prefix: ["searches"] })) {
    if (entry.value) {
      records.push(
        entry.value as {
          query: string;
          timestamp: string;
          productCount: number;
        },
      );
    }
  }

  return records.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

export async function getAllProducts(): Promise<PriceRecord[]> {
  const kv = await getKv();
  const records: PriceRecord[] = [];

  for await (const entry of kv.list({ prefix: ["prices"] })) {
    if (entry.value) {
      records.push(entry.value as PriceRecord);
    }
  }

  return records;
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
