import type { ParsedIntent, Product, ProductCategory } from "../types.ts";
import {
  extractSpecs,
  getComparisonFields,
  type ProductSpecs,
} from "./specs.ts";
import { scoreAndRank } from "../score.ts";

export interface ComparisonResult {
  intent: ParsedIntent;
  category: ProductCategory;
  totalProducts: number;
  comparisons: ProductComparison[];
  recommendation: ProductComparison | null;
  specFields: string[];
}

export interface ProductComparison {
  product: Product;
  specs: ProductSpecs;
  score: number;
  reason: string;
  specValues: Record<string, string>;
  pricePerSpec: string;
}

export function compareProducts(
  intent: ParsedIntent,
  products: Product[],
): ComparisonResult {
  const category = intent.category !== "generic"
    ? intent.category
    : detectCategoryFromProducts(products);

  const scored = scoreAndRank(products, intent.rawQuery, {
    category: intent.category,
  });

  const comparisons: ProductComparison[] = scored.map((sp) => {
    const specs = extractSpecs(sp, category);

    const specValues: Record<string, string> = {};
    for (const [key, val] of Object.entries(specs.specs)) {
      specValues[key] = formatSpecValue(key, val);
    }

    const pricePerSpec = calculatePricePerSpec(sp, specs, category);

    return {
      product: sp,
      specs,
      score: sp.score,
      reason: sp.reason,
      specValues,
      pricePerSpec,
    };
  });

  const recommendation = comparisons.length > 0 ? comparisons[0] : null;
  const specFields = getComparisonFields(category);

  return {
    intent,
    category,
    totalProducts: products.length,
    comparisons,
    recommendation,
    specFields,
  };
}

function formatSpecValue(key: string, val: string | number): string {
  switch (key) {
    case "ram_gb":
    case "storage_gb":
      return `${val} GB`;
    case "battery_mah":
      return `${val} mAh`;
    case "camera_mp":
      return `${val} MP`;
    case "display_size":
      return `${val}"`;
    case "refresh_rate":
      return `${val} Hz`;
    case "driver_mm":
      return `${val} mm`;
    case "battery_hours":
      return `${val} hrs`;
    case "weight_g":
      return `${val} g`;
    case "is_5g":
      return val ? "Yes" : "No";
    default:
      return String(val);
  }
}

function calculatePricePerSpec(
  product: Product,
  specs: ProductSpecs,
  category: ProductCategory,
): string {
  if (product.price <= 0) return "N/A";

  switch (category) {
    case "phone": {
      const ram = specs.specs.ram_gb as number | undefined;
      const storage = specs.specs.storage_gb as number | undefined;
      if (ram && storage) {
        const perGb = Math.round(product.price / (ram + storage));
        return `\u20b9${perGb}/GB`;
      }
      if (storage) {
        const perGb = Math.round(product.price / storage);
        return `\u20b9${perGb}/GB`;
      }
      break;
    }
    case "headphone":
    case "earbuds": {
      const battery = specs.specs.battery_hours as number | undefined;
      if (battery) {
        const perHr = Math.round(product.price / battery);
        return `\u20b9${perHr}/hr`;
      }
      break;
    }
  }

  return "N/A";
}

function detectCategoryFromProducts(products: Product[]): ProductCategory {
  if (products.length === 0) return "generic";

  const name = products[0].name.toLowerCase();
  if (/\b(wh-|wf-|headphone|over[- ]?ear|on[- ]?ear)\b/i.test(name)) {
    return "headphone";
  }
  if (/\b(wf-|buds|airpods|earbuds|tws|true\s*wireless)\b/i.test(name)) {
    return "earbuds";
  }
  if (/\b(5g|gb\s*ram|mah|mp\s*camera|mobile\s*phone)\b/i.test(name)) {
    return "phone";
  }
  if (/\b(laptop|notebook|macbook)\b/i.test(name)) {
    return "laptop";
  }
  if (/\b(tablet|ipad)\b/i.test(name)) {
    return "tablet";
  }
  if (/\b(watch|smartwatch)\b/i.test(name)) {
    return "watch";
  }
  if (/\b(tv|television)\b/i.test(name)) {
    return "tv";
  }
  return "generic";
}
