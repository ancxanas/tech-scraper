import type { Product } from "./types.ts";

interface PriceRecord {
  name: string;
  price: number;
  originalPrice: number;
  discount: number;
  platform: string;
  query: string;
  timestamp: string;
}

let kvInstance: Deno.Kv | null = null;

async function getKv(): Promise<Deno.Kv> {
  if (!kvInstance) {
    kvInstance = await Deno.openKv();
  }
  return kvInstance;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function platformKey(platform: string): string {
  return normalize(platform).replace(/\s+/g, "-");
}

export async function savePrices(
  products: Product[],
  query: string,
): Promise<void> {
  const kv = await getKv();
  const timestamp = new Date().toISOString();

  for (const product of products) {
    const key = [
      "prices",
      platformKey(product.platform),
      normalize(query),
      normalize(product.name),
      timestamp,
    ];
    const value: PriceRecord = {
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice,
      discount: product.discount,
      platform: product.platform,
      query,
      timestamp,
    };
    await kv.set(key, value);
  }

  const productNames = products.map((p) => p.name);
  const searchKey = [
    "searches",
    normalize(query),
    timestamp,
  ];
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
  const prefix = ["prices"];

  for await (const entry of kv.list({ prefix })) {
    if (entry.value) {
      const record = entry.value as PriceRecord;
      if (normalize(record.name) === normalize(productName)) {
        records.push(record);
      }
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

  const queryProducts: PriceRecord[] = [];
  const prefix = ["prices"];

  for await (const entry of kv.list({ prefix })) {
    if (entry.value) {
      const record = entry.value as PriceRecord;
      if (normalize(record.query) === normalize(query)) {
        queryProducts.push(record);
      }
    }
  }

  if (queryProducts.length > 0) {
    results.push({ query, products: queryProducts });
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
