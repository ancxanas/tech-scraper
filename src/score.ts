import { SCORE_WEIGHTS } from "./config.ts";
import type { Product } from "./types.ts";

export interface ScoredProduct extends Product {
  score: number;
}

export function scoreAndRank(products: Product[]): ScoredProduct[] {
  if (products.length === 0) return [];

  const prices = products.map((p) => p.price);
  const discounts = products.map((p) => p.discount);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const maxDiscount = Math.max(...discounts);

  return products
    .map((p) => {
      const priceScore = maxPrice === minPrice
        ? 1
        : 1 - (p.price - minPrice) / (maxPrice - minPrice);

      const discountScore = maxDiscount === 0 ? 0 : p.discount / maxDiscount;

      const ratingScore = p.rating ? p.rating / 5 : 0.5;

      const reviewScore = 0.5;

      const score = priceScore * SCORE_WEIGHTS.price +
        discountScore * SCORE_WEIGHTS.discount +
        ratingScore * SCORE_WEIGHTS.rating +
        reviewScore * SCORE_WEIGHTS.reviews;

      return { ...p, score: Math.round(score * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score);
}

export function deduplicate(products: Product[]): Product[] {
  const seen = new Map<string, Product>();
  for (const p of products) {
    const key = p.name.toLowerCase().replace(/\s+/g, " ").trim();
    const existing = seen.get(key);
    if (!existing || p.price < existing.price) {
      seen.set(key, p);
    }
  }
  return Array.from(seen.values());
}
