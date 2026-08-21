/**
 * Variant grouping.
 *
 * A marketplace search returns the same phone many times: once per colour, per
 * storage tier, per seller, per platform. The old pipeline deduped on the exact
 * normalised name, so four colours of the same phone occupied four of the top
 * ten slots. Here one *model + memory config* is one candidate, and every card
 * we saw for it becomes an offer inside that candidate.
 */

import type { AnalyzedListing, Candidate, Offer, Specs } from "./types.ts";

function mergeSpecs(listings: AnalyzedListing[]): {
  specs: Specs;
  sources: AnalyzedListing["specSources"];
  completeness: number;
  kbConfidence: Candidate["kbConfidence"];
} {
  // Prefer the listing that knows the most, then fill gaps from the others.
  const ordered = [...listings].sort((a, b) =>
    b.specCompleteness - a.specCompleteness
  );
  const specs = { ...ordered[0].specs };
  const sources = { ...ordered[0].specSources };
  for (const l of ordered.slice(1)) {
    for (
      const [k, v] of Object.entries(l.specs) as Array<[keyof Specs, unknown]>
    ) {
      if (v !== null && specs[k] === null) {
        // deno-lint-ignore no-explicit-any
        (specs as any)[k] = v;
        sources[k] = l.specSources[k];
      }
    }
  }
  const best = ordered[0];
  const kbConfidence = ordered.find((l) => l.kbConfidence !== "none")
    ?.kbConfidence ?? "none";
  return {
    specs,
    sources,
    completeness: Math.max(...listings.map((l) => l.specCompleteness)),
    kbConfidence: kbConfidence ?? best.kbConfidence,
  };
}

/** Rating across platforms, weighted by how many people actually rated. */
function blendRating(listings: AnalyzedListing[]): {
  rating: number | null;
  count: number | null;
} {
  const rated = listings.filter((l) => l.rating !== null && l.rating > 0);
  if (rated.length === 0) return { rating: null, count: null };
  // Per-platform max review count (the same platform repeats the same number
  // across colour variants — summing it would inflate confidence).
  const perPlatform = new Map<string, { rating: number; count: number }>();
  for (const l of rated) {
    const count = l.ratingCount ?? 0;
    const prev = perPlatform.get(l.platform);
    if (!prev || count > prev.count) {
      perPlatform.set(l.platform, { rating: l.rating!, count });
    }
  }
  const entries = [...perPlatform.values()];
  const totalCount = entries.reduce((s, e) => s + e.count, 0);
  if (totalCount === 0) {
    const avg = entries.reduce((s, e) => s + e.rating, 0) / entries.length;
    return { rating: Math.round(avg * 10) / 10, count: null };
  }
  const weighted = entries.reduce((s, e) => s + e.rating * e.count, 0) /
    totalCount;
  return { rating: Math.round(weighted * 10) / 10, count: totalCount };
}

function toOffer(l: AnalyzedListing): Offer | null {
  if (l.price === null) return null;
  return {
    platform: l.platform,
    platformName: l.platformName,
    price: l.price,
    mrp: l.mrp,
    discountPct: l.discountPct,
    url: l.url,
    inStock: l.inStock,
    rating: l.rating,
    ratingCount: l.ratingCount,
  };
}

/**
 * Group listings into candidates.
 *
 * Cards with no price still join their model group — they contribute specs,
 * ratings and cross-platform evidence even though they cannot be the best
 * offer. That is how a 45%-broken scrape still produces a complete picture.
 */
