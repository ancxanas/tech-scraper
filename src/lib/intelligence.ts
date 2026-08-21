import type {
  DealReport,
  ParsedIntent,
  PriceAnalytics,
  Product,
  ProductCategory,
} from "../types.ts";
import { extractSpecs, getComparisonFields } from "./specs.ts";
import type { ScoredProduct } from "../score.ts";

export function generateDealReport(
  best: Product,
  scored: ScoredProduct[],
  intent: ParsedIntent,
  category: ProductCategory,
  priceHistory?: PriceAnalytics,
): DealReport {
  const verdict = buildVerdict(best, intent, priceHistory);
  const verdictSummary = buildVerdictSummary(best, intent, scored);
  const priceIntel = buildPriceIntelligence(best, priceHistory);
  const whyThisOne = buildWhyThis(best, scored, category);
  const effectivePrice = buildEffectivePrice(best);
  const alternatives = buildAlternatives(best, scored, intent);
  const watchOut = buildWatchOut(best, category);
  const specBreakdown = buildSpecBreakdown(best, scored, category);
  const temporalAdvice = buildTemporalAdvice(best, intent);

  return {
    verdict,
    verdictSummary,
    priceIntelligence: priceIntel,
    whyThisOne,
    effectivePrice,
    alternatives,
    watchOut,
    specBreakdown,
    temporalAdvice,
  };
}

function buildVerdict(
  best: Product,
  intent: ParsedIntent,
  priceHistory?: PriceAnalytics,
): string {
  const parts: string[] = [];

  if (priceHistory?.buyAdvice === "great_deal") {
    parts.push("BUY NOW");
  } else if (priceHistory?.buyAdvice === "good_deal") {
    parts.push("Good deal");
  } else if (priceHistory?.buyAdvice === "wait") {
    parts.push("Consider waiting");
  } else {
    parts.push("Best option found");
  }

  if (intent.budget && best.price <= intent.budget) {
    parts.push("within budget");
  }

  if (best.discount >= 40) {
    parts.push(`${best.discount}% off is excellent`);
  } else if (best.discount >= 20) {
    parts.push(`${best.discount}% off is decent`);
  }

  return parts.join(". ") + ".";
}

function buildVerdictSummary(
  best: Product,
  _intent: ParsedIntent,
  scored: Product[],
): string {
  const platformCount = new Set(scored.map((p) => p.platform)).size;
  const sameProduct = scored.filter(
    (p) => normalizeName(p.name) === normalizeName(best.name),
  );
  const cheaperElsewhere = sameProduct.filter((p) => p.price < best.price);

  let summary = `Found ${best.name} across ${platformCount} platforms.`;

  if (cheaperElsewhere.length > 0) {
    const cheapest = cheaperElsewhere.reduce((a, b) =>
      a.price < b.price ? a : b
    );
    summary += ` ${cheapest.platform} has it cheaper at ₹${
      cheapest.price.toLocaleString("en-IN")
    }.`;
  } else if (sameProduct.length > 1) {
    summary += ` ${best.platform} offers the best price.`;
  }

  return summary;
}

function buildPriceIntelligence(
  best: Product,
  priceHistory?: PriceAnalytics,
): DealReport["priceIntelligence"] {
  if (!priceHistory || priceHistory.dataPoints < 2) {
    const discount = best.discount;
    let position: string;
    let buyAdvice: string;

    if (discount >= 40) {
      position = "Excellent discount";
      buyAdvice = "GREAT DEAL";
    } else if (discount >= 25) {
      position = "Good discount";
      buyAdvice = "GOOD DEAL";
    } else if (discount >= 10) {
      position = "Moderate discount";
      buyAdvice = "OKAY";
    } else {
      position = "Full price";
      buyAdvice = "WAIT FOR SALE";
    }

    return {
      position,
      trend: "No history data",
      buyAdvice,
    };
  }

  const pos = priceHistory.pricePosition;
  const positionMap: Record<string, string> = {
    at_lowest: "At lowest recorded price",
    near_lowest: "Near lowest price",
    above_average: "Above average price",
    at_peak: "At peak price",
  };

  return {
    position: positionMap[pos] || pos,
    trend: priceHistory.priceTrend === "rising"
      ? "Prices trending up"
      : priceHistory.priceTrend === "falling"
      ? "Prices trending down"
      : "Stable prices",
    buyAdvice: priceHistory.buyAdvice.toUpperCase().replace("_", " "),
  };
}

