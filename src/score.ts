import { SCORE_WEIGHTS } from "./config.ts";
import type { Product } from "./types.ts";
import {
  ACCESSORY_KEYWORDS,
  ALL_BRANDS,
  BRAND_ALIASES,
  normalize,
} from "./lib/catalog.ts";

const MIN_RELEVANCE = 0.5;

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
  const nameLower = product.name.toLowerCase();
  let matched = 0;
  for (const qt of queryTokens) {
    if (nameTokens.has(qt)) {
      matched++;
    } else if (qt.length >= 3 && nameLower.includes(qt)) {
      matched++;
    }
  }
  return matched / queryTokens.length;
}

function extractModelFamily(name: string): string | null {
  const lower = name.toLowerCase();

  const headphones = [
    "wh-1000xm5",
    "wh-1000xm4",
    "wh-1000xm3",
    "wh-ch720n",
    "wh-ch520",
    "wf-1000xm5",
    "wf-1000xm4",
    "wf-c500",
    "wf-c700n",
    "wf-c510",
    "wf-c710n",
    "hd 450bt",
    "hd 560s",
    "qc45",
    "quietcomfort 45",
    "quietcomfort ultra",
    "airpods max",
  ];
  for (const f of headphones) {
    if (lower.includes(f)) return f;
  }

  if (/\bwh\b/.test(lower)) return "wh";
  if (/\bwf\b/.test(lower)) return "wf";
  if (/\bairpods?\b/.test(lower)) return "airpods";

  const phoneModelMatch = lower.match(
    /\b(samsung\s+galaxy\s+\w+(?:\s+\w+)?|redmi\s+note\s+\d+\w*|poco\s+\w+|realme\s+\w+(?:\s+\d+)?|oneplus\s+\w+(?:\s+\d+)?|pixel\s+\d+\w*|iphone\s+\d+\w*|iqoo\s+\w+(?:\s+\d+)?|vivo\s+\w+(?:\s+\d+)?|oppo\s+\w+(?:\s+\d+)?|nokia\s+\w+(?:\s+\d+)?|motorola\s+\w+(?:\s+\d+)?|nothing\s+phone\s+\w+|galaxy\s+s\d+\w*|galaxy\s+a\d+\w*|galaxy\s+m\d+\w*|galaxy\s+z\d+\w*)/,
  );
  if (phoneModelMatch) return phoneModelMatch[1].trim();

  return null;
}

function extractQueryBrand(query: string): string | null {
  const lower = query.toLowerCase();
  for (const b of ALL_BRANDS) {
    if (lower.includes(b)) return b;
  }
  return null;
}

export interface RankOptions {
  dedupCheapest?: boolean;
  inStockOnly?: boolean;
  query?: string;
  category?: string;
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
  const queryBrand = extractQueryBrand(query);
  const queryModelFamily = extractModelFamily(query);
  const prices = valid.map((p) => p.price);
  const discounts = valid.map((p) => p.discount);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const maxDiscount = Math.max(...discounts);
  const medianPrice = [...prices].sort((a, b) => a - b)[
    Math.floor(prices.length / 2)
  ];
  const maxReviewCount = Math.max(
    ...valid.map((p) => p.reviewsCount || 0),
    1,
  );

  return valid
    .map((p) => {
      const rel = relevanceScore(p, queryTokens);
      const hasSpecificQuery = queryBrand || queryModelFamily;
      if (hasSpecificQuery && rel < MIN_RELEVANCE) {
        return null;
      }

      const nameLower = p.name.toLowerCase();
      const isAccessory = ACCESSORY_KEYWORDS.some((kw) =>
        nameLower.includes(kw)
      );
      if (isAccessory && !queryHasAccessory) return null;

      const isThirdParty =
        /\bfor\s+(sony|samsung|apple|oneplus|xiaomi|jbl|bose|marshall|boat|noise|realme|poco|redmi|iqoo|vivo|oppo)\b/i
          .test(p.name);
      if (isThirdParty && !queryHasAccessory) return null;

      if (options.category === "phone") {
        const nonPhonePatterns =
          /\b(headphone|earphone|earbuds?|wireless earbuds?|tws|bluetooth (?:in )?ear|on.ear|over.ear|headset|speaker|powerbank|power bank|smartwatch|smart watch|tablet|laptop|charger|cable|case|cover|guard|strap|pouch|mount|adapter|pen|stylus|keyboard|mouse|hub|dock|cable)\b/i;
        if (nonPhonePatterns.test(nameLower)) return null;
      }

      if (queryBrand && p.brand) {
        const productBrand = p.brand.toLowerCase();
        const productBrandFamily = BRAND_ALIASES[productBrand] || productBrand;
        const queryBrandFamily = BRAND_ALIASES[queryBrand] || queryBrand;
        if (
          productBrandFamily !== queryBrandFamily &&
          ALL_BRANDS.includes(productBrand) &&
          ALL_BRANDS.includes(queryBrand)
        ) {
          return null;
        }
      }

      const exactModelMatch = queryModelFamily &&
        extractModelFamily(p.name) === queryModelFamily;
      if (
        !exactModelMatch &&
        !queryBrand &&
        medianPrice > 0 &&
        maxPrice / minPrice < 5 &&
        p.price > medianPrice * 3
      ) {
        return null;
      }

      const priceScore = maxPrice === minPrice
        ? 1
        : 1 - (p.price - minPrice) / (maxPrice - minPrice);

      const discountScore = maxDiscount === 0 ? 0 : p.discount / maxDiscount;

      const ratingScore = p.rating ? p.rating / 5 : 0.5;

      const reviewScore = p.reviewsCount
        ? Math.min(p.reviewsCount / maxReviewCount, 1)
        : 0.3;

      const inStockBonus =
        p.availability && !p.availability.toLowerCase().includes("out")
          ? SCORE_WEIGHTS.availability
          : 0;

      let rawScore = priceScore * SCORE_WEIGHTS.price +
        discountScore * SCORE_WEIGHTS.discount +
        ratingScore * SCORE_WEIGHTS.rating +
        inStockBonus +
        reviewScore * SCORE_WEIGHTS.reviews;

      if (queryModelFamily && extractModelFamily(p.name) === queryModelFamily) {
        rawScore += SCORE_WEIGHTS.modelFamilyBonus;
      } else if (queryModelFamily && extractModelFamily(p.name)) {
        rawScore -= SCORE_WEIGHTS.modelFamilyPenalty;
      }

      if (queryBrand) {
        const productBrand = p.brand?.toLowerCase() || "";
        if (productBrand === queryBrand) {
          rawScore += SCORE_WEIGHTS.brandMatchBonus;
        } else if (
          BRAND_ALIASES[productBrand] === BRAND_ALIASES[queryBrand]
        ) {
          rawScore += SCORE_WEIGHTS.brandMatchBonus * 0.5;
        }
      }

      const score = Math.round(rawScore * rel * 100) / 100;

      const reasons: string[] = [];
      if (rel >= 0.8) reasons.push("matches query");
      if (p.price === minPrice) reasons.push("lowest price");
      if (p.discount > 0) reasons.push(`${p.discount}% off`);
      if (p.rating && p.rating >= 4) reasons.push(`${p.rating}\u2605`);
      if (p.reviewsCount && p.reviewsCount > 1000) {
        reasons.push(`${Math.round(p.reviewsCount / 1000)}k reviews`);
      }
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
