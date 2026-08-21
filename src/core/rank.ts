/**
 * Value ranking engine.
 *
 * Design principles:
 *  1. Gates before scores. A product that isn't what the user asked for is
 *     removed with a recorded reason — never merely penalised.
 *  2. Spec quality is measured on ABSOLUTE anchors (a 6000mAh battery is good
 *     regardless of what else showed up in the scrape), while value is measured
 *     RELATIVE to the candidate set (percentile of spec-points-per-rupee).
 *  3. Unknown data is imputed from peers and the resulting score is discounted
 *     by a confidence factor, so a mystery phone can never win on price alone.
 */

import type {
  Candidate,
  RankedCandidate,
  RankIntent,
  ScoreBreakdown,
  Specs,
} from "./types.ts";
import { categoryMatches } from "./classify.ts";

/** Piecewise-linear interpolation over (input, score) anchor points. */
function curve(value: number, points: Array<[number, number]>): number {
  if (value <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    if (value <= x2) {
      const t = (value - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return last[1];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

const PANEL_SCORE: Record<string, number> = {
  AMOLED: 100,
  pOLED: 100,
  "PLS LCD": 55,
  "IPS LCD": 55,
  "TFT LCD": 40,
};

function perfScore(antutu: number | null): number | null {
  if (antutu === null) return null;
  // Log scale: perceived difference between 200k and 400k >> 1.6M and 1.8M.
  const lo = Math.log(150_000);
  const hi = Math.log(2_200_000);
  return clamp(((Math.log(antutu) - lo) / (hi - lo)) * 100);
}

function memoryScore(s: Specs): number | null {
  if (s.ramGb === null && s.storageGb === null) return null;
  const ram = s.ramGb === null
    ? null
    : curve(s.ramGb, [[2, 10], [4, 35], [6, 60], [8, 80], [12, 95], [16, 100]]);
  const storage = s.storageGb === null
    ? null
    : curve(s.storageGb, [[32, 10], [64, 35], [128, 65], [256, 85], [512, 97], [
      1024,
      100,
    ]]);
  if (ram === null) return storage;
  if (storage === null) return ram;
  return ram * 0.5 + storage * 0.5;
}

function displayScore(s: Specs): number | null {
  const parts: Array<[number, number]> = [];
  if (s.panel) parts.push([PANEL_SCORE[s.panel] ?? 50, 0.4]);
  if (s.refreshHz !== null) {
    parts.push([
      curve(s.refreshHz, [[60, 35], [90, 65], [120, 90], [144, 97], [
        165,
        100,
      ]]),
      0.35,
    ]);
  }
  if (s.resolution) {
    parts.push([
      s.resolution === "QHD+" ? 100 : s.resolution === "FHD+" ? 80 : 45,
      0.25,
    ]);
  }
  if (parts.length === 0) return null;
  const w = parts.reduce((sum, [, weight]) => sum + weight, 0);
  return parts.reduce((sum, [v, weight]) => sum + v * weight, 0) / w;
}

function batteryScore(s: Specs): number | null {
  const parts: Array<[number, number]> = [];
  if (s.batteryMah !== null) {
    parts.push([
      curve(s.batteryMah, [[3000, 15], [4000, 35], [5000, 65], [6000, 88], [
        7000,
        100,
      ]]),
      0.7,
    ]);
  }
  if (s.chargingW !== null) {
    parts.push([
      curve(s.chargingW, [[10, 15], [18, 35], [33, 60], [45, 75], [67, 90], [
        100,
        100,
      ]]),
      0.3,
    ]);
  }
  if (parts.length === 0) return null;
  const w = parts.reduce((sum, [, weight]) => sum + weight, 0);
  return parts.reduce((sum, [v, weight]) => sum + v * weight, 0) / w;
}

function cameraScore(s: Specs): number | null {
  if (s.mainCameraMp === null && s.ois === null) return null;
  let base = s.mainCameraMp === null
    ? 50
    : curve(s.mainCameraMp, [[8, 15], [13, 30], [32, 55], [50, 72], [64, 78], [
      108,
      88,
    ], [200, 95]]);
  if (s.ois === true) base = Math.min(100, base + 12);
  return base;
}

function extrasScore(s: Specs): number | null {
  let known = 0;
  let score = 0;
  const add = (has: boolean | null, weight: number) => {
    if (has === null) return;
    known += weight;
    if (has) score += weight;
  };
  add(s.has5g, 35);
  add(s.nfc, 15);
  add(s.ipRating !== null ? true : null, 20);
  if (s.osUpgrades !== null) {
    known += 30;
    score += curve(s.osUpgrades, [[0, 0], [2, 15], [4, 27], [6, 30]]);
  }
  if (known === 0) return null;
  return (score / known) * 100;
}

/** Weights over the phone spec dimensions, nudged by the query's priorities. */
function specWeights(intent: RankIntent): Record<string, number> {
  const base: Record<string, number> = {
    performance: 0.3,
    memory: 0.15,
    display: 0.18,
    battery: 0.17,
    camera: 0.12,
    extras: 0.08,
  };

  const boost: Record<string, string> = {
    performance: "performance",
    camera: "camera",
    battery: "battery",
    display: "display",
  };
  for (const p of intent.priorities) {
    const key = boost[p];
    if (key && base[key] !== undefined) base[key] += 0.15;
  }
  const total = Object.values(base).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(base)) base[k] /= total;
  return base;
}

/**
 * Bayesian-shrunk rating: 4.9 from 3 people must not beat 4.3 from 150k.
 *
 * Shrinkage alone is not enough — with a strong prior a 14-review product
 * inherits the segment average and looks trustworthy. So the shrunk score is
 * additionally pulled toward "unknown" (45) by an evidence factor that only
 * approaches 1 once a few thousand people have actually rated the thing.
 */
function trustScore(
  rating: number | null,
  count: number | null,
  priorMean: number,
): number | null {
  if (rating === null) return null;
  const m = 500; // prior strength, in "virtual reviews"
  const v = count ?? 0;
  const blended = (v / (v + m)) * rating + (m / (v + m)) * priorMean;
  // 3.0★ -> 0, 4.7★ -> 100. Below 3 is effectively a warning sign.
  const base = clamp(((blended - 3.0) / 1.7) * 100);
  // Evidence: 0 reviews -> 0.35, 100 -> ~0.6, 1k -> ~0.75, 10k+ -> ~1.
  const evidence = clamp(0.35 + Math.log10(v + 1) / 5.5, 0.35, 1);
  const NEUTRAL = 45;
  return clamp(NEUTRAL + (base - NEUTRAL) * evidence);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentileRank(value: number, sorted: number[]): number {
  if (sorted.length <= 1) return 50;
  let below = 0;
  for (const v of sorted) if (v < value) below++;
  return (below / (sorted.length - 1)) * 100;
}

/** "WH-1000XM5" / "wh 1000xm5" / "wh1000xm5" all collapse to "wh1000xm5". */
function modelToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Did the user name a specific model, and is this it?
 *
 * Searching "sony wh-1000xm5" and getting the WH-CH520 first because it is
 * cheaper is a failure, however good the value maths is. Exact model matches
 * are floated above everything else; the rest are kept, but as alternatives.
 */
function matchesModel(
  hint: string | null,
  brands: string[],
  name: string,
  key: string,
): boolean {
  if (!hint) return false;
  const h = modelToken(hint);
  // A hint needs a digit to be specific — "phone" or "pro" must not gate.
  if (h.length < 2 || !/\d/.test(h)) return false;
  const hay = modelToken(`${name} ${key}`);
  if (!hay.includes(h)) return false;
  // Short codes like "m7" are ambiguous across brands ("Galaxy M7" vs
  // "POCO M7"), so when the query named a brand it must agree.
  if (h.length <= 3 && brands.length > 0) {
    return brands.some((b) => hay.includes(modelToken(b)));
  }
  return true;
}

/** Minimal shape the ranker needs from the price-history store. */
export interface PriceHistoryEntry {
  min: number;
  max: number;
  /** 0 = cheapest ever recorded, 1 = most expensive. */
  position: number;
  trend: "falling" | "rising" | "stable";
  observations: number;
  daysTracked: number;
}

export interface RankOptions {
  /** Candidate key -> recorded price history, when we have any. */
  priceHistory?: Map<string, PriceHistoryEntry>;
  /** Drop candidates whose only offers are known out-of-stock. */
  inStockOnly?: boolean;
  /** Hide sponsored placements. */
  excludeSponsored?: boolean;
  /** Budget tolerance: allow this fraction over budgetMax (default 0 = strict). */
  budgetTolerance?: number;
}

export interface RankOutcome {
  ranked: RankedCandidate[];
  rejected: Array<{ candidate: Candidate; reasons: string[] }>;
}

export function rankCandidates(
  candidates: Candidate[],
  intent: RankIntent,
  options: RankOptions = {},
): RankOutcome {
  const tolerance = options.budgetTolerance ?? 0;
  const rejected: Array<{ candidate: Candidate; reasons: string[] }> = [];
  const survivors: Candidate[] = [];

  // ------------------------------------------------------------------ gates
  for (const c of candidates) {
    const reasons: string[] = [];

    if (!categoryMatches(intent.category, c.category)) {
      reasons.push(
        `category: ${c.category} ≠ ${intent.category}`,
      );
    }
    if (c.category === "accessory") reasons.push("accessory, not a product");

    const price = c.best.price;
    if (!price || price <= 0) reasons.push("no usable price");

    if (price && intent.budgetMax) {
      const ceiling = intent.budgetMax * (1 + tolerance);
      if (price > ceiling) {
        reasons.push(
          `₹${price.toLocaleString("en-IN")} over budget ₹${
            intent.budgetMax.toLocaleString("en-IN")
          }`,
        );
      }
    }
    if (price && intent.budgetMin && price < intent.budgetMin) {
      reasons.push(`₹${price.toLocaleString("en-IN")} below asked range`);
    }

    if (intent.brands.length && c.brand && !intent.brands.includes(c.brand)) {
      reasons.push(`brand ${c.brand} not requested`);
    }
    if (
      intent.excludeBrands.length && c.brand &&
      intent.excludeBrands.includes(c.brand)
    ) {
      reasons.push(`brand ${c.brand} excluded`);
    }

    for (const must of intent.mustHave) {
      if (must === "5g" && c.specs.has5g === false) reasons.push("not 5G");
      if (must === "amoled" && c.specs.panel && !/oled/i.test(c.specs.panel)) {
        reasons.push("not AMOLED");
      }
      if (must === "nfc" && c.specs.nfc === false) reasons.push("no NFC");
    }

    if (options.inStockOnly && c.offers.every((o) => o.inStock === false)) {
      reasons.push("out of stock everywhere");
    }

    if (reasons.length) rejected.push({ candidate: c, reasons });
    else survivors.push(c);
  }

  if (survivors.length === 0) return { ranked: [], rejected };

  // -------------------------------------------------- peer stats for imputation
  const weights = specWeights(intent);
  const rawComponents: Array<Record<string, number | null>> = survivors.map((
    c,
  ): Record<string, number | null> => ({
    performance: perfScore(c.specs.antutu),
    memory: memoryScore(c.specs),
    display: displayScore(c.specs),
    battery: batteryScore(c.specs),
    camera: cameraScore(c.specs),
    extras: extrasScore(c.specs),
  }));

  const peerMedian: Record<string, number> = {};
  for (const key of Object.keys(weights)) {
    const vals = rawComponents
      .map((r) => (r as Record<string, number | null>)[key])
      .filter((v): v is number => v !== null);
    // Impute slightly BELOW the peer median: unknown specs are usually unknown
    // because the product is obscure, not because it is secretly excellent.
    peerMedian[key] = (median(vals) ?? 50) * 0.9;
  }

  const ratings = survivors.map((c) => c.rating).filter((r): r is number =>
    r !== null
  );
  const priorMean = ratings.length
    ? ratings.reduce((a, b) => a + b, 0) / ratings.length
    : 4.0;

  // --------------------------------------------------------------- spec score
  const specScores = survivors.map((_c, i) => {
    const comp = rawComponents[i] as unknown as Record<string, number | null>;
    let total = 0;
    let imputedWeight = 0;
    for (const [key, w] of Object.entries(weights)) {
      if (w === 0) continue;
      const v = comp[key];
      if (v === null) {
        total += peerMedian[key] * w;
        imputedWeight += w;
      } else {
        total += v * w;
      }
    }
    return { total: clamp(total), imputedWeight, comp };
  });

  // ------------------------------------------------------------- value score
  const ratios = survivors.map((c, i) =>
    specScores[i].total / (c.best.price / 1000)
  );
  const sortedRatios = [...ratios].sort((a, b) => a - b);

  // ------------------------------------------------------------- deal scoring
  const prices = survivors.map((c) => c.best.price);
  const medPrice = median(prices) ?? 0;

  const ranked: RankedCandidate[] = survivors.map((c, i) => {
    const spec = specScores[i];
    const comp = spec.comp;

    // Value is spec-points per rupee. When the spec sheet is largely imputed
    // that ratio is an assertion, not a measurement, so it is scaled back by
    // how much we actually know. Without this a Rs 6,499 phone with no
    // readable specs and no reviews outranked a verified Rs 13,000 one purely
    // on price — again caught by the golden set.
    const evidence = 1 - spec.imputedWeight;
    const valueScore = clamp(
      percentileRank(ratios[i], sortedRatios) * (0.45 + 0.55 * evidence),
    );
    const trust = trustScore(c.rating, c.ratingCount, priorMean);

    // ---- deal quality
    let deal = 50;
    const o = c.best;
    if (o.discountPct !== null && o.mrp) {
      // Indian marketplaces routinely invent the MRP. The previous curve only
      // *reduced* the bonus for an implausible discount, so a fabricated "70%
      // off" still bought ~28 points and outranked an identical phone sold
      // honestly at the same price — caught by tests/golden_test.ts.
      //
      // Credibility now decays to zero: 40% off is taken at face value, 55%
      // counts for 25, and anything at or beyond 80% earns nothing at all.
      const d = o.discountPct;
      const credible = d <= 40 ? d : Math.max(0, 40 - (d - 40) * 2);
      deal += credible * 0.6;
      // Beyond ~60% the MRP is not merely unhelpful, it is evidence the
      // listing is dishonest — which is a negative signal about the seller,
      // not a neutral one. The UI already warns about it in the cons list.
      if (d > 60) deal -= 8;
    }
    if (c.offers.length > 1) {
      const spread = Math.max(...c.offers.map((x) => x.price)) - o.price;
      if (spread > 0) deal += Math.min(15, (spread / o.price) * 100);
      deal += 5; // cross-platform confirmation is itself a signal
    }
    if (medPrice && o.price < medPrice) deal += 5;

    // Recorded history beats a single snapshot's discount claim: a "50% off"
    // banner means nothing if the phone has sat at this price for six weeks.
    const hist = options.priceHistory?.get(c.key);
    if (hist && hist.observations >= 2) {
      if (o.price <= hist.min) deal += 20;
      else if (hist.position <= 0.15) deal += 12;
      else if (hist.position >= 0.85) deal -= 12;
      if (hist.trend === "falling") deal -= 4; // wait, it is still dropping
      else if (hist.trend === "rising") deal += 4;
    }
    const dealScore = clamp(deal);

    // ---- confidence
    const confidence = clamp(
      (1 - spec.imputedWeight) * 60 +
        c.specCompleteness * 20 +
        (c.rating !== null ? 10 : 0) +
        (c.kbConfidence === "high"
          ? 10
          : c.kbConfidence === "medium"
          ? 6
          : c.kbConfidence === "low"
          ? 3
          : 0),
      0,
      100,
    ) / 100;

    const totalRaw = valueScore * 0.35 +
      spec.total * 0.3 +
      (trust ?? 45) * 0.2 +
      dealScore * 0.15;

    // Low-confidence candidates get pulled toward the middle rather than
    // being allowed to win on an imputed spec sheet. A phone whose chipset,
    // battery and panel are all unknown is a gamble, and the score says so.
    const total = clamp(totalRaw * (0.7 + 0.3 * confidence));

    const pick = (k: string) => Math.round(comp[k] ?? peerMedian[k] ?? 45);
    const score: ScoreBreakdown = {
      performance: pick("performance"),
      display: pick("display"),
      battery: pick("battery"),
      camera: pick("camera"),
      memory: pick("memory"),
      extras: pick("extras"),
      specScore: Math.round(spec.total),
      valueScore: Math.round(valueScore),
      trustScore: Math.round(trust ?? 45),
      dealScore: Math.round(dealScore),
      total: Math.round(total * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
    };

    return {
      ...c,
      rank: 0,
      matchesRequestedModel: matchesModel(
        intent.modelHint,
        intent.brands,
        c.modelName,
        c.key,
      ),
      score,
      pros: [],
      cons: [],
      verdict: "",
      badges: [],
    };
  });

  // If the query named a specific model and we found it, it leads — always.
  const anyExactMatch = ranked.some((r) => r.matchesRequestedModel);
  ranked.sort((a, b) =>
    (anyExactMatch
      ? Number(b.matchesRequestedModel) - Number(a.matchesRequestedModel)
      : 0) ||
    b.score.total - a.score.total ||
    b.score.confidence - a.score.confidence ||
    a.best.price - b.best.price
  );
  ranked.forEach((r, i) => (r.rank = i + 1));

  annotate(ranked, intent, options.priceHistory);
  return { ranked, rejected };
}

// ------------------------------------------------------------------ narrative

function annotate(
  ranked: RankedCandidate[],
  intent: RankIntent,
  priceHistory?: Map<string, PriceHistoryEntry>,
): void {
  if (ranked.length === 0) return;
  const anyMatch = ranked.some((r) => r.matchesRequestedModel);

  const med = {
    price: median(ranked.map((r) => r.best.price)) ?? 0,
    battery: median(
      ranked.map((r) => r.specs.batteryMah).filter((v): v is number =>
        v !== null
      ),
    ),
    antutu: median(
      ranked.map((r) => r.specs.antutu).filter((v): v is number => v !== null),
    ),
    ram: median(
      ranked.map((r) => r.specs.ramGb).filter((v): v is number => v !== null),
    ),
    storage: median(
      ranked.map((r) => r.specs.storageGb).filter((v): v is number =>
        v !== null
      ),
    ),
  };

  // Superlative badges are only awarded among candidates we actually have data
  // for — "BEST VALUE" on a phone with an unknown chipset is not a recommendation.
  const badgesFromHistory = new Set<string>();
  // Superlative badges are a recommendation, so they demand real evidence.
  // Confidence alone was not enough: a phone with an unknown chipset, no
  // reviews at all and 55% confidence took "BEST VALUE" on a live run purely
  // because its imputed spec sheet divided nicely by its price.
  const credible = ranked.filter((r) => r.score.confidence >= 0.5);
  const pool = credible.length >= 2 ? credible : ranked;

  /** Enough evidence to actively recommend, not merely to list. */
  const isVouchable = (r: RankedCandidate) =>
    r.score.confidence >= 0.6 &&
    r.specs.socName !== null &&
    (r.ratingCount ?? 0) >= 100 &&
    (r.rating ?? 0) >= 3.5;

  const vouchable = pool.filter(isVouchable);
  const recommendPool = vouchable.length >= 2 ? vouchable : pool;

  // CHEAPEST is a statement of fact about price, so it is computed over every
  // ranked product. Restricting it to the credible pool made it lie: it would
  // sit on the cheapest *verified* phone while a cheaper one was listed above.
  const cheapest = ranked.reduce((
    a,
    b,
  ) => (b.best.price < a.best.price ? b : a));
  const bestValue = recommendPool.reduce((
    a,
    b,
  ) => (b.score.valueScore > a.score.valueScore ? b : a));
  const fastest = pool.reduce((
    a,
    b,
  ) => (b.score.performance > a.score.performance ? b : a));
  const bestRated = pool
    .filter((r) => (r.ratingCount ?? 0) > 500)
    .reduce<RankedCandidate | null>(
      (a, b) => (a === null || b.score.trustScore > a.score.trustScore ? b : a),
      null,
    );
  const bestBattery = pool.reduce((
    a,
    b,
  ) => (b.score.battery > a.score.battery ? b : a));

  for (const r of ranked) {
    const pros: string[] = [];
    const cons: string[] = [];
    const s = r.specs;

    if (s.socName) {
      const tierWord = s.perfTier?.replace("-", " ") ?? "";
      if (med.antutu && s.antutu && s.antutu > med.antutu * 1.15) {
        pros.push(`${s.socName} — faster than most here (${tierWord})`);
      } else if (med.antutu && s.antutu && s.antutu < med.antutu * 0.8) {
        cons.push(`${s.socName} is slower than the segment median`);
      }
    } else {
      cons.push("chipset unknown — performance not verified");
    }

    if (s.panel && /oled/i.test(s.panel)) {
      pros.push(`${s.panel} panel`);
    } else if (s.panel) cons.push(`${s.panel} panel (no OLED)`);
    if (s.refreshHz && s.refreshHz >= 120) {
      pros.push(`${s.refreshHz}Hz display`);
    } else if (s.refreshHz && s.refreshHz <= 60) cons.push("60Hz display");
    if (s.resolution === "HD+") cons.push("HD+ resolution only");

    if (
      s.batteryMah && med.battery && s.batteryMah >= med.battery * 1.1
    ) {
      pros.push(`${s.batteryMah}mAh battery`);
    }
    if (s.chargingW && s.chargingW >= 33) {
      pros.push(`${s.chargingW}W charging`);
    } else if (s.chargingW && s.chargingW <= 15) {
      cons.push(`slow ${s.chargingW}W charging`);
    }

    if (s.ramGb && med.ram && s.ramGb > med.ram) {
      pros.push(`${s.ramGb}GB RAM`);
    }
    if (s.storageGb && med.storage && s.storageGb < med.storage) {
      cons.push(`only ${s.storageGb}GB storage`);
    }
    if (s.has5g === false) cons.push("4G only");
    if (s.ois) pros.push("OIS on main camera");
    if (s.ipRating) pros.push(`${s.ipRating} rated`);

    if (r.best.price < med.price * 0.85) {
      pros.push(
        `₹${
          Math.round(med.price - r.best.price).toLocaleString("en-IN")
        } below segment median`,
      );
    }
    if (r.offers.length > 1) {
      pros.push(
        `${r.offers.length} offers — cheapest on ${r.best.platformName}`,
      );
    }
    if (r.rating !== null && r.rating >= 4.2 && (r.ratingCount ?? 0) > 1000) {
      pros.push(`${r.rating}★ from ${formatCount(r.ratingCount!)} buyers`);
    }
    if (r.rating !== null && r.rating < 3.9) {
      cons.push(`weak ${r.rating}★ rating`);
    }
    if ((r.ratingCount ?? 0) < 100) cons.push("very few reviews — unproven");
    const hist = priceHistory?.get(r.key);
    if (hist && hist.observations >= 2) {
      if (r.best.price <= hist.min) {
        // Prepend: "cheapest we have ever seen it" outranks any spec bullet,
        // and pros are capped at five.
        pros.unshift(
          hist.daysTracked >= 1
            ? `lowest price in ${hist.daysTracked} day(s) of tracking`
            : "lowest price we have recorded so far",
        );
        badgesFromHistory.add(r.key);
      } else if (hist.position >= 0.85) {
        cons.push(
          `near its recorded high of ₹${hist.max.toLocaleString("en-IN")}`,
        );
      }
      if (hist.trend === "falling") {
        cons.push("price is still trending down — worth waiting");
      }
    }
    if (r.best.discountPct !== null && r.best.discountPct > 55) {
      cons.push(`${r.best.discountPct}% "discount" — inflated MRP likely`);
    }
    if (r.score.confidence < 0.5) {
      cons.push("limited spec data — verify before buying");
    }
    if (r.kbConfidence === "low") cons.push("spec sheet partly unverified");
    const qualifier = r.key.match(/#([a-z+-]+)\|/)?.[1];
    if (qualifier) {
      cons.unshift(
        qualifier === "carrier-locked"
          ? "carrier-locked SKU — cheaper but tied to one network"
          : `${
            qualifier.replace(/[+]/g, " + ")
          } unit, not a standard new device`,
      );
    }

    const badges: string[] = [];
    if (anyMatch && !r.matchesRequestedModel) badges.push("ALTERNATIVE");
    if (r === bestValue && isVouchable(r)) badges.push("BEST VALUE");
    if (r === cheapest) badges.push("CHEAPEST");
    if (r === fastest && (r.specs.antutu ?? 0) > 0 && isVouchable(r)) {
      badges.push("FASTEST");
    }
    if (r === bestBattery && (r.specs.batteryMah ?? 0) > 0) {
      badges.push("BATTERY KING");
    }
    if (bestRated && r === bestRated) badges.push("BEST RATED");
    if (badgesFromHistory.has(r.key)) badges.push("LOWEST YET");
    if (r.rank === 1) badges.unshift("TOP PICK");

    r.pros = pros.slice(0, 5);
    r.cons = cons.slice(0, 4);
    r.badges = badges;
    r.verdict = buildVerdict(r, intent, med.price);
  }
}

function buildVerdict(
  r: RankedCandidate,
  intent: RankIntent,
  medPrice: number,
): string {
  const price = `₹${r.best.price.toLocaleString("en-IN")}`;
  const bits: string[] = [];

  if (r.rank === 1) {
    bits.push(`Best overall pick at ${price}`);
  } else if (r.score.valueScore >= 80) {
    bits.push(`Strong value at ${price}`);
  } else if (r.best.price < medPrice * 0.85) {
    bits.push(`Cheapest way into this segment at ${price}`);
  } else {
    bits.push(`Solid option at ${price}`);
  }

  const strengths: string[] = [];
  if (r.score.performance >= 65) strengths.push("performance");
  if (r.score.battery >= 75) strengths.push("battery");
  if (r.score.display >= 75) strengths.push("display");
  if (r.score.camera >= 75) strengths.push("camera");
  if (strengths.length) bits.push(`leads on ${strengths.join(" and ")}`);

  const weak: string[] = [];
  if (r.score.performance < 40) weak.push("raw speed");
  if (r.score.display < 45) weak.push("screen quality");
  if (r.score.battery < 45) weak.push("battery");
  if (weak.length) bits.push(`compromises on ${weak.join(" and ")}`);

  if (intent.priorities.includes("performance") && r.score.performance < 50) {
    bits.push("not ideal for gaming");
  }
  if (r.score.confidence < 0.5) bits.push("specs partly inferred");

  return `${bits.join("; ")}.`;
}

export function formatCount(n: number): string {
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