export function groupListings(listings: AnalyzedListing[]): Candidate[] {
  const byModel = new Map<string, AnalyzedListing[]>();
  for (const l of listings) {
    const key = l.modelKey || l.title.toLowerCase();
    const arr = byModel.get(key);
    if (arr) arr.push(l);
    else byModel.set(key, [l]);
  }

  const candidates: Candidate[] = [];

  for (const [modelKey, group] of byModel) {
    // Split by memory config: 6/128 and 8/256 are genuinely different buys.
    const byConfig = new Map<string, AnalyzedListing[]>();
    for (const l of group) {
      const arr = byConfig.get(l.configKey);
      if (arr) arr.push(l);
      else byConfig.set(l.configKey, [l]);
    }

    // Partially-known configs ("?r-128s") and fully unknown ones ("?r-?s") must
    // not become phantom candidates alongside the real 6/128 and 8/128 entries.
    // Fold each into the best-matching fully-known config.
    foldPartialConfigs(byConfig);

    const configPrices: Array<{ configKey: string; price: number }> = [];
    for (const [configKey, ls] of byConfig) {
      const prices = ls.map((l) => l.price).filter((p): p is number =>
        p !== null
      );
      if (prices.length) {
        configPrices.push({ configKey, price: Math.min(...prices) });
      }
    }

    for (const [configKey, ls] of byConfig) {
      const offers = ls
        .map(toOffer)
        .filter((o): o is Offer => o !== null)
        // Cheapest first, but a known-in-stock offer outranks an unknown one
        // at the same price.
        .sort((a, b) =>
          a.price - b.price ||
          (b.inStock === true ? 1 : 0) - (a.inStock === true ? 1 : 0)
        );

      // Dedupe offers: same platform + same price is the same deal.
      const seen = new Set<string>();
      const uniqueOffers = offers.filter((o) => {
        const k = `${o.platform}:${o.price}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      if (uniqueOffers.length === 0) continue; // nothing purchasable here

      const { specs, sources, completeness, kbConfidence } = mergeSpecs(ls);
      const { rating, count } = blendRating(ls);
      const preferred = ls.find((l) => l.kbConfidence !== "none") ?? ls[0];

      candidates.push({
        key: `${modelKey}|${configKey}`,
        modelName: buildDisplayName(preferred, specs, modelKey),
        brand: ls.map((l) => l.brand).find(Boolean) ?? null,
        category: majorityCategory(ls),
        specs,
        specSources: sources,
        specCompleteness: completeness,
        kbConfidence,
        best: uniqueOffers[0],
        offers: uniqueOffers,
        siblingConfigs: configPrices.filter((c) => c.configKey !== configKey),
        rating,
        ratingCount: count,
        imageUrl: ls.map((l) => l.imageUrl).find(Boolean) ?? null,
        listings: ls,
      });
    }
  }

  return candidates;
}

/**
 * Merge configs that are only partially known into fully-known siblings.
 *
 * A Flipkart card recovered from a URL slug often yields storage but not RAM
 * ("?r-128s"). Left alone it would appear as a second, duplicate row for a
 * phone we already list as 6/128. Matching rule: same storage wins; otherwise
 * the cheapest known config absorbs it.
 */
function foldPartialConfigs(byConfig: Map<string, AnalyzedListing[]>): void {
  if (byConfig.size < 2) return;

  const known = [...byConfig.keys()].filter((k) => !k.includes("?"));
  if (known.length === 0) return;

  const partial = [...byConfig.keys()].filter((k) => k.includes("?"));
  for (const key of partial) {
    const orphans = byConfig.get(key)!;
    const storage = key.split("-")[1]; // "128s" or "?s"

    const sameStorage = known.filter((k) => k.split("-")[1] === storage);
    const pool = sameStorage.length ? sameStorage : known;

    let target = "";
    let bestPrice = Infinity;
    for (const k of pool) {
      const p = Math.min(...byConfig.get(k)!.map((l) => l.price ?? Infinity));
      if (p < bestPrice) {
        bestPrice = p;
        target = k;
      }
    }
    if (target) {
      byConfig.get(target)!.push(...orphans);
      byConfig.delete(key);
    }
  }
}

function majorityCategory(ls: AnalyzedListing[]): Candidate["category"] {
  const tally = new Map<string, number>();
  for (const l of ls) {
    tally.set(l.category, (tally.get(l.category) ?? 0) + l.categoryConfidence);
  }
  return [...tally.entries()].sort((a, b) =>
    b[1] - a[1]
  )[0][0] as Candidate["category"];
}

function buildDisplayName(
  l: AnalyzedListing,
  specs: Specs,
  modelKey: string,
): string {
  const base = l.modelName.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ")
    .trim();
  const cfg: string[] = [];
  if (specs.ramGb) cfg.push(`${specs.ramGb}GB`);
  if (specs.storageGb) {
    cfg.push(
      specs.storageGb >= 1024
        ? `${specs.storageGb / 1024}TB`
        : `${specs.storageGb}GB`,
    );
  }
  // Surface SKU qualifiers (carrier-locked, refurbished) in the name itself —
  // they are the whole reason the price looks good.
  const qualifier = modelKey.split("#")[1];
  const suffix = qualifier ? ` [${qualifier.replace(/\+/g, " + ")}]` : "";
  return (cfg.length ? `${base} (${cfg.join("/")})` : base) + suffix;
}
