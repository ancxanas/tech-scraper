import { SCORE_WEIGHTS } from "./config.ts";
import type { Product } from "./types.ts";

const MIN_RELEVANCE = 0.5;

const ACCESSORY_KEYWORDS = [
  "case",
  "cover",
  "charger",
  "cable",
  "adapter",
  "protector",
  "guard",
  "strap",
  "stand",
  "holder",
  "mount",
  "pouch",
  "sleeve",
  "skin",
  "sticker",
  "decal",
  "tempered",
  "film",
  "armband",
  "holster",
];

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

export interface RankOptions {
  dedupCheapest?: boolean;
  inStockOnly?: boolean;
  query?: string;
}

export function scoreAndRank(
  products: Product[],
  query = "",
  options: RankOptions = {},
): ScoredProduct[] {
  let valid = products.filter((p) => p.price > 0);

  if (options.inStockOnly) {
    valid = valid.filter(
      (p) => !p.availability || !p.availability.toLowerCase().includes("out"),
    );
  }

  if (valid.length === 0) return [];

  if (options.dedupCheapest) {
    valid = deduplicateCheapest(valid);
  }

  const queryTokens = tokenize(query);
  const queryHasAccessory = ACCESSORY_KEYWORDS.some((kw) =>
    query.toLowerCase().includes(kw)
  );

  const prices = valid.map((p) => p.price);
  const discounts = valid.map((p) => p.discount);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const maxDiscount = Math.max(...discounts);

  return valid
    .map((p) => {
      const rel = relevanceScore(p, queryTokens);

      if (queryTokens.length > 0 && rel < MIN_RELEVANCE) return null;

      const nameLower = p.name.toLowerCase();
      const isAccessory = ACCESSORY_KEYWORDS.some((kw) =>
        nameLower.includes(kw)
      );
      const productTokens = tokenize(p.name);
      const isShortName = productTokens.length <= 3;
      if (isAccessory && isShortName && rel < 0.8 && !queryHasAccessory) {
        return null;
      }

      const priceScore = maxPrice === minPrice
        ? 1
        : 1 - (p.price - minPrice) / (maxPrice - minPrice);

      const discountScore = maxDiscount === 0 ? 0 : p.discount / maxDiscount;

      const ratingScore = p.rating ? p.rating / 5 : 0.5;

      const inStockBonus =
        p.availability && !p.availability.toLowerCase().includes("out")
          ? SCORE_WEIGHTS.availability
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
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b.score - a.score);
}

function deduplicateCheapest(products: Product[]): Product[] {
  const seen = new Map<string, Product>();
  for (const p of products) {
    const key = normalize(p.name);
    const existing = seen.get(key);
    if (!existing || p.price < existing.price) {
      seen.set(key, p);
    }
  }
  return Array.from(seen.values());
}

function canonicalKey(p: Product): string {
  if (p.id) return p.id;
  if (p.productUrl) return normalize(p.productUrl);
  return normalize(p.name);
}

export function deduplicate(products: Product[]): Product[] {
  const seen = new Map<string, Product>();
  for (const p of products) {
    const key = canonicalKey(p);
    const existing = seen.get(key);
    if (!existing || p.price < existing.price) {
      seen.set(key, p);
    }
  }
  return Array.from(seen.values());
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