function buildWhyThis(
  best: Product,
  scored: Product[],
  category: ProductCategory,
): string[] {
  const reasons: string[] = [];

  const specs = extractSpecs(best, category);

  if (best.discount > 0) {
    const betterDeals = scored.filter((p) => p.discount > best.discount);
    if (betterDeals.length === 0 || best.discount >= 30) {
      reasons.push(
        `${best.discount}% discount is among the best in this selection`,
      );
    }
  }

  const platformPrices = new Map<string, number[]>();
  for (const p of scored) {
    const key = normalizeName(p.name);
    if (!platformPrices.has(key)) platformPrices.set(key, []);
    platformPrices.get(key)!.push(p.price);
  }
  const bestName = normalizeName(best.name);
  for (const [name, prices] of platformPrices) {
    if (name === bestName && prices.length > 1) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      if (best.price === min && max > min) {
        reasons.push(
          `Lowest price across ${prices.length} platforms (saves ₹${
            max - min
          } vs highest)`,
        );
      }
    }
  }

  if (best.rating && best.rating >= 4.0) {
    reasons.push(`${best.rating}★ rating`);
  }

  if (best.reviewsCount && best.reviewsCount > 1000) {
    reasons.push(
      `${Math.round(best.reviewsCount / 1000)}k+ reviews — well-validated`,
    );
  }

  const specFields = getComparisonFields(category);
  const allSpecs = scored.map((p) => ({
    product: p,
    specs: extractSpecs(p, category),
  }));

  for (const field of specFields.slice(0, 3)) {
    const bestVal = specs.specs[field as keyof typeof specs.specs];
    if (bestVal === undefined || bestVal === null) continue;

    let isBest = true;
    for (const { specs: otherSpecs } of allSpecs) {
      const otherVal = otherSpecs[field as keyof typeof otherSpecs];
      if (otherVal === undefined || otherVal === null) continue;
      if (typeof bestVal === "number" && typeof otherVal === "number") {
        if (otherVal > bestVal) {
          isBest = false;
          break;
        }
      }
    }
    if (isBest && allSpecs.length > 1) {
      reasons.push(`Best ${formatFieldName(field)} in this price range`);
    }
  }

  if (reasons.length === 0) {
    reasons.push("Best balance of price, features, and reviews");
  }

  return reasons;
}

function buildEffectivePrice(
  best: Product,
): DealReport["effectivePrice"] {
  const bankOffers: Array<{ text: string; savings: number }> = [];
  const coupons: Array<{ code: string; savings: number }> = [];
  let exchangeBonus = 0;

  if (best.offers) {
    for (const offer of best.offers) {
      const lower = offer.toLowerCase();
      const bankMatch = lower.match(
        /(\d+)%?\s*(?:off|cashback).*?(?:bank|card|hdfc|icici|sbi|axis)/i,
      );
      if (bankMatch) {
        const pct = parseInt(bankMatch[1], 10);
        const savings = Math.round(best.price * pct / 100);
        bankOffers.push({ text: offer, savings });
      }
      const couponMatch = lower.match(
        /(?:coupon|code|use).*?([A-Z0-9]{4,}).*?(\d+)%?\s*off/i,
      );
      if (couponMatch) {
        const pct = parseInt(couponMatch[2], 10);
        const savings = Math.round(best.price * pct / 100);
        coupons.push({ code: couponMatch[1], savings });
      }
    }
  }

  if (best.exchangePrice && best.exchangePrice > 0) {
    exchangeBonus = best.exchangePrice;
  }

  const totalBankSavings = bankOffers.reduce((sum, o) => sum + o.savings, 0);
  const totalCouponSavings = coupons.reduce((sum, o) => sum + o.savings, 0);
  const totalSavings = totalBankSavings + exchangeBonus + totalCouponSavings;
  const effectivePrice = Math.max(0, best.price - totalSavings);

  return {
    listed: best.price,
    bankOffers,
    exchangeBonus,
    coupons,
    effectivePrice,
    totalSavings,
  };
}

function buildAlternatives(
  best: Product,
  scored: ScoredProduct[],
  _intent: ParsedIntent,
): DealReport["alternatives"] {
  const alternatives: DealReport["alternatives"] = [];
  const bestName = normalizeName(best.name);

  const cheaper = scored
    .filter((p) => normalizeName(p.name) !== bestName && p.price < best.price)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  for (const p of cheaper) {
    alternatives.push({
      type: "cheaper",
      productName: p.name.length > 50 ? p.name.slice(0, 47) + "..." : p.name,
      productPrice: p.price,
      platform: p.platform,
      comparison: `₹${best.price - p.price} cheaper`,
    });
  }

  const pricier = scored
    .filter((p) => normalizeName(p.name) !== bestName && p.price > best.price)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  for (const p of pricier) {
    alternatives.push({
      type: "pricier",
      productName: p.name.length > 50 ? p.name.slice(0, 47) + "..." : p.name,
      productPrice: p.price,
      platform: p.platform,
      comparison: `₹${p.price - best.price} more but ${
        p.discount > best.discount ? "better discount" : "similar specs"
      }`,
    });
  }

  const differentBrand = scored
    .filter(
      (p) =>
        normalizeName(p.name) !== bestName &&
        p.brand !== best.brand &&
        Math.abs(p.price - best.price) < best.price * 0.3,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 1);
  for (const p of differentBrand) {
    alternatives.push({
      type: "different_brand",
      productName: p.name.length > 50 ? p.name.slice(0, 47) + "..." : p.name,
      productPrice: p.price,
      platform: p.platform,
      comparison: `Similar price, different brand`,
    });
  }

  return alternatives;
}

