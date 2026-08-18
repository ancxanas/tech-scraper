import { SCORE_WEIGHTS } from "./config.ts";
import type { Product } from "./types.ts";

export interface ScoredProduct extends Product {
  score: number;
  reason: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function relevanceScore(product: Product, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 1;
  const nameTokens = new Set(tokenize(product.name));
  let matched = 0;
  for (const qt of queryTokens) {
    for (const nt of nameTokens) {
      if (nt.includes(qt) || qt.includes(nt)) {
        matched++;
        break;
      }
    }
  }
  return matched / queryTokens.length;
}

export function scoreAndRank(
  products: Product[],
  query = "",
): ScoredProduct[] {
  if (products.length === 0) return [];

  const queryTokens = tokenize(query);

  const inStock = products.filter(
    (p) => !p.availability || !p.availability.toLowerCase().includes("out"),
  );
  const targets = inStock.length > 0 ? inStock : products;

  const prices = targets.map((p) => p.price);
  const discounts = targets.map((p) => p.discount);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const maxDiscount = Math.max(...discounts);

  return targets
    .map((p) => {
      const rel = relevanceScore(p, queryTokens);

      const priceScore = maxPrice === minPrice
        ? 1
        : 1 - (p.price - minPrice) / (maxPrice - minPrice);

      const discountScore = maxDiscount === 0 ? 0 : p.discount / maxDiscount;

      const ratingScore = p.rating ? p.rating / 5 : 0.5;

      const inStockBonus =
        p.availability && !p.availability.toLowerCase().includes("out")
          ? 0.05
          : 0;

      const rawScore = priceScore * SCORE_WEIGHTS.price +
        discountScore * SCORE_WEIGHTS.discount +
        ratingScore * SCORE_WEIGHTS.rating +
        inStockBonus;

      const score = Math.round(rawScore * rel * 100) / 100;

      const reasons: string[] = [];
      if (rel >= 0.8) reasons.push("matches query");
      if (p.price === minPrice) reasons.push("lowest price");
      if (p.discount > 0) reasons.push(`${p.discount}% off`);
      if (p.rating && p.rating >= 4) reasons.push(`${p.rating}\u2605`);
      if (
        p.availability && !p.availability.toLowerCase().includes("out")
      ) {
        reasons.push("in stock");
      }
      const reason = reasons.length > 0
        ? reasons.slice(0, 3).join(" + ")
        : "best value";

      return {
        ...p,
        score,
        reason,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function extractBrandModel(name: string): string {
  const lower = name.toLowerCase();
  const cleaned = lower
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(
      /\b(black|white|blue|red|green|silver|grey|gray|gold|pink|purple|navy|midnight|starlight|natural|matte|glossy|wireless|wired|bluetooth|with|and|the|for|in|on|of)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ");
  if (words.length >= 2) {
    return words.slice(0, 3).join(" ");
  }
  return cleaned;
}

export function deduplicate(products: Product[]): Product[] {
  const seen = new Map<string, Product>();
  for (const p of products) {
    const key = extractBrandModel(p.name);
    const existing = seen.get(key);
    if (!existing || p.price < existing.price) {
      seen.set(key, p);
    }
  }
  return Array.from(seen.values());
}