function buildWatchOut(
  best: Product,
  category: ProductCategory,
): string[] {
  const watchOut: string[] = [];

  if (best.discount >= 60) {
    watchOut.push(
      "Heavy discount may indicate old model or inflated MRP",
    );
  }

  if (!best.rating || best.rating < 3.5) {
    watchOut.push("Low or missing rating — check reviews before buying");
  }

  if (best.reviewsCount !== undefined && best.reviewsCount < 100) {
    watchOut.push("Few reviews — product may be new or unpopular");
  }

  if (category === "phone" && intentCategoryIs5g(best)) {
    watchOut.push("No 5G support — may feel outdated in 1-2 years");
  }

  if (category === "headphone" || category === "earbuds") {
    const name = best.name.toLowerCase();
    if (!name.includes("anc") && !name.includes("noise")) {
      watchOut.push("No active noise cancellation");
    }
  }

  if (best.availability?.toLowerCase().includes("out")) {
    watchOut.push("Currently out of stock");
  }

  return watchOut;
}

function buildSpecBreakdown(
  best: Product,
  scored: Product[],
  category: ProductCategory,
): DealReport["specBreakdown"] {
  const specs = extractSpecs(best, category);
  const breakdown: DealReport["specBreakdown"] = [];

  const priceScore = scored.length > 1
    ? Math.round(
      (1 - best.price / Math.max(...scored.map((p) => p.price))) * 5,
    )
    : 3;
  breakdown.push({
    name: "Price",
    rating: Math.max(1, Math.min(5, priceScore)),
    text: `₹${best.price.toLocaleString("en-IN")}${
      best.discount > 0 ? ` (${best.discount}% off)` : ""
    }`,
    stars: "★".repeat(Math.max(1, Math.min(5, priceScore))) +
      "☆".repeat(5 - Math.max(1, Math.min(5, priceScore))),
  });

  const ratingScore = best.rating || 0;
  if (ratingScore > 0) {
    breakdown.push({
      name: "User Rating",
      rating: Math.round(ratingScore),
      text: `${ratingScore}★${
        best.reviewsCount
          ? ` from ${best.reviewsCount.toLocaleString("en-IN")} reviews`
          : ""
      }`,
      stars: "★".repeat(Math.round(ratingScore)) +
        "☆".repeat(5 - Math.round(ratingScore)),
    });
  }

  const specFields = getComparisonFields(category);
  for (const field of specFields.slice(0, 5)) {
    const val = specs.specs[field as keyof typeof specs.specs];
    if (val === undefined || val === null) continue;

    const allVals = scored
      .map((p) => extractSpecs(p, category).specs[field])
      .filter((v): v is number => typeof v === "number");
    if (allVals.length < 2) continue;

    const max = Math.max(...allVals);
    const specRating = typeof val === "number"
      ? Math.max(1, Math.round((val / max) * 5))
      : 3;

    breakdown.push({
      name: formatFieldName(field),
      rating: specRating,
      text: formatFieldValue(field, val),
      stars: "★".repeat(specRating) + "☆".repeat(5 - specRating),
    });
  }

  return breakdown;
}

function buildTemporalAdvice(
  _best: Product,
  intent: ParsedIntent,
): string | null {
  if (intent.temporal?.before) {
    return `Needed by ${intent.temporal.before} — ${
      intent.temporal.urgency === "asap"
        ? "buy now to ensure delivery"
        : "compare prices before purchasing"
    }`;
  }

  const now = new Date();
  const month = now.getMonth();

  if (month >= 9 && month <= 11) {
    return "Festive season sales (Diwali) — prices likely to drop further";
  }
  if (month === 0 || month === 1) {
    return "Republic Day sales may offer better prices soon";
  }
  if (month >= 5 && month <= 7) {
    return "Monsoon/Independence Day sales approaching";
  }

  return null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
}

function formatFieldName(field: string): string {
  const map: Record<string, string> = {
    ram_gb: "RAM",
    storage_gb: "Storage",
    battery_mah: "Battery",
    camera_mp: "Camera",
    display_size: "Display",
    refresh_rate: "Refresh Rate",
    anc: "Noise Cancellation",
    driver_mm: "Driver Size",
    battery_hours: "Battery Life",
    weight_g: "Weight",
    is_5g: "5G Support",
  };
  return map[field] || field;
}

function formatFieldValue(field: string, val: string | number): string {
  switch (field) {
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
    case "anc":
      return val ? "Yes" : "No";
    default:
      return String(val);
  }
}

function intentCategoryIs5g(product: Product): boolean {
  const name = product.name.toLowerCase();
  return (
    name.includes("4g") ||
    name.includes("lte") ||
    name.includes("volte") ||
    product.price < 10000
  );
}
